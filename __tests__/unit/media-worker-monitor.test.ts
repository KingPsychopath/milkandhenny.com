import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  active: false,
  emit: vi.fn(async () => ({ id: "event_1", created: true })),
  heartbeat: "2026-09-01T12:00:00.000Z",
  resolve: vi.fn(async () => 0),
}));

vi.mock("@/features/attendee-operations/notifications.server", () => ({
  emitDomainEvent: state.emit,
  hasActiveAdminNotification: vi.fn(async () => state.active),
  resolveAdminNotificationsByCategory: state.resolve,
}));
vi.mock("@/features/media/config.server", () => ({
  getMediaProcessorMode: () => "hybrid",
}));
vi.mock("@/features/transfers/media-worker-status.server", () => ({
  getTransferMediaWorkerStatus: vi.fn(async () => ({ lastHeartbeatAt: state.heartbeat })),
}));
vi.mock("@/features/transfers/media-queue.server", () => ({
  describeTransferMediaQueue: vi.fn(async () => ({
    enabled: true,
    queued: 0,
    leased: 0,
    permanentFailures: 0,
    oldestPermanentFailureAt: null,
    backlogAgeMs: null,
    durableWork: { oldestPendingAt: null },
  })),
}));

import {
  MEDIA_WORKER_ALERT_CATEGORY,
  monitorMediaWorkerHealth,
} from "@/features/system/media-worker-monitor.server";

describe("media worker monitor", () => {
  beforeEach(() => {
    state.active = false;
    state.heartbeat = "2026-09-01T12:00:00.000Z";
    state.emit.mockClear();
    state.resolve.mockClear();
    state.resolve.mockResolvedValue(0);
  });

  it("resolves an existing alert after the worker recovers", async () => {
    state.resolve.mockResolvedValue(1);
    await expect(monitorMediaWorkerHealth(new Date(state.heartbeat))).resolves.toEqual({
      state: "healthy",
      resolved: 1,
    });
    expect(state.resolve).toHaveBeenCalledWith(
      MEDIA_WORKER_ALERT_CATEGORY,
      "Media worker heartbeat and queue recovered automatically.",
    );
    expect(state.emit).not.toHaveBeenCalled();
  });

  it("emits one standard operations alert for a stale heartbeat", async () => {
    const now = new Date("2026-09-01T12:20:00.000Z");
    await expect(monitorMediaWorkerHealth(now)).resolves.toMatchObject({
      state: "alerted",
      issue: "heartbeat",
    });
    expect(state.emit).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "media.worker.heartbeat",
        severity: "warning",
        admin: expect.objectContaining({
          category: MEDIA_WORKER_ALERT_CATEGORY,
          createCase: true,
          deepLink: "/admin?view=transfers",
        }),
      }),
    );
  });

  it("does not send another email while a media alert remains active", async () => {
    state.active = true;
    await expect(
      monitorMediaWorkerHealth(new Date("2026-09-01T12:20:00.000Z")),
    ).resolves.toMatchObject({ state: "already-alerted", issue: "heartbeat" });
    expect(state.emit).not.toHaveBeenCalled();
    expect(state.resolve).not.toHaveBeenCalled();
  });
});
