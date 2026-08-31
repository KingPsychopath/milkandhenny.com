"use client";

import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import {
  readRememberedStaffAccess,
  type RememberedStaffAccess,
} from "@/features/event-scoring/staff-memory";
import { readRememberedScanners, type RememberedScanner } from "@/features/tickets/scanner-memory";
import { useGameNavigationSafety } from "@/features/things/shared/useSafeGameNavigation";

type RememberedWorkAccess =
  | { kind: "staff"; value: RememberedStaffAccess }
  | { kind: "scanner"; value: RememberedScanner };

function rememberedAccess(): RememberedWorkAccess[] {
  return [
    ...readRememberedStaffAccess().map((value) => ({ kind: "staff" as const, value })),
    ...readRememberedScanners().map((value) => ({ kind: "scanner" as const, value })),
  ].sort((left, right) => Date.parse(right.value.savedAt) - Date.parse(left.value.savedAt));
}

export function WorkAccessReturnPrompt() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [access, setAccess] = useState<RememberedWorkAccess[]>([]);
  const safeGameScreen = useGameNavigationSafety();

  useEffect(() => {
    if (pathname.startsWith("/scan") || /\/events\/[^/]+\/staff\//.test(pathname)) {
      setAccess([]);
      return;
    }
    setAccess(rememberedAccess());
  }, [pathname]);

  if (access.length === 0) return null;
  if (pathname.startsWith("/things/") && !safeGameScreen) return null;
  if (/^\/events\/[^/]+\/icebreaker$/.test(pathname)) return null;

  return (
    <details className="work-access-return-prompt group fixed bottom-3 left-3 z-40 font-mono">
      <summary className="flex min-h-11 cursor-pointer list-none items-center rounded-full border theme-border-strong bg-background px-4 text-xs shadow-lg hover:opacity-80">
        staff tools
        {access.length > 1 ? ` · ${access.length}` : ""}
      </summary>
      <nav
        aria-label="Remembered staff tools"
        className="absolute bottom-14 left-0 w-[min(22rem,calc(100vw-1.5rem))] rounded-2xl border theme-border-strong bg-background p-2 shadow-lg"
      >
        <ul className="divide-y theme-border">
          {access.map((entry) => (
            <li key={`${entry.kind}:${entry.value.token}`}>
              {entry.kind === "staff" ? (
                <Link
                  to="/events/$slug/staff/$token"
                  params={{ slug: entry.value.eventSlug, token: entry.value.token }}
                  className="block min-h-11 px-3 py-3 hover:opacity-70"
                >
                  <span className="block text-xs text-foreground">{entry.value.eventTitle}</span>
                  <span className="mt-1 block text-micro theme-muted">
                    {entry.value.label} ·{" "}
                    {(entry.value.rolePreset ?? entry.value.assignmentType).replaceAll("-", " ")}
                  </span>
                </Link>
              ) : (
                <Link
                  to="/scan/$token"
                  params={{ token: entry.value.token }}
                  className="block min-h-11 px-3 py-3 hover:opacity-70"
                >
                  <span className="block text-xs text-foreground">{entry.value.eventTitle}</span>
                  <span className="mt-1 block text-micro theme-muted">
                    {entry.value.station} · {entry.value.label}
                  </span>
                </Link>
              )}
            </li>
          ))}
        </ul>
      </nav>
    </details>
  );
}
