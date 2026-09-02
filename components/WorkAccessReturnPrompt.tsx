"use client";

import { Link, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import {
  readRememberedStaffAccess,
  type RememberedStaffAccess,
} from "@/features/event-operations/staff-memory";
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
    <Link
      to="/work"
      className="work-access-return-prompt fixed bottom-3 left-3 z-40 inline-flex min-h-11 items-center rounded-full border theme-border-strong bg-background px-4 font-mono text-xs shadow-lg hover:opacity-80"
    >
      staff tools
    </Link>
  );
}
