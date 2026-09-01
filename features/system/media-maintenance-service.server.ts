import { Context, Data, Effect, Layer } from "effect";

import { cleanupOrphanWordMediaFolders } from "@/features/words/media-maintenance";
import { cleanupShareLinksForSlug, listTrackedShareSlugs } from "@/features/words/share.server";
import { listAllWords } from "@/features/words/store.server";
import { withObjectStorageProvider } from "@/lib/platform/object-storage-provider-context.server";
import { withOperationSignal } from "@/lib/platform/operation-context.server";
import { ObjectStorageService } from "@/lib/platform/provider-services.server";

export class MediaMaintenanceError extends Data.TaggedError("MediaMaintenanceError")<{
  readonly cause: unknown;
  readonly operation: string;
}> {}

function attempt<A>(operation: string, run: () => Promise<A>) {
  return Effect.tryPromise({
    try: (signal) => withOperationSignal(signal, run),
    catch: (cause) => new MediaMaintenanceError({ cause, operation }),
  }).pipe(
    Effect.timeout(5 * 60_000),
    Effect.mapError((cause) =>
      cause instanceof MediaMaintenanceError
        ? cause
        : new MediaMaintenanceError({ cause, operation }),
    ),
    Effect.withSpan(`media.maintenance.${operation}`),
  );
}

export type WordShareCleanupResult = {
  scannedSlugs: number;
  scannedLinks: number;
  removedExpired: number;
  removedRevoked: number;
  staleIndexRemoved: number;
  remaining: number;
};

/** Cross-object maintenance reuses the media runtime and its scoped provider Layers. */
export class MediaMaintenanceService extends Context.Service<
  MediaMaintenanceService,
  {
    readonly cleanupWordMedia: Effect.Effect<
      Awaited<ReturnType<typeof cleanupOrphanWordMediaFolders>>,
      MediaMaintenanceError
    >;
    readonly cleanupWordShares: Effect.Effect<WordShareCleanupResult, MediaMaintenanceError>;
  }
>()("MediaMaintenanceService") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const storage = yield* ObjectStorageService;
      const cleanupWordMedia = attempt("word_media", () =>
        withObjectStorageProvider(storage.port, cleanupOrphanWordMediaFolders),
      );
      const cleanupWordShares = Effect.gen(function* () {
        const [trackedSlugs, words] = yield* Effect.all(
          [
            attempt("word_share_slugs", listTrackedShareSlugs),
            attempt("word_share_words", () => listAllWords({ includeNonPublic: true })),
          ],
          { concurrency: 2 },
        );
        const slugs = new Set(trackedSlugs);
        words.forEach(({ slug }) => slugs.add(slug));
        const results = yield* Effect.forEach(
          [...slugs].sort(),
          (slug) => attempt("word_share_slug", () => cleanupShareLinksForSlug(slug)),
          { concurrency: 4 },
        );
        return results.reduce<WordShareCleanupResult>(
          (summary, result) => ({
            scannedSlugs: summary.scannedSlugs + 1,
            scannedLinks: summary.scannedLinks + result.scanned,
            removedExpired: summary.removedExpired + result.removedExpired,
            removedRevoked: summary.removedRevoked + result.removedRevoked,
            staleIndexRemoved: summary.staleIndexRemoved + result.staleIndexRemoved,
            remaining: summary.remaining + result.remaining,
          }),
          {
            scannedSlugs: 0,
            scannedLinks: 0,
            removedExpired: 0,
            removedRevoked: 0,
            staleIndexRemoved: 0,
            remaining: 0,
          },
        );
      }).pipe(Effect.withSpan("media.maintenance.word_shares"));
      return { cleanupWordMedia, cleanupWordShares };
    }),
  );
}
