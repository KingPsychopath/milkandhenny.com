import { Context, Data, Effect, Layer } from "effect";

import { withObjectStorageProvider } from "@/lib/platform/object-storage-provider-context.server";
import { withOperationSignal } from "@/lib/platform/operation-context.server";
import { ObjectStorageService } from "@/lib/platform/provider-services.server";
import { getWordMediaStorageScope } from "./media-storage.server";
import type { WordMediaTarget } from "./upload";
import {
  cleanupWordMediaStagingFile,
  finishWordMediaMetadata,
  processWordMediaFile,
  verifyWordMediaFile,
  type WordMediaFinalizeFile,
  type WordMediaFinalizeSuccess,
} from "./word-media-operations.server";

const FILE_CONCURRENCY = 2;
const CLEANUP_CONCURRENCY = 4;
const FINALIZE_TIMEOUT_MS = 2 * 60_000;

export class WordMediaOperationError extends Data.TaggedError("WordMediaOperationError")<{
  readonly cause: unknown;
  readonly operation: string;
}> {}

export type WordMediaFinalizeResult =
  | { status: "completed"; value: WordMediaFinalizeSuccess }
  | { status: "verification-failed"; error: string };

function attempt<A>(operation: string, run: () => Promise<A>) {
  return Effect.tryPromise({
    try: (signal) => withOperationSignal(signal, run),
    catch: (cause) => new WordMediaOperationError({ cause, operation }),
  }).pipe(Effect.withSpan(`media.words.${operation}`));
}

/** Word-media processing belongs to the existing Media runtime, not its own runtime. */
export class WordMediaService extends Context.Service<
  WordMediaService,
  {
    readonly finalize: (input: {
      target: WordMediaTarget;
      files: WordMediaFinalizeFile[];
      skipped: string[];
    }) => Effect.Effect<WordMediaFinalizeResult, WordMediaOperationError>;
  }
>()("WordMediaService") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const storage = yield* ObjectStorageService;
      const usingStorage = <A>(operation: string, run: () => Promise<A>) =>
        attempt(operation, () => withObjectStorageProvider(storage.port, run));

      return {
        finalize: ({ target, files, skipped }) => {
          const cleanup = Effect.forEach(
            files,
            (file) =>
              usingStorage("cleanup_staging", () => cleanupWordMediaStagingFile(target, file)).pipe(
                Effect.catch(() => Effect.void),
              ),
            { concurrency: CLEANUP_CONCURRENCY, discard: true },
          );
          const workflow = Effect.gen(function* () {
            const storageScope = yield* usingStorage("resolve_scope", () =>
              getWordMediaStorageScope(target),
            );
            const verification = yield* Effect.forEach(
              files,
              (file) => usingStorage("verify_upload", () => verifyWordMediaFile(file)),
              { concurrency: FILE_CONCURRENCY },
            );
            const error = verification.find((message): message is string => message !== null);
            if (error) return { status: "verification-failed", error } as const;

            const processed = yield* Effect.forEach(
              files,
              (file) =>
                usingStorage("process_file", () =>
                  processWordMediaFile(target, storageScope, file),
                ),
              { concurrency: FILE_CONCURRENCY },
            );
            const value = yield* usingStorage("write_metadata", () =>
              finishWordMediaMetadata(target, storageScope, processed),
            );
            return { status: "completed", value: { ...value, skipped } } as const;
          });
          return workflow.pipe(
            Effect.ensuring(cleanup),
            Effect.timeout(FINALIZE_TIMEOUT_MS),
            Effect.mapError((cause) =>
              cause instanceof WordMediaOperationError
                ? cause
                : new WordMediaOperationError({ cause, operation: "finalize" }),
            ),
            Effect.withSpan("media.words.finalize"),
          );
        },
      };
    }),
  );
}
