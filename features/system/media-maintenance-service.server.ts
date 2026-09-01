import { Context, Data, Effect, Layer } from "effect";

import {
  cleanupOrphanWordMediaFolders,
  scanOrphanWordMediaFolders,
} from "@/features/words/media-maintenance";
import {
  cleanupShareLinksForSlug,
  deleteAllShareLinksForSlug,
  listShareLinks,
  listTrackedShareSlugs,
  revokeShareLink,
} from "@/features/words/share.server";
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

export type WordSharePurgeResult = {
  scannedSlugs: number;
  deletedLinks: number;
  remaining: 0;
};

/** Cross-object maintenance reuses the media runtime and its scoped provider Layers. */
export class MediaMaintenanceService extends Context.Service<
  MediaMaintenanceService,
  {
    readonly cleanupWordMedia: Effect.Effect<
      Awaited<ReturnType<typeof cleanupOrphanWordMediaFolders>>,
      MediaMaintenanceError
    >;
    readonly scanWordMedia: (
      options?: Parameters<typeof scanOrphanWordMediaFolders>[0],
    ) => Effect.Effect<
      Awaited<ReturnType<typeof scanOrphanWordMediaFolders>>,
      MediaMaintenanceError
    >;
    readonly cleanupWordShares: (
      slug?: string,
    ) => Effect.Effect<WordShareCleanupResult, MediaMaintenanceError>;
    readonly purgeWordShares: (
      slug?: string,
    ) => Effect.Effect<WordSharePurgeResult, MediaMaintenanceError>;
    readonly revokeWordShares: (slug: string) => Effect.Effect<number, MediaMaintenanceError>;
  }
>()("MediaMaintenanceService") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const storage = yield* ObjectStorageService;
      const cleanupWordMedia = attempt("word_media", () =>
        withObjectStorageProvider(storage.port, cleanupOrphanWordMediaFolders),
      );
      const scanWordMedia = (options?: Parameters<typeof scanOrphanWordMediaFolders>[0]) =>
        attempt("word_media_scan", () =>
          withObjectStorageProvider(storage.port, () => scanOrphanWordMediaFolders(options)),
        );
      const collectShareSlugs = (slug?: string) =>
        slug
          ? Effect.succeed([slug])
          : Effect.all(
              [
                attempt("word_share_slugs", listTrackedShareSlugs),
                attempt("word_share_words", () => listAllWords({ includeNonPublic: true })),
              ],
              { concurrency: 2 },
            ).pipe(
              Effect.map(([trackedSlugs, words]) => {
                const slugs = new Set(trackedSlugs);
                words.forEach((word) => slugs.add(word.slug));
                return [...slugs].sort();
              }),
            );
      const cleanupWordShares = (slug?: string) =>
        Effect.gen(function* () {
          const slugs = yield* collectShareSlugs(slug);
          const results = yield* Effect.forEach(
            slugs,
            (item) => attempt("word_share_slug", () => cleanupShareLinksForSlug(item)),
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
      const purgeWordShares = (slug?: string) =>
        Effect.gen(function* () {
          const slugs = yield* collectShareSlugs(slug);
          const deleted = yield* Effect.forEach(
            slugs,
            (item) => attempt("word_share_purge_slug", () => deleteAllShareLinksForSlug(item)),
            { concurrency: 4 },
          );
          return {
            scannedSlugs: slugs.length,
            deletedLinks: deleted.reduce((sum, count) => sum + count, 0),
            remaining: 0 as const,
          };
        }).pipe(Effect.withSpan("media.maintenance.word_share_purge"));
      const revokeWordShares = (slug: string) =>
        Effect.gen(function* () {
          const links = yield* attempt("word_share_list", () => listShareLinks(slug));
          const now = Date.now();
          const active = links.filter(
            (link) => !link.revokedAt && new Date(link.expiresAt).getTime() > now,
          );
          const revoked = yield* Effect.forEach(
            active,
            (link) => attempt("word_share_revoke", () => revokeShareLink(slug, link.id)),
            { concurrency: 4 },
          );
          return revoked.filter(Boolean).length;
        }).pipe(Effect.withSpan("media.maintenance.word_share_revoke"));
      return {
        cleanupWordMedia,
        scanWordMedia,
        cleanupWordShares,
        purgeWordShares,
        revokeWordShares,
      };
    }),
  );
}
