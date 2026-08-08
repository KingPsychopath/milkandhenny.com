import { useCallback, useEffect, useState } from "react";
import { getStored, setStored } from "@/lib/client/storage";

type ThemePreference = "system" | "light" | "dark";

function storedPreference(): ThemePreference {
  const stored = getStored("theme");
  return stored === "light" || stored === "dark" ? stored : "system";
}

function nextPreference(preference: ThemePreference, systemDark: boolean): ThemePreference {
  if (preference === "system") return systemDark ? "light" : "dark";
  if (preference === (systemDark ? "light" : "dark")) return systemDark ? "dark" : "light";
  return "system";
}

function applyPreference(preference: ThemePreference, systemDark: boolean) {
  const dark = preference === "dark" || (preference === "system" && systemDark);
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
}

function ThemeIcon({ preference }: { preference: ThemePreference }) {
  if (preference === "light") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="3.5" />
        <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4m10.6 10.6 1.4 1.4m0-13.4-1.4 1.4M6.7 17.3l-1.4 1.4" />
      </svg>
    );
  }

  if (preference === "dark") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M20.2 15.2A8.5 8.5 0 0 1 8.8 3.8a8.5 8.5 0 1 0 11.4 11.4Z" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 4a8 8 0 0 1 0 16Z" className="theme-toggle-fill" />
    </svg>
  );
}

export function ThemeToggle() {
  const [preference, setPreference] = useState<ThemePreference>("system");
  const [systemDark, setSystemDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const saved = storedPreference();
    setSystemDark(media.matches);
    setPreference(saved);
    applyPreference(saved, media.matches);
    setMounted(true);

    const updateFromSystem = (event: MediaQueryListEvent) => {
      setSystemDark(event.matches);
      if (storedPreference() === "system") applyPreference("system", event.matches);
    };
    media.addEventListener("change", updateFromSystem);
    return () => media.removeEventListener("change", updateFromSystem);
  }, []);

  const cycle = useCallback(() => {
    const next = nextPreference(preference, systemDark);
    setPreference(next);
    setStored("theme", next);
    applyPreference(next, systemDark);
  }, [preference, systemDark]);

  if (!mounted) return null;

  const next = nextPreference(preference, systemDark);
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={cycle}
      aria-label={`Theme: ${preference}. Change to ${next}.`}
      title={`Theme: ${preference}`}
    >
      <ThemeIcon preference={preference} />
    </button>
  );
}
