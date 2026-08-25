import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  binding: null as { event_slug: string; channel_id: string } | null,
  participantId: undefined as string | undefined,
  links: [] as Array<{ channelId: string; gamePlayerId: string; participantId: string }>,
}));

vi.mock("@/lib/platform/postgres.server", () => ({
  queryOne: async () => state.binding,
}));
vi.mock("@/features/event-scoring/session.server", () => ({
  activeParticipantForEvent: async () => state.participantId,
}));
vi.mock("@/features/event-scoring/games.server", () => ({
  linkGamePlayer: async (input: (typeof state.links)[number]) => {
    state.links.push(input);
    return { ok: true };
  },
}));

import { linkCurrentAttendeeGamePlayer } from "@/features/event-scoring/game-player-identity.server";

describe("event game player identity", () => {
  beforeEach(() => {
    state.binding = null;
    state.participantId = undefined;
    state.links = [];
  });

  it("links a managed game player to the resolved signed-in participant", async () => {
    state.binding = { event_slug: "night", channel_id: "channel" };
    state.participantId = "participant";
    await linkCurrentAttendeeGamePlayer({
      gameKind: "same-brain",
      gameInstanceId: "room",
      gamePlayerId: "player",
    });
    expect(state.links).toEqual([
      { channelId: "channel", gamePlayerId: "player", participantId: "participant" },
    ]);
  });

  it("does not guess when the attendee has no unambiguous event participant", async () => {
    state.binding = { event_slug: "night", channel_id: "channel" };
    await linkCurrentAttendeeGamePlayer({
      gameKind: "same-brain",
      gameInstanceId: "room",
      gamePlayerId: "player",
    });
    expect(state.links).toEqual([]);
  });
});
