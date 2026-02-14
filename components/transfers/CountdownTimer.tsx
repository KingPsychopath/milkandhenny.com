"use client";

import { useState, useEffect } from "react";

type CountdownTimerProps = {
  expiresAt: string;
};

/** Format remaining seconds into a human-readable countdown */
function formatCountdown(totalSeconds: number): string {
  if (totalSeconds <= 0) return "expired";

  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

/**
 * Live countdown timer that ticks every second.
 * Renders a static placeholder on the server to avoid hydration mismatch
 * (Date.now() differs between SSR and client), then starts ticking after mount.
 */
export function CountdownTimer({ expiresAt }: CountdownTimerProps) {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    const calc = () =>
      Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));

    setRemaining(calc());

    const interval = setInterval(() => {
      const next = calc();
      setRemaining(next);
      if (next <= 0) clearInterval(interval);
    }, 1000);

    return () => clearInterval(interval);
  }, [expiresAt]);

  // Before hydration, render a non-time-dependent placeholder
  if (remaining === null) {
    return (
      <span className="font-mono text-xs tracking-wide theme-muted">
        expires soon
      </span>
    );
  }

  const isUrgent = remaining > 0 && remaining < 3600; // < 1 hour
  const isExpired = remaining <= 0;

  return (
    <span
      className={`font-mono text-xs tracking-wide ${
        isExpired
          ? "text-red-500"
          : isUrgent
            ? "text-amber-500"
            : "theme-muted"
      }`}
    >
      {isExpired ? "expired" : `expires in ${formatCountdown(remaining)}`}
    </span>
  );
}
