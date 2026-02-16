"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { useOutsideClick } from "@/hooks/useOutsideClick";
import { useEscapeKey } from "@/hooks/useEscapeKey";

type ShareProps = {
  /** Full URL to share */
  url: string;
  /** Optional title for social prefill and native share */
  title?: string;
  /** Optional label override for accessibility */
  label?: string;
  /** Extra class for the container */
  className?: string;
};

const COPIED_DURATION_MS = 2000;

function canUseNativeShareOnMobile(): boolean {
  if (typeof window === "undefined") return false;
  return (
    typeof navigator.share === "function" &&
    /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
  );
}

/** Clipboard write with fallback for non-secure contexts (localhost / HTTP) */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch { /* not available — try fallback */ }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.cssText = "position:fixed;opacity:0;left:-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

function buildShareUrls(url: string, title: string) {
  const encodedUrl = encodeURIComponent(url);
  const encodedTitle = encodeURIComponent(title);
  return {
    twitter: `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedTitle}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`,
    whatsapp: `https://wa.me/?text=${encodedTitle}%20${encodedUrl}`,
    email: `mailto:?subject=${encodedTitle}&body=${encodedUrl}`,
  };
}

/**
 * Single "share" trigger.
 * - Mobile: opens native share sheet (copy, socials, AirDrop etc all included)
 * - Desktop: opens a dropdown with copy link + social options
 */
export function Share({ url, title = "", label = "Share", className = "" }: ShareProps) {
  const [copied, setCopied] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [isMobile] = useState<boolean>(() => canUseNativeShareOnMobile());
  const dropdownRef = useRef<HTMLDivElement>(null);
  const dropdownMenuRef = useFocusTrap<HTMLDivElement>(dropdownOpen);

  useEscapeKey(() => setDropdownOpen(false), dropdownOpen);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), COPIED_DURATION_MS);
    return () => clearTimeout(t);
  }, [copied]);

  useOutsideClick(dropdownRef, () => setDropdownOpen(false), dropdownOpen);

  const handleCopy = useCallback(async () => {
    const ok = await copyToClipboard(url);
    if (ok) setCopied(true);
  }, [url]);

  const handleClick = useCallback(async () => {
    if (!isMobile) {
      setDropdownOpen((open) => !open);
      return;
    }
    try {
      await navigator.share({ url, title: title || undefined });
    } catch {
      // User cancelled — do nothing
    }
  }, [isMobile, url, title]);

  const shareUrls = buildShareUrls(url, title);

  return (
    <div
      ref={dropdownRef}
      className={`relative inline-block font-mono text-[11px] theme-muted tracking-wide ${className}`}
      role="group"
      aria-label={label}
    >
      <button
        type="button"
        onClick={handleClick}
        aria-label={label}
        aria-expanded={dropdownOpen}
        aria-haspopup="true"
        className="inline-flex items-center gap-0.5 hover:text-foreground transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 rounded px-1 -mx-1"
      >
        {copied ? "copied" : "share"}
        {!isMobile && (
          <svg
            className={`w-3 h-3 ml-0.5 transition-transform ${dropdownOpen ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </button>
      {dropdownOpen && !isMobile && (
        <div
          ref={dropdownMenuRef}
          className="absolute right-0 top-full mt-1 py-1.5 min-w-[10rem] bg-background border theme-border rounded-sm shadow-lg z-10"
          role="menu"
        >
          {[
            { label: "Copy link", action: () => { handleCopy(); setDropdownOpen(false); } },
            { label: "X (Twitter)", action: () => window.open(shareUrls.twitter, "_blank", "noopener") },
            { label: "Facebook", action: () => window.open(shareUrls.facebook, "_blank", "noopener") },
            { label: "LinkedIn", action: () => window.open(shareUrls.linkedin, "_blank", "noopener") },
            { label: "WhatsApp", action: () => window.open(shareUrls.whatsapp, "_blank", "noopener") },
            { label: "Email", action: () => { window.location.href = shareUrls.email; } },
          ].map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => {
                item.action();
                if (item.label !== "Copy link") setDropdownOpen(false);
              }}
              className="block w-full text-left px-3 py-1.5 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
