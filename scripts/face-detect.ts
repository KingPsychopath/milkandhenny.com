/**
 * Focal point auto-detection — pluggable strategy system.
 *
 * Two built-in strategies:
 *   "onnx"  — UltraFace 320 neural network via ONNX Runtime (~1.2 MB model, true face detection)
 *   "sharp" — Sharp's attention-based saliency (skin tones + luminance + saturation, zero extra deps)
 *
 * Both return the same { x, y } percentage output. Easily swappable — album-ops
 * doesn't care which strategy produced the coordinates.
 *
 * To add a new strategy: implement FocalDetector, add it to STRATEGIES, done.
 *
 * @module face-detect
 */

import path from "path";
import sharp from "sharp";

/* ─── Shared types ─── */

/** A focal detection function. Returns { x, y } percentages (0–100) or null if nothing found. */
type FocalDetector = (raw: Buffer) => Promise<{ x: number; y: number } | null>;

/** Available strategy names */
const DETECTION_STRATEGIES = ["onnx", "sharp"] as const;
type DetectionStrategy = (typeof DETECTION_STRATEGIES)[number];

const DEFAULT_STRATEGY: DetectionStrategy = "onnx";

/* ═══════════════════════════════════════════════════════════════
   Strategy: ONNX (UltraFace 320)
   True face detection with bounding boxes and confidence scores.
   Requires: onnxruntime-node + models/ultraface-320.onnx (~1.2 MB)
   ═══════════════════════════════════════════════════════════════ */

const MODEL_PATH = path.join(process.cwd(), "models", "ultraface-320.onnx");
const INPUT_WIDTH = 320;
const INPUT_HEIGHT = 240;
const CONFIDENCE_THRESHOLD = 0.7;
const IOU_THRESHOLD = 0.5;

type OrtModule = typeof import("onnxruntime-node");
let ort: OrtModule | null = null;
let session: import("onnxruntime-node").InferenceSession | null = null;

/** Lazy-load ONNX Runtime (only when onnx strategy is used) */
async function getOrtSession() {
  if (!ort) {
    ort = await import("onnxruntime-node");
  }
  if (!session) {
    session = await ort.InferenceSession.create(MODEL_PATH, {
      logSeverityLevel: 3, // 0=verbose 1=info 2=warning 3=error — suppresses initializer warnings
    });
  }
  return { ort, session };
}

