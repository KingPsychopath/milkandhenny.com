import { Context, Data, Effect, Layer } from "effect";

import { withObjectStorageProvider } from "@/lib/platform/object-storage-provider-context.server";
import { withOperationSignal } from "@/lib/platform/operation-context.server";
import { ObjectStorageService } from "@/lib/platform/provider-services.server";
import { createWord, deleteWord, updateWord } from "./store.server";

const WORD_OPERATION_TIMEOUT_MS = 3 * 60_000;

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
      return {
        create: (...args) => usingStorage("create", () => createWord(...args)),
        delete: (...args) => usingStorage("delete", () => deleteWord(...args)),
        update: (...args) => usingStorage("update", () => updateWord(...args)),
      };
    }),
  );
}
