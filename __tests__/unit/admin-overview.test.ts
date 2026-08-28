import { describe, expect, it } from "vitest";

import { getAdminAttentionItems } from "@/features/admin/ui/components/AdminOverviewPanel";

type Content = NonNullable<Parameters<typeof getAdminAttentionItems>[0]>;
type System = NonNullable<Parameters<typeof getAdminAttentionItems>[1]>;

const content: Content = {
  blog: {
    totalPosts: 2,
    featuredPosts: 1,
    postsWithImages: 2,
    totalReadingMinutes: 8,
    latestPostDate: "2026-08-24T00:00:00.000Z",
  },
  gallery: {
    totalAlbums: 1,
    totalPhotos: 4,
    albumsWithoutDescription: 0,
    invalidAlbumCount: 0,
    latestAlbumDate: "2026-08-24T00:00:00.000Z",
  },
};

const system: System = {
  status: "healthy",
  timestamp: "2026-08-24T00:00:00.000Z",
  runtime: { environment: "test", version: "test", commit: null },
  capabilities: [
    {
      id: "database",
      label: "application database",
      status: "available",
      required: true,
      detail: "Reachable.",
    },
  ],
  emailOutbox: {
    available: true,
    pending: 0,
    processing: 0,
    accepted: 2,
    failed: 0,
    cancelled: 0,
    delivered: 2,
    awaitingProviderFeedback: 0,
    oldestPendingAt: null,
    latestDeliveryEventAt: "2026-08-24T00:00:00.000Z",
  },
  mediaQueue: {
    available: true,
    enabled: true,
    queued: 0,
    leased: 0,
    permanentFailures: 0,
    backlogAgeMs: null,
  },
  securityWarnings: [],
};

describe("admin overview attention", () => {
  it("stays clear when required services and queues are healthy", () => {
    expect(getAdminAttentionItems(content, system)).toEqual([]);
  });

  it("uses unresolved delivery cases instead of historical outbox failures", () => {
    const withHistoricalFailures = {
      ...system,
      emailOutbox: { ...system.emailOutbox, failed: 2 },
    };

    expect(getAdminAttentionItems(content, withHistoricalFailures)).toEqual([]);
    expect(
      getAdminAttentionItems(content, withHistoricalFailures, { "email-delivery": 1 }),
    ).toMatchObject([
      {
        id: "email:delivery-attention",
        title: "1 email delivery issue needs review",
        destination: { section: "communications", communicationTab: "delivery" },
      },
    ]);
  });

  it("keeps distinct failures visible and routes them to an action area", () => {
    const items = getAdminAttentionItems(
      {
        ...content,
        gallery: { ...content.gallery, invalidAlbumCount: 1 },
      },
      {
        ...system,
        status: "degraded",
        capabilities: [
          {
            id: "database",
            label: "application database",
            status: "unavailable",
            required: true,
            detail: "Configured but unreachable.",
          },
        ],
        mediaQueue: {
          ...system.mediaQueue,
          available: false,
          reason: "The queue could not be inspected.",
        },
        securityWarnings: ["Admin secret is too short."],
      },
    );

    expect(items.map(({ id, destination }) => ({ id, destination }))).toEqual([
      { id: "capability:database", destination: { section: "system" } },
      { id: "content:invalid-albums", destination: { section: "content" } },
      { id: "media:unavailable", destination: { section: "transfers" } },
      {
        id: "security:0:Admin secret is too short.",
        destination: { section: "system" },
      },
    ]);
  });
});
