import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

import {
  PITCH_DOCUMENT_MAX_BYTES,
  PITCH_DOCUMENT_SCHEMA_VERSION,
  PITCH_MEDIA_CLIP_LIMIT,
  PITCH_MAX_ELEMENTS,
  PITCH_SLIDE_DEFAULT_DURATION_MS,
  PITCH_SLIDE_DURATION_RANGE_MS,
  type PitchMediaClip,
  type PitchAssetKind,
  type PitchDocument,
  type PitchInkLayer,
  type PitchInkStroke,
  type PitchSlide,
} from "./types";

const DECK_ID_PATTERN = /^p_[A-Za-z0-9_-]{22}$/;
const ASSET_ID_PATTERN = /^pa_[A-Za-z0-9_-]{22}$/;
const SLIDE_ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;
const FILE_ID_PATTERN = /^[A-Za-z0-9_-]{1,120}$/;
const MUTATION_ID_PATTERN = /^[A-Za-z0-9_-]{8,120}$/;
const CREATE_REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,120}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,160}$/;
const ELEMENT_TYPES = new Set([
  "rectangle",
  "diamond",
  "ellipse",
  "arrow",
  "line",
  "freedraw",
  "text",
  "image",
]);
const ASSET_KINDS = new Set<PitchAssetKind>(["image", "audio", "video", "thumbnail"]);
const INK_PENS = new Set<PitchInkStroke["pen"]>([
  "pencil",
  "pen",
  "fineliner",
  "marker",
  "highlighter",
  "brush",
  "fountain",
]);

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finiteInteger(value: unknown, minimum: number): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= minimum ? value : null;
}

function boundedText(value: unknown, maximum: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text.length <= maximum ? text : null;
}

function parseAssetIds(value: unknown): Record<string, string> | null {
  const source = record(value);
  if (!source) return null;
  const result: Record<string, string> = {};
  for (const [fileId, assetId] of Object.entries(source)) {
    if (
      !FILE_ID_PATTERN.test(fileId) ||
      typeof assetId !== "string" ||
      !ASSET_ID_PATTERN.test(assetId)
    )
      return null;
    result[fileId] = assetId;
  }
  return result;
}

function parseElements(value: unknown): readonly ExcalidrawElement[] | null {
  if (!Array.isArray(value)) return null;
  const parsed: unknown[] = [];
  for (const candidate of value) {
    const element = record(candidate);
    if (!element) return null;
    if (
      typeof element.id !== "string" ||
      !FILE_ID_PATTERN.test(element.id) ||
      typeof element.type !== "string" ||
      !ELEMENT_TYPES.has(element.type) ||
      finiteInteger(element.version, 1) === null ||
      typeof element.isDeleted !== "boolean"
    ) {
      return null;
    }
    parsed.push(candidate);
  }
  // Excalidraw owns the complete element schema. This boundary verifies the
  // stable fields our merge and limits depend on, while restore() validates
  // and migrates the remaining editor-specific fields in the browser.
  return parsed as readonly ExcalidrawElement[];
}

function parseInkShape(value: unknown): PitchInkStroke["shape"] | null {
  if (value === undefined) return undefined;
  const source = record(value);
  if (!source) return null;
  const shape: NonNullable<PitchInkStroke["shape"]> = {};
  if (source.nibAngle !== undefined) {
    if (typeof source.nibAngle !== "number" || !Number.isFinite(source.nibAngle)) return null;
    shape.nibAngle = source.nibAngle;
  }
  if (source.taper !== undefined) {
    if (typeof source.taper !== "number" || !Number.isFinite(source.taper)) return null;
    shape.taper = source.taper;
  }
  if (source.simulatePressure !== undefined) {
    if (typeof source.simulatePressure !== "boolean") return null;
    shape.simulatePressure = source.simulatePressure;
  }
  return shape;
}

