import { Context, Data, Effect, Layer } from "effect";

import { withObjectStorageProvider } from "@/lib/platform/object-storage-provider-context.server";
import { withOperationSignal } from "@/lib/platform/operation-context.server";
import { ObjectStorageService } from "@/lib/platform/provider-services.server";
import {
  deleteAlbum,
  deleteAlbumPhoto,
  deleteAlbumPhotos,
  finalizeAlbumUploads,
  prepareAlbumUploads,
  updateAlbumMetadata,
  updateAlbumPhoto,
} from "./admin-albums";

const ALBUM_OPERATION_TIMEOUT_MS = 3 * 60_000;

export class AlbumOperationError extends Data.TaggedError("AlbumOperationError")<{
  readonly cause: unknown;
  readonly message: string;
  readonly operation: string;
}> {}

function attempt<A>(operation: string, run: () => Promise<A>) {
  return Effect.tryPromise({
    try: (signal) => withOperationSignal(signal, run),
    catch: (cause) =>
      new AlbumOperationError({
        cause,
        message: cause instanceof Error ? cause.message : `Album ${operation} failed`,
        operation,
      }),
  }).pipe(
    Effect.timeout(ALBUM_OPERATION_TIMEOUT_MS),
    Effect.mapError((cause) =>
      cause instanceof AlbumOperationError
        ? cause
        : new AlbumOperationError({
            cause,
            message: `Album ${operation} timed out`,
            operation,
          }),
    ),
    Effect.withSpan(`media.albums.${operation}`, { attributes: { operation } }),
  );
}

/** Album side-effect orchestration reuses the existing Media runtime and R2 Layer. */
export class AlbumOperationsService extends Context.Service<
  AlbumOperationsService,
  {
    readonly deleteAlbum: (
      ...args: Parameters<typeof deleteAlbum>
    ) => Effect.Effect<Awaited<ReturnType<typeof deleteAlbum>>, AlbumOperationError>;
    readonly deletePhoto: (
      ...args: Parameters<typeof deleteAlbumPhoto>
    ) => Effect.Effect<Awaited<ReturnType<typeof deleteAlbumPhoto>>, AlbumOperationError>;
    readonly deletePhotos: (
      ...args: Parameters<typeof deleteAlbumPhotos>
    ) => Effect.Effect<Awaited<ReturnType<typeof deleteAlbumPhotos>>, AlbumOperationError>;
    readonly finalizeUploads: (
      ...args: Parameters<typeof finalizeAlbumUploads>
    ) => Effect.Effect<Awaited<ReturnType<typeof finalizeAlbumUploads>>, AlbumOperationError>;
    readonly prepareUploads: (
      ...args: Parameters<typeof prepareAlbumUploads>
    ) => Effect.Effect<Awaited<ReturnType<typeof prepareAlbumUploads>>, AlbumOperationError>;
    readonly updateMetadata: (
      ...args: Parameters<typeof updateAlbumMetadata>
    ) => Effect.Effect<Awaited<ReturnType<typeof updateAlbumMetadata>>, AlbumOperationError>;
    readonly updatePhoto: (
      ...args: Parameters<typeof updateAlbumPhoto>
    ) => Effect.Effect<Awaited<ReturnType<typeof updateAlbumPhoto>>, AlbumOperationError>;
  }
>()("AlbumOperationsService") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* () {
      const storage = yield* ObjectStorageService;
      const usingStorage = <A>(operation: string, run: () => Promise<A>) =>
        attempt(operation, () => withObjectStorageProvider(storage.port, run));
      return {
        deleteAlbum: (...args) => usingStorage("delete", () => deleteAlbum(...args)),
        deletePhoto: (...args) => usingStorage("delete_photo", () => deleteAlbumPhoto(...args)),
        deletePhotos: (...args) => usingStorage("delete_photos", () => deleteAlbumPhotos(...args)),
        finalizeUploads: (...args) =>
          usingStorage("finalize_uploads", () => finalizeAlbumUploads(...args)),
        prepareUploads: (...args) =>
          usingStorage("prepare_uploads", () => prepareAlbumUploads(...args)),
        updateMetadata: (...args) =>
          usingStorage("update_metadata", () => updateAlbumMetadata(...args)),
        updatePhoto: (...args) => usingStorage("update_photo", () => updateAlbumPhoto(...args)),
      };
    }),
  );
}
