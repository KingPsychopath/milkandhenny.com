import { Context, Data, Effect, Layer } from "effect";

import { withObjectStorageProvider } from "@/lib/platform/object-storage-provider-context.server";
import { withOperationSignal } from "@/lib/platform/operation-context.server";
import { ObjectStorageService } from "@/lib/platform/provider-services.server";
import { createWord, deleteWord, listAllWords, updateWord } from "./store.server";

const WORD_OPERATION_TIMEOUT_MS = 3 * 60_000;
const WORD_TARGETS_TIMEOUT_MS = 1_200;
const STORAGE_TARGETS_TIMEOUT_MS = 1_800;

function idFromPrefix(prefix: string, root: string): string | null {
  if (!prefix.startsWith(root)) return null;
  const rest = prefix.slice(root.length);
  return (rest.endsWith("/") ? rest.slice(0, -1) : rest) || null;
}

export class WordOperationError extends Data.TaggedError("WordOperationError")<{
  readonly cause: unknown;
  readonly message: string;
  readonly operation: string;
}> {}

function attempt<A>(operation: string, run: () => Promise<A>) {
  return Effect.tryPromise({
    try: (signal) => withOperationSignal(signal, run),
    catch: (cause) =>
      new WordOperationError({
        cause,
        message: cause instanceof Error ? cause.message : `Word ${operation} failed`,
        operation,
      }),
  }).pipe(
    Effect.timeout(WORD_OPERATION_TIMEOUT_MS),
    Effect.mapError((cause) =>
      cause instanceof WordOperationError
        ? cause
        : new WordOperationError({
            cause,
            message: `Word ${operation} timed out`,
            operation,
          }),
    ),
    Effect.withSpan(`media.words.${operation}`, { attributes: { operation } }),
  );
}

/** Word content mutations coordinate R2 content/media with Redis metadata in the Media runtime. */
export class WordOperationsService extends Context.Service<
  WordOperationsService,
  {
    readonly create: (
      ...args: Parameters<typeof createWord>
    ) => Effect.Effect<Awaited<ReturnType<typeof createWord>>, WordOperationError>;
    readonly delete: (
      ...args: Parameters<typeof deleteWord>
    ) => Effect.Effect<Awaited<ReturnType<typeof deleteWord>>, WordOperationError>;
    readonly listTargets: Effect.Effect<{ assets: string[]; slugs: string[] }, WordOperationError>;
    readonly update: (
      ...args: Parameters<typeof updateWord>
    ) => Effect.Effect<Awaited<ReturnType<typeof updateWord>>, WordOperationError>;
  }
>()("WordOperationsService") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const storage = yield* ObjectStorageService;
      const usingStorage = <A>(operation: string, run: () => Promise<A>) =>
        attempt(operation, () => withObjectStorageProvider(storage.port, run));
      const words = attempt("list_targets_words", () =>
        listAllWords({ includeNonPublic: true }),
      ).pipe(
        Effect.timeout(WORD_TARGETS_TIMEOUT_MS),
        Effect.catch(() => Effect.succeed([])),
      );
      // Keep provider inspection lazy so adding this service to the shared Media runtime does not
      // make unrelated transfer or album workflows depend on word-media configuration.
      const prefixes = Effect.suspend(() =>
        storage.port.isConfigured()
          ? Effect.all(
              [
                usingStorage("list_target_words", () =>
                  storage.port.listPrefixes("words/media/", { scope: "public" }),
                ),
                usingStorage("list_target_assets", () =>
                  storage.port.listPrefixes("words/assets/", { scope: "public" }),
                ),
              ],
              { concurrency: 2 },
            ).pipe(
              Effect.timeout(STORAGE_TARGETS_TIMEOUT_MS),
              Effect.catch(() => Effect.succeed([[], []] as const)),
            )
          : Effect.succeed([[], []] as const),
      );
      return {
        create: (...args) => usingStorage("create", () => createWord(...args)),
        delete: (...args) => usingStorage("delete", () => deleteWord(...args)),
        listTargets: Effect.all([words, prefixes], { concurrency: 2 }).pipe(
          Effect.map(([notes, [wordPrefixes, assetPrefixes]]) => ({
            slugs: [
              ...new Set([
                ...notes.map(({ slug }) => slug),
                ...wordPrefixes.flatMap((prefix) => {
                  const slug = idFromPrefix(prefix, "words/media/");
                  return slug ? [slug] : [];
                }),
              ]),
            ].sort(),
            assets: [
              ...new Set(
                assetPrefixes.flatMap((prefix) => {
                  const assetId = idFromPrefix(prefix, "words/assets/");
                  return assetId ? [assetId] : [];
                }),
              ),
            ].sort(),
          })),
          Effect.withSpan("media.words.list_targets"),
        ),
        update: (...args) => usingStorage("update", () => updateWord(...args)),
      };
    }),
  );
}
