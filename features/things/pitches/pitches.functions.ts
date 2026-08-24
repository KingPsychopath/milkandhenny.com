import { createServerFn } from "@tanstack/react-start";
import { getRequest, getRequestIP } from "@tanstack/react-start/server";
import { Effect } from "effect";

import { authenticateRequest } from "@/features/auth/auth.server";
import { getBaseUrlForRequest } from "@/lib/shared/config";
import { pitchEditorConfig, type PitchAssetUploadInput } from "./pitches.server";
import { getPitchOperationalStatus } from "./operational.server";
import { runPitchesResult } from "./pitches-runtime.server";
import { PitchesService } from "./pitches-service.server";
import type {
  PitchCommandKind,
  PitchCommandOperation,
  PitchDocument,
  PitchWallLoad,
} from "./types";
import {
  isPitchAssetId,
  isPitchAssetKind,
  isPitchCreateRequestId,
  isPitchDeckId,
  isPitchMutationId,
  isPitchOwnerToken,
  parsePitchDocument,
  parsePitchOwnerName,
  parsePitchTitle,
} from "./validation";

type OperationResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; error: string; retryable?: boolean };

function invalid(error = "Some details were missing or invalid. Check them and try again.") {
  return { ok: false as const, status: 400, error };
}

function unavailableWall(message: string): PitchWallLoad {
  return { status: "unavailable", pitches: [], rejectedCount: 0, message };
}

async function runOperation<T>(
  effect: Effect.Effect<OperationResult<T>, unknown, PitchesService>,
): Promise<OperationResult<T>> {
  const result = await runPitchesResult(effect);
  return result.ok
    ? result.value
    : { ok: false, status: result.status, error: result.error, retryable: result.retryable };
}

function validEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

export const listPublishedPitchesFn = createServerFn({ method: "GET" })
  .validator((data?: { search?: string }) => data)
  .handler(async ({ data }) => {
    const operationalStatus = await getPitchOperationalStatus();
    if (!operationalStatus.canRead) {
      return {
        wall: unavailableWall(operationalStatus.message),
        operationalStatus,
        ...pitchEditorConfig(),
      };
    }
    const result = await runPitchesResult(
      Effect.gen(function* () {
        const pitches = yield* PitchesService;
        return yield* pitches.listPublished(data?.search?.slice(0, 100));
      }),
    );
    const wall: PitchWallLoad = result.ok
      ? result.value.rejectedCount > 0
        ? {
            status: "degraded",
            pitches: result.value.pitches,
            rejectedCount: result.value.rejectedCount,
            message:
              result.value.pitches.length > 0
                ? "Some published pitches need repair. The other pitches are still available."
                : "Published pitches exist, but this studio version could not read them.",
          }
        : { status: "ok", pitches: result.value.pitches, rejectedCount: 0 }
      : unavailableWall(
          "We could not load the wall. Your published pitches are still safe. Try again.",
        );
    return {
      wall,
      operationalStatus,
      ...pitchEditorConfig(),
    };
  });

export const readPitchOperationalStatusFn = createServerFn({ method: "GET" }).handler(() =>
  getPitchOperationalStatus(),
);

export const readPublishedPitchFn = createServerFn({ method: "GET" })
  .validator((data: { deckId: string; editionNumber?: number }) => data)
  .handler(async ({ data }) => {
    const operationalStatus = await getPitchOperationalStatus();
    if (!operationalStatus.canRead) {
      return { pitch: null, loadError: operationalStatus.message, operationalStatus };
    }
    if (
      !isPitchDeckId(data.deckId) ||
      (data.editionNumber !== undefined &&
        (!Number.isInteger(data.editionNumber) || data.editionNumber < 1))
    )
      return { pitch: null, loadError: undefined, operationalStatus };
    const result = await runPitchesResult(
      Effect.gen(function* () {
        const pitches = yield* PitchesService;
        return yield* pitches.readPublished(data.deckId, data.editionNumber);
      }),
    );
    return {
      pitch: result.ok ? result.value : null,
      loadError: result.ok
        ? undefined
        : "We could not open this published pitch. It is still safe. Try again.",
      operationalStatus,
    };
  });

type CreateInput = {
  createRequestId: string;
  ownerName: string;
  ownerEmail: string;
  ownerToken: string;
  title: string;
  document: unknown;
};

export const createPitchFn = createServerFn({ method: "POST" })
  .validator((data: CreateInput) => data)
  .handler(async ({ data }) => {
    const ownerName = parsePitchOwnerName(data.ownerName);
    const title = parsePitchTitle(data.title);
    const document = parsePitchDocument(data.document, pitchEditorConfig().maximumSlides);
    if (!ownerName) {
      return invalid("Add your name so we know who owns this pitch.");
    }
    if (!title) {
      return invalid("Add a pitch title before opening the studio.");
    }
    if (!validEmail(data.ownerEmail)) {
      return invalid("Enter a valid recovery email so you can get back to this pitch.");
    }
    if (!isPitchCreateRequestId(data.createRequestId) || !isPitchOwnerToken(data.ownerToken)) {
      return invalid("This studio request expired. Try opening the studio again.");
    }
    if (!document.ok) {
      return invalid(document.error);
    }
    return runOperation(
      Effect.gen(function* () {
        const pitches = yield* PitchesService;
        return yield* pitches.create({
          ...data,
          ownerName,
          title,
          document: document.document,
          origin: getBaseUrlForRequest(getRequest()),
        });
      }),
    );
  });

