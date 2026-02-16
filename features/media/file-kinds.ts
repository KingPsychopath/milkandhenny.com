/**
 * File kind classification constants.
 * Client-safe — no Node imports. Shared across lib/transfers, scripts/media-processing, etc.
 */

/** All the kinds a file can be — drives gallery rendering decisions */
const FILE_KINDS = ["image", "video", "gif", "audio", "file"] as const;
type FileKind = (typeof FILE_KINDS)[number];

export { FILE_KINDS };
export type { FileKind };
