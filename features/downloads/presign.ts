function isSafeStorageKeySegment(value: string): boolean {
  return value.length > 0 && !value.includes("/") && !value.includes("\\") && !value.includes("\0");
}

function isSafeDownloadFilename(filename: string): boolean {
  const name = filename.trim();
  if (!name || name.length > 180) return false;
  if (name === "." || name === "..") return false;
  return isSafeStorageKeySegment(name) && !name.includes("..");
}

function isAllowedDownloadStorageKey(key: string): boolean {
  const normalized = key.trim();
  if (!normalized || normalized.startsWith("/") || normalized.includes("\0")) return false;
  if (normalized.includes("\\") || normalized.includes("..")) return false;

  const parts = normalized.split("/");

  if (
    parts.length === 4 &&
    parts[0] === "albums" &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(parts[1]) &&
    parts[2] === "original" &&
    isSafeStorageKeySegment(parts[3]) &&
    /\.jpe?g$/i.test(parts[3])
  ) {
    return true;
  }

  if (
    parts.length === 4 &&
    parts[0] === "transfers" &&
    /^[a-z0-9_-]+(?:-[a-z0-9_-]+)*$/i.test(parts[1]) &&
    (parts[2] === "originals" || parts[2] === "derived") &&
    isSafeStorageKeySegment(parts[3])
  ) {
    return true;
  }

  return false;
}

function deriveDownloadFilename(key: string, requestedFilename?: string | null): string | null {
  if (requestedFilename) {
    const filename = requestedFilename.trim();
    return isSafeDownloadFilename(filename) ? filename : null;
  }

  const segments = key.split("/");
  const fallback = segments[segments.length - 1]?.trim() ?? "";
  return isSafeDownloadFilename(fallback) ? fallback : null;
}

function encodeContentDispositionFilename(filename: string): string {
  return encodeURIComponent(filename).replace(/['()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function buildAttachmentContentDisposition(filename: string): string {
  const quoted = filename.replace(/["\\]/g, "\\$&");
  return `attachment; filename="${quoted}"; filename*=UTF-8''${encodeContentDispositionFilename(filename)}`;
}

export {
  buildAttachmentContentDisposition,
  deriveDownloadFilename,
  isAllowedDownloadStorageKey,
};
