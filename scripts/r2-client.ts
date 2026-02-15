/**
 * R2 client for CLI/scripts.
 *
 * Loads .env.local (not available outside the Next.js runtime) then
 * delegates to the shared lib/r2 module for all actual operations.
 *
 * Scripts import from here: `import { uploadBuffer } from "./r2-client"`
 * API routes import from `@/lib/r2` directly (Next.js provides env vars).
 */

import fs from "fs";
import path from "path";

/* ─── Load .env.local ─── */
const envPath = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  const envFile = fs.readFileSync(envPath, "utf-8");
  for (const line of envFile.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}

/* ─── Re-export from shared client ─── */

export {
  isConfigured,
  listObjects,
  listPrefixes,
  headObject,
  downloadBuffer,
  uploadBuffer,
  deleteObject,
  deleteObjects,
  getBucketInfo,
} from "../lib/r2";

export type { R2Object, BucketInfo } from "../lib/r2";