export const readOwnedPitchFn = createServerFn({ method: "POST" })
  .validator((data: { deckId: string; ownerToken: string }) => data)
  .handler(async ({ data }) => {
    if (!isPitchDeckId(data.deckId) || !isPitchOwnerToken(data.ownerToken)) {
      return invalid();
    }
    return runOperation(
      Effect.gen(function* () {
        const pitches = yield* PitchesService;
        return yield* pitches.readOwned(data.deckId, data.ownerToken);
      }),
    );
  });

export const listPitchHistoryFn = createServerFn({ method: "POST" })
  .validator((data: { deckId: string; ownerToken: string }) => data)
  .handler(async ({ data }) => {
    if (!isPitchDeckId(data.deckId) || !isPitchOwnerToken(data.ownerToken)) {
      return invalid();
    }
    return runOperation(
      Effect.gen(function* () {
        const pitches = yield* PitchesService;
        return yield* pitches.listHistory(data.deckId, data.ownerToken);
      }),
    );
  });

export const readPitchVersionFn = createServerFn({ method: "POST" })
  .validator((data: { deckId: string; ownerToken: string; backupId: string }) => data)
  .handler(async ({ data }) => {
    if (
      !isPitchDeckId(data.deckId) ||
      !isPitchOwnerToken(data.ownerToken) ||
      !/^\d{1,20}$/.test(data.backupId)
    ) {
      return invalid();
    }
    return runOperation(
      Effect.gen(function* () {
        const pitches = yield* PitchesService;
        return yield* pitches.readVersion(data.deckId, data.ownerToken, data.backupId);
      }),
    );
  });

export const restorePitchVersionFn = createServerFn({ method: "POST" })
  .validator((data: { deckId: string; ownerToken: string; backupId: string }) => data)
  .handler(async ({ data }) => {
    if (
      !isPitchDeckId(data.deckId) ||
      !isPitchOwnerToken(data.ownerToken) ||
      !/^\d{1,20}$/.test(data.backupId)
    ) {
      return invalid();
    }
    return runOperation(
      Effect.gen(function* () {
        const pitches = yield* PitchesService;
        return yield* pitches.restoreVersion(data.deckId, data.ownerToken, data.backupId);
      }),
    );
  });

type SyncInput = {
  deckId: string;
  ownerToken: string;
  baseVersion: number;
  mutationId: string;
  title: string;
  document: unknown;
  operations: unknown;
};

const PITCH_COMMAND_KINDS = new Set<PitchCommandKind>([
  "deck.rename",
  "deck.replace",
  "slide.add",
  "slide.remove",
  "slide.rename",
  "slide.reorder",
  "slide.timing",
  "element.change",
  "image.add",
  "ink.add",
  "media.add",
  "media.change",
  "media.remove",
  "history.restore",
  "history.undo",
]);

function parsePitchOperations(value: unknown): PitchCommandOperation[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 500) return null;
  const operations: PitchCommandOperation[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const operation = entry as Record<string, unknown>;
    if (
      typeof operation.id !== "string" ||
      !isPitchMutationId(operation.id) ||
      typeof operation.deviceId !== "string" ||
      !/^device_[A-Za-z0-9_-]{12,64}$/.test(operation.deviceId) ||
      !Number.isInteger(operation.sequence) ||
      Number(operation.sequence) < 1 ||
      typeof operation.kind !== "string" ||
      !PITCH_COMMAND_KINDS.has(operation.kind as PitchCommandKind) ||
      !operation.payload ||
      typeof operation.payload !== "object" ||
      Array.isArray(operation.payload) ||
      typeof operation.occurredAt !== "string" ||
      !Number.isFinite(Date.parse(operation.occurredAt))
    ) {
      return null;
    }
    operations.push(operation as unknown as PitchCommandOperation);
  }
  return JSON.stringify(operations).length <= 64 * 1024 ? operations : null;
}

export const syncPitchFn = createServerFn({ method: "POST" })
  .validator((data: SyncInput) => data)
  .handler(async ({ data }) => {
    const title = parsePitchTitle(data.title);
    const document = parsePitchDocument(data.document, pitchEditorConfig().maximumSlides);
    const operations = parsePitchOperations(data.operations);
    if (
      !isPitchDeckId(data.deckId) ||
      !isPitchOwnerToken(data.ownerToken) ||
      !isPitchMutationId(data.mutationId) ||
      !Number.isInteger(data.baseVersion) ||
      data.baseVersion < 1 ||
      !title ||
      !document.ok ||
      !operations ||
      operations[0]?.id !== data.mutationId
    ) {
      return invalid(document.ok ? undefined : document.error);
    }
    return runOperation(
      Effect.gen(function* () {
        const pitches = yield* PitchesService;
        return yield* pitches.sync({
          ...data,
          title,
          document: document.document,
          operations,
        });
      }),
    );
  });

