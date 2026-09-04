import { afterAll, beforeAll, expect, it } from "vitest";
import {
  createGamePoolEntrance,
  getDefaultGamePoolPublicLink,
  listGamePoolEntrances,
  openGamePoolRun,
  setGamePoolRunStatus,
  updateGamePoolEntrance,
} from "@/features/things/pool/store.server";
import { listGamePoolsForAdmin } from "@/features/things/pool/admin.server";
import { getGamePoolOperatorView } from "@/features/things/pool/operator.server";
import { GAME_POOL_DEFAULTS } from "@/features/things/pool/presets";
import { getGamePoolPublicView } from "@/features/things/pool/pool.server";
import { cleanupGamePools } from "@/features/things/pool/operations.server";
import { runMigrations } from "@/lib/platform/migrations.server";
import { expireStaleGamePoolAssignments } from "@/features/things/pool/membership.server";
import { transaction } from "@/lib/platform/postgres.server";
import { query } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase } from "../helpers/postgres";

describeWithDatabase("game-pool public defaults (postgres)", () => {
  beforeAll(applySchema);
  afterAll(closeDatabase);

  it("retains the same membership through a two-minute phone break and releases abandoned seats", async () => {
    const entrance = await createGamePoolEntrance({
      game: "same-brain",
      label: "Phone break",
      actionId: "phone-break-entrance",
    });
    const opened = await openGamePoolRun(entrance.id, { actionId: "phone-break-run" });
    const runId = opened!.run!.id;
    await query(
      "insert into game_pool_rooms(run_id,room_id,capacity,player_count) values ($1,'BREAK1',8,1)",
      [runId],
    );
    await query(
      "insert into game_pool_assignments(id,run_id,room_id,client_id,player_id,display_name,last_seen_at) values ('gpa_abcdefghijklmnopqrstuv',$1,'BREAK1','phone-break-client','same-player','Player',now()-interval '2 minutes')",
      [runId],
    );
    expect(
      await transaction((client) => expireStaleGamePoolAssignments(client, runId)),
    ).toMatchObject({ staleAssignments: 0 });
    expect(
      (
        await query("select player_id,status from game_pool_assignments where run_id=$1", [runId])
      )[0],
    ).toEqual({ player_id: "same-player", status: "active" });
    await query(
      "update game_pool_assignments set last_seen_at=now()-interval '7 hours' where run_id=$1",
      [runId],
    );
    expect(
      await transaction((client) => expireStaleGamePoolAssignments(client, runId)),
    ).toMatchObject({ staleAssignments: 1 });
    await query("delete from game_pool_entrances where id=$1", [entrance.id]);
  });

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

  it("updates the active run for future rooms without changing existing rooms", async () => {
    const entrance = await createGamePoolEntrance({
      game: "twin",
      label: "Mutable Twin",
      actionId: "mutable-twin-entrance",
    });
    const opened = await openGamePoolRun(entrance.id, {
      actionId: "mutable-twin-run",
      durationMinutes: 60,
    });
    if (!opened?.run) throw new Error("Could not open the mutable test pool");
    await query(
      `insert into game_pool_rooms (run_id, room_id, player_count, capacity)
       values ($1, 'TWIN234', 3, 12)`,
      [opened.run.id],
    );

    const updated = await updateGamePoolEntrance(entrance.id, {
      gameSettings: {
        format: "milk-and-henny/game-settings",
        schemaVersion: 1,
        game: "twin",
        settings: { game: "twin", handSize: 9 },
      },
      targetSize: 8,
      allowRoomChoice: false,
      allowNewRooms: false,
    });
    const runs = await query<{
      preset: { handSize: number };
      target_size: number;
      allow_room_choice: boolean;
      allow_new_rooms: boolean;
    }>(
      "select preset, target_size, allow_room_choice, allow_new_rooms from game_pool_runs where id = $1",
      [opened.run.id],
    );
    const rooms = await query<{ player_count: number; capacity: number }>(
      "select player_count, capacity from game_pool_rooms where run_id = $1 and room_id = 'TWIN234'",
      [opened.run.id],
    );

    expect(updated?.run?.gameSettings.settings).toEqual({ game: "twin", handSize: 9 });
    expect(updated?.run).toMatchObject({
      targetSize: 8,
      allowRoomChoice: false,
      allowNewRooms: false,
    });
    expect(runs[0]).toMatchObject({
      preset: { game: "twin", handSize: 9 },
      target_size: 8,
      allow_room_choice: false,
      allow_new_rooms: false,
    });
    expect(rooms[0]).toEqual({ player_count: 3, capacity: 12 });
  });

  it("stops exposing an elapsed run and allows an admin to open the next one", async () => {
    const entrance = await createGamePoolEntrance({
      game: "hot-and-cold",
      label: "Timed entrance",
      actionId: "expired-pool-entrance",
    });
    const expired = await openGamePoolRun(entrance.id, {
      actionId: "expired-pool-run",
      durationMinutes: 15,
    });
    if (!expired?.run) throw new Error("Could not open the timed test pool");

    await query("update game_pool_runs set closes_at = now() - interval '1 minute' where id = $1", [
      expired.run.id,
    ]);

    expect((await listGamePoolEntrances()).find(({ id }) => id === entrance.id)?.run).toBeNull();
    await expect(getGamePoolOperatorView(expired.operatorToken)).resolves.toMatchObject({
      found: true,
      status: "closed",
    });

    const next = await openGamePoolRun(entrance.id, {
      actionId: "replacement-pool-run",
      durationMinutes: 60,
    });
    expect(next?.run).toMatchObject({ status: "open" });
    expect(next?.run?.id).not.toBe(expired.run.id);
  });

  it("opens and closes a scheduled entrance without an admin session", async () => {
    const entrance = await createGamePoolEntrance({
      game: "centre",
      label: "Scheduled Centre",
      actionId: "scheduled-centre-entrance",
    });
    const scheduledOpenAt = new Date(Date.now() - 60_000).toISOString();
    const scheduledCloseAt = new Date(Date.now() + 60 * 60_000).toISOString();
    await updateGamePoolEntrance(entrance.id, { scheduledOpenAt, scheduledCloseAt });

    await expect(cleanupGamePools()).resolves.toMatchObject({ openedRuns: 1 });
    expect((await listGamePoolEntrances()).find(({ id }) => id === entrance.id)).toMatchObject({
      scheduledOpenAt,
      scheduledCloseAt,
      run: { status: "open", closesAt: scheduledCloseAt },
    });

    await updateGamePoolEntrance(entrance.id, {
      scheduledCloseAt: new Date(Date.now() - 1_000).toISOString(),
    });
    await expect(cleanupGamePools()).resolves.toMatchObject({ closedRuns: 1, openedRuns: 0 });
    expect((await listGamePoolEntrances()).find(({ id }) => id === entrance.id)?.run).toBeNull();
  });

  it("inherits its event game window and reconciles a changed closing time", async () => {
    const entrance = await createGamePoolEntrance({
      game: "draw-country",
      label: "Inherited Draw",
      actionId: "inherited-draw-entrance",
    });
    const gamesOpenAt = new Date(Date.now() - 60_000).toISOString();
    const firstCloseAt = new Date(Date.now() + 60 * 60_000).toISOString();
    const revisedCloseAt = new Date(Date.now() + 30 * 60_000).toISOString();
    await query(
      `insert into events (slug,title,status,starts_at,timezone)
       values ('pool-schedule-night','Pool Schedule Night','published',now(),'Europe/London')`,
    );
    await query(
      `insert into event_scoring_settings
         (event_slug,state,games_open_at,games_close_at)
       values ('pool-schedule-night','ready',$1,$2)`,
      [gamesOpenAt, firstCloseAt],
    );
    await query(
      `insert into score_activities
         (id,event_slug,name,template,status,rule)
       values ('pool-schedule-activity','pool-schedule-night','Draw','completion','live',
               '{"mode":"fixed","fixedPoints":2,"repeat":"repeat","requiresCheckIn":false}')`,
    );
    await query(
      `insert into event_game_register
         (id,event_slug,game_key,label,play_mode,pool_entrance_id,award_method,
          activity_ids,status,created_by)
       values ('pool-schedule-register','pool-schedule-night','draw-country','Draw the Country',
               'pooled',$1,'automatic',array['pool-schedule-activity'],'included','test')`,
      [entrance.id],
    );

    await expect(cleanupGamePools()).resolves.toMatchObject({ openedRuns: 1 });
    expect((await listGamePoolEntrances()).find(({ id }) => id === entrance.id)?.run).toMatchObject(
      { status: "open", closesAt: firstCloseAt },
    );

    await query(`update event_scoring_settings set games_close_at = $2 where event_slug = $1`, [
      "pool-schedule-night",
      revisedCloseAt,
    ]);
    await expect(cleanupGamePools()).resolves.toMatchObject({ openedRuns: 0 });
    expect((await listGamePoolEntrances()).find(({ id }) => id === entrance.id)?.run).toMatchObject(
      { status: "open", closesAt: revisedCloseAt },
    );
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

  it("moves configured pools onto the current settings contract", async () => {
    const obsolete = {
      game: "same-brain",
      rounds: 8,
      scoring: "embedding",
      sayItAloud: true,
      eliminateOddOne: false,
    };
    await query(`update game_pool_entrances set preset = $1::jsonb where game = 'same-brain'`, [
      JSON.stringify(obsolete),
    ]);
    await query(
      `update game_pool_runs run set preset = $1::jsonb
        from game_pool_entrances entrance
       where entrance.id = run.entrance_id and entrance.game = 'same-brain'`,
      [JSON.stringify(obsolete)],
    );
    await query(`delete from schema_migrations where id = '0059_game_pool_current_settings'`);

    await runMigrations();

    await expect(listGamePoolsForAdmin()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          game: "same-brain",
          gameSettings: GAME_POOL_DEFAULTS["same-brain"].gameSettings,
        }),
      ]),
    );
    await expect(
      createGamePoolEntrance({
        game: "hot-and-cold",
        actionId: "current-settings-hot-and-cold",
      }),
    ).resolves.toMatchObject({ game: "hot-and-cold" });
  });
});
