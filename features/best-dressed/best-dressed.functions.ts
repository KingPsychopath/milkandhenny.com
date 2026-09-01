import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { Effect } from "effect";
import { requireAdminStepUp, authenticateRequest } from "@/features/auth/auth.server";
import { runMultiplayerEffect } from "@/features/things/shared/multiplayer-runtime.server";
import { BestDressedService } from "./best-dressed-service.server";
import type { VoteInput } from "./best-dressed.server";

function runBestDressed<A>(
  request: Request,
  use: (service: typeof BestDressedService.Service) => Effect.Effect<A, unknown>,
) {
  return runMultiplayerEffect(
    Effect.gen(function* () {
      return yield* use(yield* BestDressedService);
    }),
    request.signal,
  );
}

export const getBestDressedSnapshotFn = createServerFn({ method: "GET" }).handler(() => {
  const request = getRequest();
  return runBestDressed(request, (service) => service.snapshot);
});

export const voteBestDressedFn = createServerFn({ method: "POST" })
  .validator((data: VoteInput) => data)
  .handler(({ data }) => {
    const request = getRequest();
    return runBestDressed(request, (service) => service.vote(data));
  });

export const searchBestDressedGuestsFn = createServerFn({ method: "POST" })
  .validator((data: { query: string; voteToken: string; code?: string }) => data)
  .handler(({ data }) => {
    const request = getRequest();
    return runBestDressed(request, (service) => service.search(data));
  });

export const getBestDressedLeaderboardFn = createServerFn({ method: "GET" }).handler(() => {
  const request = getRequest();
  return runBestDressed(request, (service) => service.leaderboard);
});

export const clearBestDressedVotesFn = createServerFn({ method: "POST" }).handler(async () => {
  const request = getRequest();
  const auth = await authenticateRequest(request, "admin");
  if (!auth.ok) return { ok: false as const, status: auth.status, error: auth.error };

  const stepUpError = await requireAdminStepUp(request);
  if (stepUpError) {
    const result: unknown = await stepUpError.json().catch(() => null);
    const error =
      result && typeof result === "object" && "error" in result && typeof result.error === "string"
        ? result.error
        : "Unauthorized";
    return { ok: false as const, status: stepUpError.status, error };
  }

  const result = await runBestDressed(request, (service) => service.clear);
  return { ok: true as const, session: result.session };
});