function parseInkLayers(value: unknown): PitchInkLayer[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20) return null;
  let pointCount = 0;
  const layers: PitchInkLayer[] = [];
  for (const candidate of value) {
    const layer = record(candidate);
    const board = record(layer?.board);
    if (
      !layer ||
      typeof layer.id !== "string" ||
      !SLIDE_ID_PATTERN.test(layer.id) ||
      typeof layer.name !== "string" ||
      layer.name.length > 80 ||
      typeof layer.fileId !== "string" ||
      !FILE_ID_PATTERN.test(layer.fileId) ||
      typeof layer.updatedAt !== "number" ||
      !Number.isFinite(layer.updatedAt) ||
      !board ||
      typeof board.w !== "number" ||
      typeof board.h !== "number" ||
      board.w < 100 ||
      board.h < 100 ||
      board.w > 4_000 ||
      board.h > 4_000 ||
      !Array.isArray(layer.strokes) ||
      layer.strokes.length > 1_000
    ) {
      return null;
    }
    const strokes: PitchInkStroke[] = [];
    for (const candidateStroke of layer.strokes) {
      const stroke = record(candidateStroke);
      const shape = parseInkShape(stroke?.shape);
      if (
        !stroke ||
        typeof stroke.id !== "number" ||
        !Number.isFinite(stroke.id) ||
        typeof stroke.pen !== "string" ||
        !INK_PENS.has(stroke.pen as PitchInkStroke["pen"]) ||
        typeof stroke.color !== "string" ||
        stroke.color.length > 80 ||
        typeof stroke.size !== "number" ||
        !Number.isFinite(stroke.size) ||
        stroke.size <= 0 ||
        stroke.size > 500 ||
        typeof stroke.opacity !== "number" ||
        stroke.opacity < 0 ||
        stroke.opacity > 1 ||
        !Array.isArray(stroke.points) ||
        stroke.points.length > 20_000 ||
        shape === null
      ) {
        return null;
      }
      const points: Array<[number, number, number]> = [];
      for (const point of stroke.points) {
        if (
          !Array.isArray(point) ||
          point.length !== 3 ||
          point.some((coordinate) => typeof coordinate !== "number" || !Number.isFinite(coordinate))
        ) {
          return null;
        }
        points.push([point[0], point[1], point[2]]);
      }
      pointCount += points.length;
      if (pointCount > 100_000) return null;
      strokes.push({
        id: stroke.id,
        pen: stroke.pen as PitchInkStroke["pen"],
        color: stroke.color,
        size: stroke.size,
        opacity: stroke.opacity,
        points,
        shape,
        erase: stroke.erase === true ? true : undefined,
      });
    }
    layers.push({
      id: layer.id,
      name: layer.name,
      board: { w: board.w, h: board.h },
      strokes,
      fileId: layer.fileId,
      updatedAt: layer.updatedAt,
    });
  }
  return layers;
}

function parseMediaClips(value: unknown, slideDurationMs: number): PitchMediaClip[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > PITCH_MEDIA_CLIP_LIMIT) return null;
  const ids = new Set<string>();
  const clips: PitchMediaClip[] = [];
  for (const candidate of value) {
    const clip = record(candidate);
    const id =
      typeof clip?.id === "string" && SLIDE_ID_PATTERN.test(clip.id) && !ids.has(clip.id)
        ? clip.id
        : null;
    const assetId =
      typeof clip?.assetId === "string" && ASSET_ID_PATTERN.test(clip.assetId)
        ? clip.assetId
        : null;
    const kind = clip?.kind === "audio" || clip?.kind === "video" ? clip.kind : null;
    const timelineStartMs = finiteInteger(clip?.timelineStartMs, 0);
    const sourceDurationMs = finiteInteger(clip?.sourceDurationMs, 1);
    const sourceStartMs = finiteInteger(clip?.sourceStartMs, 0);
    const durationMs = finiteInteger(clip?.durationMs, 1);
    const volume =
      typeof clip?.volume === "number" && Number.isFinite(clip.volume) ? clip.volume : null;
    const linkedGroupId =
      clip?.linkedGroupId === undefined
        ? undefined
        : typeof clip.linkedGroupId === "string" && SLIDE_ID_PATTERN.test(clip.linkedGroupId)
          ? clip.linkedGroupId
          : null;
    const fit =
      clip?.fit === undefined
        ? undefined
        : clip.fit === "contain" || clip.fit === "cover"
          ? clip.fit
          : null;
    if (
      !id ||
      !assetId ||
      !kind ||
      timelineStartMs === null ||
      timelineStartMs >= slideDurationMs ||
      sourceDurationMs === null ||
      sourceDurationMs > PITCH_SLIDE_DURATION_RANGE_MS.max ||
      sourceStartMs === null ||
      sourceStartMs >= sourceDurationMs ||
      durationMs === null ||
      durationMs > sourceDurationMs - sourceStartMs ||
      timelineStartMs + durationMs > slideDurationMs ||
      volume === null ||
      volume < 0 ||
      volume > 1 ||
      typeof clip?.muted !== "boolean" ||
      typeof clip.locked !== "boolean" ||
      linkedGroupId === null ||
      fit === null ||
      (kind === "audio" && fit !== undefined)
    ) {
      return null;
    }
    ids.add(id);
    clips.push({
      id,
      assetId,
      kind,
      timelineStartMs,
      sourceDurationMs,
      sourceStartMs,
      durationMs,
      volume,
      muted: clip.muted,
      locked: clip.locked,
      linkedGroupId,
      fit: kind === "video" ? (fit ?? "contain") : undefined,
    });
  }
  return clips;
}