export const publishPitchFn = createServerFn({ method: "POST" })
  .validator((data: { deckId: string; ownerToken: string; thumbnailAssetId?: string }) => data)
  .handler(async ({ data }) => {
    if (
      !isPitchDeckId(data.deckId) ||
      !isPitchOwnerToken(data.ownerToken) ||
      (data.thumbnailAssetId !== undefined && !isPitchAssetId(data.thumbnailAssetId))
    ) {
      return invalid();
    }
    return runOperation(
      Effect.gen(function* () {
        const pitches = yield* PitchesService;
        return yield* pitches.publish({
          ...data,
          origin: getBaseUrlForRequest(getRequest()),
        });
      }),
    );
  });

export const createPitchAssetUploadFn = createServerFn({ method: "POST" })
  .validator((data: PitchAssetUploadInput) => data)
  .handler(async ({ data }) => {
    if (
      !isPitchDeckId(data.deckId) ||
      !isPitchOwnerToken(data.ownerToken) ||
      !isPitchAssetKind(data.kind) ||
      typeof data.fileName !== "string" ||
      data.fileName.length > 180 ||
      typeof data.mimeType !== "string" ||
      data.mimeType.length > 120 ||
      (data.fileId !== undefined &&
        (!/^[A-Za-z0-9_-]{1,120}$/.test(data.fileId) || data.fileId.length > 120))
    ) {
      return invalid();
    }
    return runOperation(
      Effect.gen(function* () {
        const pitches = yield* PitchesService;
        return yield* pitches.createAssetUpload(data);
      }),
    );
  });

export const finalisePitchAssetFn = createServerFn({ method: "POST" })
  .validator((data: { deckId: string; ownerToken: string; assetId: string }) => data)
  .handler(async ({ data }) => {
    if (
      !isPitchDeckId(data.deckId) ||
      !isPitchOwnerToken(data.ownerToken) ||
      !isPitchAssetId(data.assetId)
    ) {
      return invalid();
    }
    return runOperation(
      Effect.gen(function* () {
        const pitches = yield* PitchesService;
        return yield* pitches.finaliseAsset(data);
      }),
    );
  });

export const recoverPitchAccessFn = createServerFn({ method: "POST" })
  .validator((data: { email: string }) => data)
  .handler(async ({ data }): Promise<OperationResult<{ queued: boolean }>> => {
    const email = data.email.trim().toLowerCase();
    if (!validEmail(email)) return invalid("That email address doesn't look right");
    const allowed = await runPitchesResult(
      Effect.gen(function* () {
        const pitches = yield* PitchesService;
        return yield* pitches.allowRecovery(getRequestIP() || "unknown", email);
      }),
    );
    if (!allowed.ok || !allowed.value) {
      return { ok: false, status: 429, error: "Try again a little later" };
    }
    const result = await runPitchesResult(
      Effect.gen(function* () {
        const pitches = yield* PitchesService;
        return yield* pitches.recover({
          email,
          origin: getBaseUrlForRequest(getRequest()),
        });
      }),
    );
    return result.ok
      ? { ok: true, value: result.value }
      : { ok: false, status: result.status, error: result.error };
  });

export const listAdminPitchesFn = createServerFn({ method: "GET" }).handler(async () => {
  const auth = await authenticateRequest(getRequest(), "admin");
  if (!auth.ok) return { authorised: false as const };
  const result = await runPitchesResult(
    Effect.gen(function* () {
      const pitches = yield* PitchesService;
      return yield* pitches.listAdmin();
    }),
  );
  return { authorised: true as const, pitches: result.ok ? result.value : [] };
});

export const readAdminPitchFn = createServerFn({ method: "GET" })
  .validator((data: { deckId: string }) => data)
  .handler(async ({ data }) => {
    const auth = await authenticateRequest(getRequest(), "admin");
    if (!auth.ok) return { authorised: false as const };
    if (!isPitchDeckId(data.deckId)) return { authorised: true as const, pitch: null };
    const result = await runPitchesResult(
      Effect.gen(function* () {
        const pitches = yield* PitchesService;
        return yield* pitches.readAdmin(data.deckId);
      }),
    );
    return { authorised: true as const, pitch: result.ok ? result.value : null };
  });

export const archivePitchFn = createServerFn({ method: "POST" })
  .validator((data: { deckId: string; archived: boolean }) => data)
  .handler(async ({ data }) => {
    const auth = await authenticateRequest(getRequest(), "admin");
    if (!auth.ok) return { authorised: false as const };
    if (!isPitchDeckId(data.deckId) || typeof data.archived !== "boolean") {
      return { authorised: true as const, pitch: null };
    }
    const result = await runPitchesResult(
      Effect.gen(function* () {
        const pitches = yield* PitchesService;
        return yield* pitches.archive(data.deckId, data.archived);
      }),
    );
    const pitch = result.ok ? result.value : null;
    return { authorised: true as const, pitch };
  });

export type { PitchDocument };
