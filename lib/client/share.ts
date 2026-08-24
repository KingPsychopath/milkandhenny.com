export type ShareOrCopyResult = "shared" | "copied" | "cancelled" | "failed";

export function canUseNativeShare(options: { coarsePointerOnly?: boolean } = {}) {
  if (typeof window === "undefined" || typeof navigator.share !== "function") return false;
  return (
    !options.coarsePointerOnly || window.matchMedia("(hover: none) and (pointer: coarse)").matches
  );
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
    document.body.appendChild(textarea);
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

/**
 * Native share sheet on phones, clipboard everywhere else.
 *
 * Desktop browsers expose `navigator.share`, but what it opens there is either nothing at all or an
 * OS sheet nobody asked for — and once we have awaited it, Safari no longer counts the click as a
 * user gesture, so the clipboard fallback is refused too. So the share sheet is for coarse pointers
 * only; on a laptop the link goes straight to the clipboard, which is what someone pressing "share
 * invite" next to a room code actually wants.
 */
export async function shareOrCopy(
  share: ShareData,
  options: { useNativeShare?: boolean; copyValue?: string } = {},
): Promise<ShareOrCopyResult> {
  const useNativeShare = options.useNativeShare ?? true;
  if (
    useNativeShare &&
    canUseNativeShare({ coarsePointerOnly: true }) &&
    (!navigator.canShare || navigator.canShare(share))
  ) {
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