function parseSlide(value: unknown): PitchSlide | null {
  const source = record(value);
  if (!source) return null;
  const id = typeof source.id === "string" && SLIDE_ID_PATTERN.test(source.id) ? source.id : null;
  const name = boundedText(source.name, 80);
  const version = finiteInteger(source.version, 1);
  const durationMs =
    source.durationMs === undefined
      ? PITCH_SLIDE_DEFAULT_DURATION_MS
      : finiteInteger(source.durationMs, PITCH_SLIDE_DURATION_RANGE_MS.min);
  const updatedAt =
    typeof source.updatedAt === "number" &&
    Number.isFinite(source.updatedAt) &&
    source.updatedAt > 0
      ? source.updatedAt
      : null;
  const deletedAt =
    source.deletedAt === undefined
      ? undefined
      : typeof source.deletedAt === "number" &&
          Number.isFinite(source.deletedAt) &&
          source.deletedAt > 0
        ? source.deletedAt
        : null;
  const elements = parseElements(source.elements);
  const assetIds = parseAssetIds(source.assetIds);
  const mediaClips =
    durationMs === null || durationMs > PITCH_SLIDE_DURATION_RANGE_MS.max
      ? null
      : parseMediaClips(source.mediaClips, durationMs);
  const inkLayers = parseInkLayers(source.inkLayers);
  if (
    !id ||
    !name ||
    version === null ||
    durationMs === null ||
    durationMs > PITCH_SLIDE_DURATION_RANGE_MS.max ||
    updatedAt === null ||
    deletedAt === null ||
    !elements ||
    !assetIds ||
    !mediaClips ||
    !inkLayers
  ) {
    return null;
  }
  return {
    id,
    name,
    version,
    updatedAt,
    durationMs,
    deletedAt,
    elements,
    assetIds,
    mediaClips,
    inkLayers: inkLayers.length > 0 ? inkLayers : undefined,
  };
}

export function parsePitchDocument(
  value: unknown,
  maximumSlides: number,
): { ok: true; document: PitchDocument } | { ok: false; error: string } {
  let serialised: string;
  try {
    serialised = JSON.stringify(value);
  } catch {
    return { ok: false, error: "This deck contains data the studio cannot save" };
  }
  if (new TextEncoder().encode(serialised).byteLength > PITCH_DOCUMENT_MAX_BYTES) {
    return { ok: false, error: "This deck is too large to sync" };
  }

  const source = record(value);
  if (source?.schemaVersion !== PITCH_DOCUMENT_SCHEMA_VERSION || !Array.isArray(source.slides)) {
    return { ok: false, error: "This deck was made by an unsupported studio version" };
  }
  if (source.slides.length === 0 || source.slides.length > maximumSlides * 2) {
    return { ok: false, error: `A deck can contain up to ${maximumSlides} slides` };
  }

  const slides: PitchSlide[] = [];
  const slideIds = new Set<string>();
  let visibleSlides = 0;
  let elements = 0;
  for (const value of source.slides) {
    const slide = parseSlide(value);
    if (!slide || slideIds.has(slide.id)) {
      return { ok: false, error: "The deck contains an invalid slide" };
    }
    slideIds.add(slide.id);
    if (!slide.deletedAt) visibleSlides += 1;
    elements += slide.elements.length;
    slides.push(slide);
  }

  if (visibleSlides < 1 || visibleSlides > maximumSlides) {
    return { ok: false, error: `A deck must contain between 1 and ${maximumSlides} slides` };
  }
  if (elements > PITCH_MAX_ELEMENTS) {
    return { ok: false, error: "This deck contains too many objects" };
  }
  return {
    ok: true,
    document: { schemaVersion: PITCH_DOCUMENT_SCHEMA_VERSION, slides },
  };
}

export function isPitchDeckId(value: string): boolean {
  return DECK_ID_PATTERN.test(value);
}

export function isPitchAssetId(value: string): boolean {
  return ASSET_ID_PATTERN.test(value);
}

export function isPitchMutationId(value: string): boolean {
  return MUTATION_ID_PATTERN.test(value);
}

export function isPitchCreateRequestId(value: string): boolean {
  return CREATE_REQUEST_ID_PATTERN.test(value);
}

export function isPitchOwnerToken(value: string): boolean {
  return TOKEN_PATTERN.test(value);
}

export function isPitchAssetKind(value: string): value is PitchAssetKind {
  return ASSET_KINDS.has(value as PitchAssetKind);
}

export function parsePitchTitle(value: unknown): string | null {
  return boundedText(value, 120);
}

export function parsePitchOwnerName(value: unknown): string | null {
  return boundedText(value, 120);
}
