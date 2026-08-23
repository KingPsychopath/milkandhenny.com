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
});
