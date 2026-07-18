export type ShareOrCopyResult = "shared" | "copied" | "cancelled" | "failed";

export function canUseNativeShare(options: { coarsePointerOnly?: boolean } = {}) {
  if (typeof window === "undefined" || typeof navigator.share !== "function") return false;
  return !options.coarsePointerOnly || window.matchMedia("(hover: none) and (pointer: coarse)").matches;
}

export async function copyText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.readOnly = true;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      textarea.remove();
    }
  }
}

export async function shareOrCopy(
  share: ShareData,
  options: { useNativeShare?: boolean; copyValue?: string } = {},
): Promise<ShareOrCopyResult> {
  const useNativeShare = options.useNativeShare ?? true;
  if (useNativeShare && canUseNativeShare() && (!navigator.canShare || navigator.canShare(share))) {
    try {
      await navigator.share(share);
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
    }
  }
  const copyValue = options.copyValue ?? share.url ?? share.text;
  return copyValue && (await copyText(copyValue)) ? "copied" : "failed";
}
