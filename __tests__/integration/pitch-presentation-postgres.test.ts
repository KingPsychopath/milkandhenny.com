import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";

const deckId = vi.hoisted(() => "p_1234567890123456789012");
vi.mock("@/features/things/pitches/store.server", () => ({
  readPublicPitchDeck: vi.fn(async (id: string) =>
    id === deckId
      ? {
          id,
          publishedDocument: {
            slides: [{ id: "first" }, { id: "second" }],
          },
        }
      : null,
  ),
}));

import {
  approvePresentationController,
  controlPresentation,
  createPresentationRoom,
  joinPresentation,
  readPresentation,
} from "@/features/things/pitches/presentation.server";
import { query } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase } from "../helpers/postgres";

describeWithDatabase("Postgres pitch presentation rooms", () => {
  beforeAll(applySchema);
  afterAll(closeDatabase);
  afterEach(() => vi.unstubAllEnvs());

  it("recovers controllers and replays slide commands from committed state", async () => {
    vi.stubEnv("PITCH_PRESENTATION_STORE", "postgres");
    const room = await createPresentationRoom("Pitch Night");
    const [bob, cy] = await Promise.all([
      joinPresentation(room.credentials.roomId, "Bob"),
      joinPresentation(room.credentials.roomId, "Cy"),
    ]);
    if (!bob.ok || !cy.ok) throw new Error("Expected both controllers to join");
    const publicView = await readPresentation(room.credentials.roomId);
    expect(publicView.ok && publicView.value.controllers).toEqual([]);
    const beforeRead = await query<{ revision: string }>(
      "select revision::text from multiplayer_rooms where kind='pitch-presentation' and room_id=$1",
      [room.credentials.roomId],
    );
    await readPresentation(room.credentials.roomId);
    expect(
      await query<{ revision: string }>(
        "select revision::text from multiplayer_rooms where kind='pitch-presentation' and room_id=$1",
        [room.credentials.roomId],
      ),
    ).toEqual(beforeRead);
    expect(
      await query<{ controller_count: number }>(
        "select jsonb_array_length(state->'controllers') as controller_count from multiplayer_rooms where kind='pitch-presentation' and room_id=$1",
        [room.credentials.roomId],
      ),
    ).toEqual([{ controller_count: 2 }]);

    const pending = await controlPresentation({
      roomId: room.credentials.roomId,
      credential: bob.value.controllerToken,
      controllerId: bob.value.controllerId,
      actionId: "pending",
      action: { type: "select", deckId },
    });
    expect(pending).toMatchObject({ ok: false, status: 403 });
    expect(
      await approvePresentationController({
        roomId: room.credentials.roomId,
        hostToken: room.credentials.hostToken,
        controllerId: bob.value.controllerId,
        approved: true,
      }),
    ).toMatchObject({ ok: true });
    const selected = await controlPresentation({
      roomId: room.credentials.roomId,
      credential: bob.value.controllerToken,
      controllerId: bob.value.controllerId,
      actionId: "select",
      action: { type: "select", deckId },
    });
    expect(selected.ok && selected.value.slideIndex).toBe(0);
    const action = {
      roomId: room.credentials.roomId,
      credential: room.credentials.hostToken,
      actionId: "advance",
      action: { type: "go" as const, direction: 1 as const },
    };
    const advanced = await controlPresentation(action);
    const replay = await controlPresentation(action);
    expect(advanced.ok && advanced.value.slideIndex).toBe(1);
    expect(replay).toEqual(advanced);
    const recovered = await readPresentation(room.credentials.roomId, {
      hostToken: room.credentials.hostToken,
    });
    expect(recovered.ok && recovered.value.slideIndex).toBe(1);
  });
});
