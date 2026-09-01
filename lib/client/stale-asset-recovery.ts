const RELOAD_KEY = "milkandhenny:stale-asset-reload";
const RELOAD_COOLDOWN_MS = 60_000;
const STALE_ASSET_ERROR =
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Loading chunk .+ failed/i;

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    return typeof error.message === "string" ? error.message : "";
  }
  return "";
}

export function isStaleAssetError(error: unknown) {
  return STALE_ASSET_ERROR.test(errorMessage(error));
}

export function canReloadStaleAssets(lastReloadAt: string | null, now = Date.now()) {
  const previous = Number(lastReloadAt);
  return !Number.isFinite(previous) || previous <= 0 || now - previous >= RELOAD_COOLDOWN_MS;
}

export function reloadForStaleAssets() {
  if (navigator.onLine === false) return false;
  try {
    if (!canReloadStaleAssets(sessionStorage.getItem(RELOAD_KEY))) return false;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    // Storage privacy settings should not turn a recoverable release mismatch into a hard stop.
  }
  location.reload();
  return true;
}
