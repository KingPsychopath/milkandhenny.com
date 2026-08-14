import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform/redis.server", () => ({ getRedis: () => null }));

const publishedDeck = {
  id: "p_1234567890123456789012",
  ownerName: "Alice",
  ownerEmail: "alice@example.com",
  title: "A public pitch",
  lifecycle: "active" as const,
  draftDocument: {
    schemaVersion: 1 as const,
    slides: [],
  },
  draftVersion: 1,
  publishedDocument: {
    schemaVersion: 1 as const,
    slides: [
      {
        id: "slide_123456",
        name: "One",
        version: 1,
        updatedAt: 1,
        durationMs: 15_000,
        elements: [],
        assetIds: {},
        audioCues: [],
      },
      {
        id: "slide_234567",
        name: "Two",
        version: 1,
        updatedAt: 1,
        durationMs: 15_000,
        elements: [],
        assetIds: {},
        audioCues: [],
      },
    ],
  },
  publishedVersion: 1,
  draftExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  publishedAt: new Date().toISOString(),
};

vi.mock("@/features/things/pitches/store.server", () => ({
  readPublicPitchDeck: vi.fn(async (deckId: string) =>
    deckId === publishedDeck.id ? publishedDeck : null,
  ),
}));

describe("pitch presentation rooms", () => {
  beforeAll(() => {
    process.env.NODE_ENV = "test";
  });

  it("keeps controllers private, requires approval, and applies actions once", async () => {
    const {
      approvePresentationController,
      controlPresentation,
      createPresentationRoom,
      joinPresentation,
      readPresentation,
    } = await import("@/features/things/pitches/presentation.server");

    const room = await createPresentationRoom("Pitch Night");
    const joined = await joinPresentation(room.credentials.roomId, "Bob");
    expect(joined.ok).toBe(true);
    if (!joined.ok) return;

    const publicSnapshot = await readPresentation(room.credentials.roomId);
    expect(publicSnapshot.ok && publicSnapshot.value.controllers).toEqual([]);

    const pendingControl = await controlPresentation({
      roomId: room.credentials.roomId,
      credential: joined.value.controllerToken,
      controllerId: joined.value.controllerId,
      actionId: "action_pending",
      action: { type: "select", deckId: publishedDeck.id },
    });
    expect(pendingControl).toMatchObject({ ok: false, status: 403 });

    const approved = await approvePresentationController({
      roomId: room.credentials.roomId,
      hostToken: room.credentials.hostToken,
      controllerId: joined.value.controllerId,
      approved: true,
    });
    expect(approved.ok).toBe(true);

    const selected = await controlPresentation({
      roomId: room.credentials.roomId,
      credential: joined.value.controllerToken,
      controllerId: joined.value.controllerId,
      actionId: "action_select",
      action: { type: "select", deckId: publishedDeck.id },
    });
    expect(selected.ok && selected.value.slideIndex).toBe(0);

    const advanced = await controlPresentation({
      roomId: room.credentials.roomId,
      credential: room.credentials.hostToken,
      actionId: "action_advance",
      action: { type: "go", direction: 1 },
    });
    expect(advanced.ok && advanced.value.slideIndex).toBe(1);
    if (!advanced.ok) return;

    const replay = await controlPresentation({
      roomId: room.credentials.roomId,
      credential: room.credentials.hostToken,
      actionId: "action_advance",
      action: { type: "go", direction: 1 },
    });
    expect(replay.ok && replay.value.revision).toBe(advanced.value.revision);
    expect(replay.ok && replay.value.slideIndex).toBe(1);
  });
});
