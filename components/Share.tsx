"use client";

import { useState, useRef, useEffect } from "react";

type ShareProps = {
  /** Full URL to share (e.g. https://milkandhenny.com/blog/my-post) */
  url: string;
  /** Optional title for social prefill and native share */
  title?: string;
  /** Optional label override for accessibility */
  label?: string;
  /** Extra class for the container */
  className?: string;
};

const COPIED_DURATION_MS = 2000;

/** Native share only makes sense on mobile/tablet — on desktop, the dropdown is better UX */
function canNativeShare(): boolean {
  if (typeof navigator.share !== "function") return false;
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

/** Clipboard write with fallback for non-secure contexts (localhost / HTTP) */
async function copyToClipboard(text: string): Promise<boolean> {
  // Preferred: Clipboard API (requires HTTPS)
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch { /* not available — try fallback */ }

  // Fallback: hidden textarea + execCommand
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

export function Share({ url, title = "", label = "Share", className = "" }: ShareProps) {
  const [copied, setCopied] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), COPIED_DURATION_MS);
    return () => clearTimeout(t);
  }, [copied]);

  useEffect(() => {
    if (!dropdownOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [dropdownOpen]);

  async function handleCopy() {
    const ok = await copyToClipboard(url);
    if (ok) setCopied(true);
  }

  async function handleShareClick() {
    if (!canNativeShare()) {
      setDropdownOpen((open) => !open);
      return;
    }
    try {
      await navigator.share({ url, title: title || undefined });
      setDropdownOpen(false);
    } catch {
      // User cancelled or share failed — open dropdown as fallback
      setDropdownOpen(true);
    }
  }

  const shareUrls = buildShareUrls(url, title);

  return (
    <div
      ref={dropdownRef}
      className={`inline-flex items-center gap-1 font-mono text-[11px] theme-muted tracking-wide ${className}`}
      aria-label={label}
    >
      <button
        type="button"
        onClick={handleCopy}
        className="hover:text-foreground transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 rounded px-1 -mx-1"
      >
        {copied ? "copied" : "copy link"}
      </button>
      <span className="theme-faint" aria-hidden>
        ·
      </span>
      <div className="relative inline-block">
        <button
          type="button"
          onClick={handleShareClick}
          aria-expanded={dropdownOpen}
          aria-haspopup="true"
          className="inline-flex items-center gap-0.5 hover:text-foreground transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 rounded px-1 -mx-1"
        >
          share
          <svg
            className={`w-3 h-3 ml-0.5 transition-transform ${dropdownOpen ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {dropdownOpen && (
          <div
            className="absolute right-0 top-full mt-1 py-1.5 min-w-[10rem] bg-background border theme-border rounded-sm shadow-lg z-10"
            role="menu"
          >
            {[
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
                  setDropdownOpen(false);
                }}
                className="block w-full text-left px-3 py-1.5 hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