/** Resize to 320×240, normalize, transpose HWC → CHW */
async function preprocessOnnx(raw: Buffer) {
  const { ort: ortMod } = await getOrtSession();

  const { data } = await sharp(raw)
    .rotate()  // auto-orient from EXIF so faces are upright
    .resize(INPUT_WIDTH, INPUT_HEIGHT, { fit: "fill" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = new Float32Array(3 * INPUT_HEIGHT * INPUT_WIDTH);
  const hw = INPUT_HEIGHT * INPUT_WIDTH;

  for (let i = 0; i < hw; i++) {
    pixels[i] = (data[i * 3] - 127) / 128;
    pixels[hw + i] = (data[i * 3 + 1] - 127) / 128;
    pixels[2 * hw + i] = (data[i * 3 + 2] - 127) / 128;
  }

  return new ortMod.Tensor("float32", pixels, [1, 3, INPUT_HEIGHT, INPUT_WIDTH]);
}

type Box = { x1: number; y1: number; x2: number; y2: number; score: number };

function iou(a: Box, b: Box): number {
  const x1 = Math.max(a.x1, b.x1);
  const y1 = Math.max(a.y1, b.y1);
  const x2 = Math.min(a.x2, b.x2);
  const y2 = Math.min(a.y2, b.y2);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const areaA = (a.x2 - a.x1) * (a.y2 - a.y1);
  const areaB = (b.x2 - b.x1) * (b.y2 - b.y1);
  return inter / (areaA + areaB - inter + 1e-5);
}

function nms(boxes: Box[]): Box[] {
  const sorted = [...boxes].sort((a, b) => b.score - a.score);
  const kept: Box[] = [];
  for (const box of sorted) {
    if (kept.every((k) => iou(k, box) <= IOU_THRESHOLD)) {
      kept.push(box);
    }
  }
  return kept;
}

function decodeOutputs(
  scores: Float32Array,
  boxes: Float32Array,
  numAnchors: number
): Box[] {
  const detected: Box[] = [];
  for (let i = 0; i < numAnchors; i++) {
    const faceScore = scores[i * 2 + 1];
    if (faceScore < CONFIDENCE_THRESHOLD) continue;
    detected.push({
      x1: boxes[i * 4],
      y1: boxes[i * 4 + 1],
      x2: boxes[i * 4 + 2],
      y2: boxes[i * 4 + 3],
      score: faceScore,
    });
  }
  return nms(detected);
}

/**
 * Compute the area-weighted centroid of all detected faces.
 * Larger faces (closer to camera) contribute more to the focal point,
 * but all faces pull the crop toward the group — ideal for group photos.
 */
function weightedCentroid(faces: Box[]): { x: number; y: number } {
  let totalWeight = 0;
  let wx = 0;
  let wy = 0;

  for (const f of faces) {
    const area = (f.x2 - f.x1) * (f.y2 - f.y1);
    const cx = (f.x1 + f.x2) / 2;
    const cy = (f.y1 + f.y2) / 2;
    wx += cx * area;
    wy += cy * area;
    totalWeight += area;
  }

  return {
    x: Math.max(0, Math.min(100, Math.round((wx / totalWeight) * 100))),
    y: Math.max(0, Math.min(100, Math.round((wy / totalWeight) * 100))),
  };
}

/** ONNX strategy: true face detection via UltraFace neural network */
const detectWithOnnx: FocalDetector = async (raw) => {
  const { session: sess } = await getOrtSession();
  const inputTensor = await preprocessOnnx(raw);
  const results = await sess.run({ input: inputTensor });

  const scoresData = results.scores.data as Float32Array;
  const boxesData = results.boxes.data as Float32Array;
  const numAnchors = (results.scores.dims as number[])[1];

  const faces = decodeOutputs(scoresData, boxesData, numAnchors);
  if (faces.length === 0) return null;

  // Area-weighted centroid — works for solo portraits and group shots alike
  return weightedCentroid(faces);
};

/* ═══════════════════════════════════════════════════════════════
   Strategy: Sharp (attention-based saliency)
   Uses libvips under the hood — skin tones + luminance + saturation.
   No ML model, no extra deps, extremely fast. Not true face detection
   but works well for photos with people.
   ═══════════════════════════════════════════════════════════════ */

/** Target dimensions for attention crop analysis */
const ANALYSIS_WIDTH = 1200;
const ANALYSIS_HEIGHT = 630;

/** Sharp strategy: attention-based saliency crop position */
const detectWithSharp: FocalDetector = async (raw) => {
  // Auto-rotate so dimensions and saliency are orientation-correct
  const rotated = await sharp(raw).rotate().toBuffer();
  const meta = await sharp(rotated).metadata();
  const srcW = meta.width ?? 4032;
  const srcH = meta.height ?? 3024;

  // Scale factor to fill the target dimensions
  const scale = Math.max(ANALYSIS_WIDTH / srcW, ANALYSIS_HEIGHT / srcH);
  const scaledW = Math.round(srcW * scale);
  const scaledH = Math.round(srcH * scale);

  // Let Sharp's attention strategy decide where to crop
  const { info } = await sharp(rotated)
    .resize(ANALYSIS_WIDTH, ANALYSIS_HEIGHT, {
      fit: "cover",
      position: sharp.strategy.attention,
    })
    .toBuffer({ resolveWithObject: true });

  // Convert crop offset to focal center percentage
  const cropLeft = info.cropOffsetLeft ?? 0;
  const cropTop = info.cropOffsetTop ?? 0;
  const centerX = cropLeft + ANALYSIS_WIDTH / 2;
  const centerY = cropTop + ANALYSIS_HEIGHT / 2;

  const x = Math.round((centerX / scaledW) * 100);
  const y = Math.round((centerY / scaledH) * 100);

  // If it's basically center (45-55%), return null (no meaningful detection)
  if (x >= 45 && x <= 55 && y >= 45 && y <= 55) return null;

  return {
    x: Math.max(0, Math.min(100, x)),
    y: Math.max(0, Math.min(100, y)),
  };
};

/* ═══════════════════════════════════════════════════════════════
   Strategy registry — add new strategies here
   ═══════════════════════════════════════════════════════════════ */

const STRATEGIES: Record<DetectionStrategy, FocalDetector> = {
  onnx: detectWithOnnx,
  sharp: detectWithSharp,
};

/* ─── Public API ─── */

/**
 * Detect the best focal point for an image.
 * Returns { x, y } percentages or null if nothing interesting found.
 *
 * @param raw - Image buffer (JPEG, PNG, WebP, etc.)
 * @param strategy - Detection strategy: "onnx" (neural network) or "sharp" (saliency). Default: "onnx".
 */
async function detectFocal(
  raw: Buffer,
  strategy: DetectionStrategy = DEFAULT_STRATEGY
): Promise<{ x: number; y: number } | null> {
  const detector = STRATEGIES[strategy];
  if (!detector) {
    throw new Error(`Unknown detection strategy: "${strategy}". Use: ${DETECTION_STRATEGIES.join(", ")}`);
  }
  return detector(raw);
}

/**
 * Run all strategies on the same image and return results for comparison.
 * Useful for testing which strategy works best for your photos.
 */
async function compareStrategies(
  raw: Buffer
): Promise<Record<DetectionStrategy, { x: number; y: number } | null>> {
  const results = {} as Record<DetectionStrategy, { x: number; y: number } | null>;
  for (const name of DETECTION_STRATEGIES) {
    try {
      results[name] = await STRATEGIES[name](raw);
    } catch {
      results[name] = null;
    }
  }
  return results;
}

export {
  detectFocal,
  compareStrategies,
  detectWithOnnx,
  detectWithSharp,
  DETECTION_STRATEGIES,
  DEFAULT_STRATEGY,
};
export type { FocalDetector, DetectionStrategy };
