import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform/redis.server", () => ({ getRedis: () => null }));
vi.mock("@/lib/platform/redis-direct.server", () => ({ getDirectRedisConfig: () => null }));
vi.mock("@/lib/platform/logger.server", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  applyCentreAction,
  createCentreRoom,
  joinCentreRoom,
  readCentreSnapshot,
} from "@/features/things/centre/centre-room.server";
import {
  createDrawCountryRoom,
  joinDrawCountryRoom,
} from "@/features/things/draw-country/draw-country-room.server";
import { createLiarsRoom, joinLiarsRoom } from "@/features/things/liars/liars-room.server";
import {
  applySameBrainPlayerAction,
  createSameBrainRoom,
  joinSameBrainRoom,
  readSameBrainSnapshot,
} from "@/features/things/same-brain/same-brain-room.server";
import { createTwinRoom, joinTwinRoom } from "@/features/things/twin/twin-room.server";

describe("game-pool managed admission", () => {
  it("requires the server-held invite for Same Brain and Liars", async () => {
    const sameBrain = await createSameBrainRoom({ managed: true });
    await expect(
      joinSameBrainRoom({ roomId: sameBrain.roomId, name: "Ada", joinId: "join-ada" }),
    ).resolves.toMatchObject({ ok: false, errorCode: "invite_expired" });
    await expect(
      joinSameBrainRoom({
        roomId: sameBrain.roomId,
        joinToken: sameBrain.joinToken,
        hostToken: sameBrain.hostToken,
        name: "Ada",
        joinId: "join-ada",
      }),
    ).resolves.toMatchObject({ ok: true });

    const liars = await createLiarsRoom({
      managed: true,
      mode: "mafia",
      roomMode: "same-room",
    });
    await expect(
      joinLiarsRoom({ roomId: liars.roomId, name: "Bea", joinId: "join-bea" }),
    ).resolves.toMatchObject({ ok: false, errorCode: "invite_expired" });
    await expect(
      joinLiarsRoom({
        roomId: liars.roomId,
        joinToken: liars.joinToken,
        name: "Bea",
        joinId: "join-bea",
      }),
    ).resolves.toMatchObject({ ok: true });
  });

  it("requires the server-held invite for all action games", async () => {
    const centre = await createCentreRoom({
      managed: true,
      hostName: "Ada",
      difficulty: 3,
      delayedRivals: false,
    });
    await expect(joinCentreRoom({ roomId: centre.roomId, name: "Bea" })).resolves.toMatchObject({
      ok: false,
      errorCode: "invite_expired",
    });

    const twin = await createTwinRoom({ managed: true, hostName: "Ada", handSize: 8 });
    await expect(joinTwinRoom({ roomId: twin.roomId, name: "Bea" })).resolves.toMatchObject({
      ok: false,
      errorCode: "invite_expired",
    });

    const draw = await createDrawCountryRoom({
      managed: true,
      hostName: "Ada",
      drawSeconds: 45,
      roundTotal: 5,
      recentCountryIds: [],
    });
    await expect(joinDrawCountryRoom({ roomId: draw.roomId, name: "Bea" })).resolves.toMatchObject({
      ok: false,
      errorCode: "invite_expired",
    });
  });

  it("transfers room control after the first participant leaves", async () => {
    const room = await createSameBrainRoom({ managed: true });
    const first = await joinSameBrainRoom({
      roomId: room.roomId,
      joinToken: room.joinToken,
      hostToken: room.hostToken,
      name: "Ada",
      joinId: "leave-ada",
    });
    const second = await joinSameBrainRoom({
      roomId: room.roomId,
      joinToken: room.joinToken,
      name: "Bea",
      joinId: "leave-bea",
    });
    if (!first.ok || !second.ok) throw new Error("Could not create the test room");
    await expect(
      applySameBrainPlayerAction({
        roomId: room.roomId,
        playerId: first.playerId,
        playerToken: first.playerToken,
        action: { type: "room.leave", actionId: "leave-first" },
      }),
    ).resolves.toMatchObject({ accepted: true });
    const socialView = await readSameBrainSnapshot({
      roomId: room.roomId,
      playerId: second.playerId,
      credential: second.playerToken,
      lastSequence: 0,
    });
    expect(socialView.snapshot?.hostPlayerId).toBe(second.playerId);

    const centre = await createCentreRoom({
      managed: true,
      hostName: "Ada",
      difficulty: 3,
      delayedRivals: false,
    });
    const centreSecond = await joinCentreRoom({
      roomId: centre.roomId,
      joinToken: centre.joinToken,
      name: "Bea",
    });
    if (!centreSecond.ok) throw new Error("Could not create the action room");
    await expect(
      applyCentreAction({
        roomId: centre.roomId,
        playerId: centre.playerId,
        playerToken: centre.playerToken,
        action: { type: "player.leave" },
      }),
    ).resolves.toMatchObject({ ok: true, accepted: true });
    const actionView = await readCentreSnapshot({
      roomId: centre.roomId,
      playerId: centreSecond.playerId,
      playerToken: centreSecond.playerToken,
      lastSequence: 0,
      lastDigest: null,
    });
    expect(actionView.snapshot?.hostPlayerId).toBe(centreSecond.playerId);
  });

  it("does not apply the same action ticket twice", async () => {
    const room = await createCentreRoom({
      managed: true,
      hostName: "Ada",
      difficulty: 3,
      delayedRivals: false,
    });
    const action = {
      actionId: "same-readiness-action",
      type: "readiness.set" as const,
      ready: false,
    };
    const first = await applyCentreAction({
      roomId: room.roomId,
      playerId: room.playerId,
      playerToken: room.playerToken,
      action,
    });
    const repeated = await applyCentreAction({
      roomId: room.roomId,
      playerId: room.playerId,
      playerToken: room.playerToken,
      action,
    });
    expect(first).toMatchObject({ ok: true, accepted: true });
    expect(repeated).toMatchObject({ ok: true, accepted: true });
    expect(repeated.snapshot?.revision).toBe(first.snapshot?.revision);
  });
});
