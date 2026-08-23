import { log } from "@/lib/platform/logger.server";
import { isDatabaseConfigured, queryOne } from "@/lib/platform/postgres.server";
import { getPitchEnvironmentMode } from "./config.server";
import type { PitchOperationalMode, PitchOperationalStatus } from "./types";

interface PitchSettingsRow {
  mode: PitchOperationalMode;
  updated_at: Date | string;
}

export type PitchOperationAccess = "read" | "write" | "live" | "admin" | "maintenance";

const MODE_WEIGHT: Record<PitchOperationalMode, number> = {
  enabled: 0,
  "read-only": 1,
  off: 2,
};
const CACHE_MS = 5_000;

let cachedAdminMode:
  | { mode: PitchOperationalMode; updatedAt: string; expiresAt: number }
  | undefined;

export class PitchOperationBlockedError extends Error {
  readonly status = 503;

  constructor(message: string) {
    super(message);
    this.name = "PitchOperationBlockedError";
  }
}

function mostRestrictive(
  environmentMode: PitchOperationalMode,
  adminMode: PitchOperationalMode,
): PitchOperationalMode {
  return MODE_WEIGHT[environmentMode] >= MODE_WEIGHT[adminMode] ? environmentMode : adminMode;
}

async function readAdminMode(): Promise<{ mode: PitchOperationalMode; updatedAt?: string }> {
  if (!isDatabaseConfigured()) {
    if (process.env.NODE_ENV === "production")
      throw new Error("Pitch settings storage is unavailable");
    return { mode: "enabled" };
  }
  if (cachedAdminMode && cachedAdminMode.expiresAt > Date.now()) return cachedAdminMode;
  const row = await queryOne<PitchSettingsRow>(
    "select mode, updated_at from pitch_platform_settings where singleton = true",
  );
  const next = {
    mode: row?.mode ?? "enabled",
    updatedAt: row ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
    expiresAt: Date.now() + CACHE_MS,
  };
  cachedAdminMode = next;
  return next;
}

export async function getPitchOperationalStatus(options?: {
  includeConfiguredMode?: boolean;
}): Promise<PitchOperationalStatus> {
  const environment = getPitchEnvironmentMode();
  if (!environment.valid) {
    return {
      environmentMode: "off",
      adminMode: "off",
      effectiveMode: "off",
      canRead: false,
      canWrite: false,
      canPresent: false,
      source: "invalid-environment",
      message: "Pitch Night Studio is off because PITCHES_MODE is invalid.",
    };
  }
  if (environment.mode === "off" && !options?.includeConfiguredMode) {
    return {
      environmentMode: "off",
      adminMode: "off",
      effectiveMode: "off",
      canRead: false,
      canWrite: false,
      canPresent: false,
      source: "environment",
      message: "Pitch Night Studio is temporarily off.",
    };
  }

  try {
    const admin = await readAdminMode();
    const effectiveMode = mostRestrictive(environment.mode, admin.mode);
    const source =
      MODE_WEIGHT[environment.mode] > MODE_WEIGHT[admin.mode] ? "environment" : "configured";
    return {
      environmentMode: environment.mode,
      adminMode: admin.mode,
      effectiveMode,
      canRead: effectiveMode !== "off",
      canWrite: effectiveMode === "enabled",
      canPresent: effectiveMode !== "off",
      source,
      message:
        effectiveMode === "enabled"
          ? "Pitch Night Studio is fully available."
          : effectiveMode === "read-only"
            ? "Server saving is paused. Existing pitches and local exports still work."
            : "Pitch Night Studio is temporarily off.",
      updatedAt: admin.updatedAt,
    };
  } catch (error) {
    log.error("pitches.operational", "Could not read the Pitch Night Studio mode", {}, error);
    return {
      environmentMode: environment.mode,
      adminMode: "off",
      effectiveMode: "off",
      canRead: false,
      canWrite: false,
      canPresent: false,
      source: "storage-unavailable",
      message: "Pitch Night Studio is temporarily unavailable.",
    };
  }
}

export async function setPitchAdminMode(
  mode: PitchOperationalMode,
): Promise<PitchOperationalStatus> {
  const row = await queryOne<PitchSettingsRow>(
    `insert into pitch_platform_settings (singleton, mode, updated_at)
      values (true, $1, now())
      on conflict (singleton) do update set mode = excluded.mode, updated_at = now()
      returning mode, updated_at`,
    [mode],
  );
  if (!row) throw new Error("Could not save the Pitch Night Studio mode");
  cachedAdminMode = {
    mode: row.mode,
    updatedAt: new Date(row.updated_at).toISOString(),
    expiresAt: Date.now() + CACHE_MS,
  };
  const status = await getPitchOperationalStatus({ includeConfiguredMode: true });
  log.info("pitches.operational", "Admin changed the Pitch Night Studio mode", {
    adminMode: mode,
    effectiveMode: status.effectiveMode,
    environmentMode: status.environmentMode,
  });
  return status;
}

export async function assertPitchOperationAllowed(access: PitchOperationAccess): Promise<void> {
  if (access === "admin" || access === "maintenance") return;
  const environment = getPitchEnvironmentMode();
  if (!environment.valid || environment.mode === "off") {
    throw new PitchOperationBlockedError(
      environment.valid
        ? "Pitch Night Studio is temporarily off."
        : "Pitch Night Studio is off because PITCHES_MODE is invalid.",
    );
  }
  if (access === "write" && environment.mode === "read-only") {
    throw new PitchOperationBlockedError(
      "Server saving is paused. Your local copy and downloads still work.",
    );
  }
  const status = await getPitchOperationalStatus();
  if (status.effectiveMode === "off") throw new PitchOperationBlockedError(status.message);
  if (access === "write" && !status.canWrite) {
    throw new PitchOperationBlockedError(
      "Server saving is paused. Your local copy and downloads still work.",
    );
  }
}

export const __pitchOperationalTesting = { mostRestrictive };
