import { Effect } from "effect";
import { getPitchOperationalStatus } from "./operational.server";
import { runPitchesResult } from "./pitches-runtime.server";
import { PitchesService } from "./pitches-service.server";

export async function getAdminPitchWorkspace(signal?: AbortSignal) {
  const [result, operationalStatus] = await Promise.all([
    runPitchesResult(
      Effect.gen(function* () {
        return yield* (yield* PitchesService).listAdmin();
      }),
      signal,
    ),
    getPitchOperationalStatus({ includeConfiguredMode: true }),
  ]);
  return result.ok
    ? { ok: true as const, pitches: result.value, operationalStatus }
    : { ok: false as const, status: result.status, error: result.error };
}

export function getAdminPitchReminders(signal?: AbortSignal) {
  return runPitchesResult(
    Effect.gen(function* () {
      return yield* (yield* PitchesService).reminderAdmin();
    }),
    signal,
  );
}
