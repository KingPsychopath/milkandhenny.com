import { afterAll, beforeAll, expect, it } from "vitest";
import {
  createGamePoolEntrance,
  getDefaultGamePoolPublicLink,
  listGamePoolEntrances,
  openGamePoolRun,
  setGamePoolRunStatus,
  updateGamePoolEntrance,
} from "@/features/things/pool/store.server";
import { GAME_POOL_DEFAULTS } from "@/features/things/pool/presets";
import { getGamePoolPublicView } from "@/features/things/pool/pool.server";
import { query } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase } from "../helpers/postgres";

describeWithDatabase("game-pool public defaults (postgres)", () => {
  beforeAll(applySchema);
  afterAll(closeDatabase);

  it("starts a recommended permanent pool on a game's first public visit", async () => {
    const launch = await getDefaultGamePoolPublicLink("twin");
    const entrance = (await listGamePoolEntrances()).find(({ game }) => game === "twin");

    expect(launch).toMatchObject({ game: "twin", label: GAME_POOL_DEFAULTS.twin.label });
    expect(launch?.path).toMatch(/^\/play\/play_[A-Za-z0-9_-]{26,}$/);
    expect(entrance).toMatchObject({
      isDefault: true,
      targetSize: GAME_POOL_DEFAULTS.twin.targetSize,
      autoJoin: true,
      allowRoomChoice: true,
      allowNewRooms: true,
      nameVisibility: "initials",
      run: { status: "open", closesAt: null },
    });
  });

  it("keeps one selected default and exposes it only while admission is open", async () => {
    const first = await createGamePoolEntrance({
      game: "same-brain",
      label: "First table",
      actionId: "default-pool-first",
    });
    const second = await createGamePoolEntrance({
      game: "same-brain",
      label: "Second table",
      actionId: "default-pool-second",
    });

    expect(first.isDefault).toBe(true);
    expect(second.isDefault).toBe(false);
    expect(await getDefaultGamePoolPublicLink("same-brain")).toBeNull();

    await updateGamePoolEntrance(second.id, { isDefault: true });
    await updateGamePoolEntrance(first.id, { label: "Renamed first table" });
    const entrances = await listGamePoolEntrances();
    const sameBrainEntrances = entrances.filter(({ game }) => game === "same-brain");
    expect(sameBrainEntrances.filter((entrance) => entrance.isDefault)).toHaveLength(1);
    expect(sameBrainEntrances.find((entrance) => entrance.isDefault)?.id).toBe(second.id);

    const open = await openGamePoolRun(second.id, {
      actionId: "open-default-pool",
      durationMinutes: 60,
    });
    expect(await getDefaultGamePoolPublicLink("same-brain")).toEqual({
      game: "same-brain",
      label: "Second table",
      path: `/play/${open?.token}`,
    });

    await setGamePoolRunStatus(second.id, "paused");
    expect(await getDefaultGamePoolPublicLink("same-brain")).toBeNull();
  });

  it("serializes two admins selecting different defaults at once", async () => {
    const first = await createGamePoolEntrance({
      game: "centre",
      label: "Centre A",
      actionId: "centre-default-a",
    });
    const second = await createGamePoolEntrance({
      game: "centre",
      label: "Centre B",
      actionId: "centre-default-b",
    });

    await Promise.all([
      updateGamePoolEntrance(first.id, { isDefault: true }),
      updateGamePoolEntrance(second.id, { isDefault: true }),
    ]);

    const defaults = (await listGamePoolEntrances()).filter(
      (entrance) => entrance.game === "centre" && entrance.isDefault,
    );
    expect(defaults).toHaveLength(1);
    expect([first.id, second.id]).toContain(defaults[0]?.id);
  });

  it("exposes stable per-run sprite identities without exposing assignment ids", async () => {
    const entrance = await createGamePoolEntrance({
      game: "liars",
      label: "Private lobby",
      nameVisibility: "initials",
      actionId: "sprite-public-view",
    });
    const opened = await openGamePoolRun(entrance.id, {
      actionId: "sprite-public-view-run",
      durationMinutes: 60,
    });
    if (!opened?.run) throw new Error("Could not open the test pool");

    const assignmentId = "gpa_1234567890123456789012";
    await query(
      `insert into game_pool_rooms (run_id, room_id, player_count, capacity)
       values ($1, 'ABCD234', 1, 9)`,
      [opened.run.id],
    );
    await query(
      `insert into game_pool_assignments
       (id, run_id, room_id, client_id, player_id, display_name)
       values ($1, $2, 'ABCD234', 'sprite-client-id', 'player-secret', 'Abel')`,
      [assignmentId, opened.run.id],
    );

    const first = await getGamePoolPublicView(opened.token);
    const second = await getGamePoolPublicView(opened.token);
    const firstOccupant = first.rooms?.[0]?.occupants[0];
    const secondOccupant = second.rooms?.[0]?.occupants[0];

    expect(firstOccupant).toMatchObject({ label: "A" });
    expect(firstOccupant?.id).toBe(secondOccupant?.id);
    expect(firstOccupant?.id).not.toContain(assignmentId);
    expect(JSON.stringify(first)).not.toContain("player-secret");
    expect(JSON.stringify(first)).not.toContain("sprite-client-id");
  });
});
