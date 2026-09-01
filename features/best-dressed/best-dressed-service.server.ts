import { Context, Data, Effect, Layer } from "effect";
import type { Redis } from "@upstash/redis";

import { withOperationSignal } from "@/lib/platform/operation-context.server";
import { RedisService } from "@/lib/platform/provider-services.server";
import { withRedisProvider } from "@/lib/platform/redis-provider-context.server";
import {
  clearBestDressedVotes,
  getBestDressedLeaderboardSnapshot,
  getBestDressedSnapshot,
  getBestDressedVotingWindow,
  mintBestDressedCodes,
  revokeAllBestDressedCodes,
  searchBestDressedGuests,
  setBestDressedVotingWindow,
  voteBestDressed,
} from "./best-dressed.server";

export class BestDressedOperationError extends Data.TaggedError("BestDressedOperationError")<{
  readonly cause: unknown;
  readonly operation: string;
}> {}

function attempt<A>(client: Redis | null, operation: string, run: () => Promise<A>) {
  return Effect.tryPromise({
    try: (signal) => withOperationSignal(signal, () => withRedisProvider(client, run)),
    catch: (cause) => new BestDressedOperationError({ cause, operation }),
  }).pipe(
    Effect.timeout(30_000),
    Effect.mapError((cause) =>
      cause instanceof BestDressedOperationError
        ? cause
        : new BestDressedOperationError({ cause, operation }),
    ),
    Effect.withSpan(`best_dressed.${operation}`),
  );
}

/** Multi-command voting workflows run on the existing Multiplayer runtime. */
export class BestDressedService extends Context.Service<
  BestDressedService,
  {
    readonly clear: ReturnType<typeof attempt<Awaited<ReturnType<typeof clearBestDressedVotes>>>>;
    readonly getVotingWindow: ReturnType<
      typeof attempt<Awaited<ReturnType<typeof getBestDressedVotingWindow>>>
    >;
    readonly leaderboard: ReturnType<
      typeof attempt<Awaited<ReturnType<typeof getBestDressedLeaderboardSnapshot>>>
    >;
    readonly mintCodes: (
      input: Parameters<typeof mintBestDressedCodes>[0],
    ) => ReturnType<typeof attempt<Awaited<ReturnType<typeof mintBestDressedCodes>>>>;
    readonly revokeCodes: ReturnType<
      typeof attempt<Awaited<ReturnType<typeof revokeAllBestDressedCodes>>>
    >;
    readonly search: (
      input: Parameters<typeof searchBestDressedGuests>[0],
    ) => ReturnType<typeof attempt<Awaited<ReturnType<typeof searchBestDressedGuests>>>>;
    readonly setVotingWindow: (
      minutes: unknown,
    ) => ReturnType<typeof attempt<Awaited<ReturnType<typeof setBestDressedVotingWindow>>>>;
    readonly snapshot: ReturnType<
      typeof attempt<Awaited<ReturnType<typeof getBestDressedSnapshot>>>
    >;
    readonly vote: (
      input: Parameters<typeof voteBestDressed>[0],
    ) => ReturnType<typeof attempt<Awaited<ReturnType<typeof voteBestDressed>>>>;
  }
>()("BestDressedService") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const redis = yield* RedisService;
      const client = yield* redis.client;
      return {
        clear: attempt(client, "clear", clearBestDressedVotes),
        getVotingWindow: attempt(client, "get_voting_window", getBestDressedVotingWindow),
        leaderboard: attempt(client, "leaderboard", getBestDressedLeaderboardSnapshot),
        mintCodes: (input) => attempt(client, "mint_codes", () => mintBestDressedCodes(input)),
        revokeCodes: attempt(client, "revoke_codes", revokeAllBestDressedCodes),
        search: (input) => attempt(client, "search", () => searchBestDressedGuests(input)),
        setVotingWindow: (minutes) =>
          attempt(client, "set_voting_window", () => setBestDressedVotingWindow(minutes)),
        snapshot: attempt(client, "snapshot", getBestDressedSnapshot),
        vote: (input) => attempt(client, "vote", () => voteBestDressed(input)),
      };
    }),
  );
}
