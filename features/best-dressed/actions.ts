"use server";

import { requireAuthFromServerContext, requireAdminStepUp } from "@/features/auth/server";
import { NextRequest } from "next/server";
import { headers } from "next/headers";
import {
  clearBestDressedVotes,
  getBestDressedLeaderboardSnapshot,
  getBestDressedSnapshot,
  voteBestDressed,
  type VoteInput,
} from "./server";

// Synthetic in-memory request URL used to reuse NextRequest-based auth guards from
// Server Actions. This is NOT a real route and is never fetched over HTTP.
const INTERNAL_ACTIONS_URL_BASE = "http://localhost/__internal_actions";

export async function getBestDressedSnapshotAction() {
  return getBestDressedSnapshot();
}

export async function voteBestDressedAction(input: VoteInput) {
  return voteBestDressed(input);
}

export async function getBestDressedLeaderboardSnapshotAction() {
  return getBestDressedLeaderboardSnapshot();
}

export async function clearBestDressedVotesAction() {
  // Admin-only + step-up enforced to match the API route behavior.
  const auth = await requireAuthFromServerContext("admin");
  if (!auth.ok) return { ok: false as const, status: auth.status, error: auth.error };

  // `requireAdminStepUp` currently expects a NextRequest. Build one from headers only.
  const h = await headers();
  const req = new NextRequest(
    new Request(`${INTERNAL_ACTIONS_URL_BASE}/best-dressed/clear`, {
      method: "POST",
      headers: new Headers(h),
    })
  );
  const stepUpErr = await requireAdminStepUp(req);
  if (stepUpErr) {
    const json = await stepUpErr.json().catch(() => ({}));
    return { ok: false as const, status: stepUpErr.status, error: (json.error as string) || "Unauthorized" };
  }

  const result = await clearBestDressedVotes();
  return { ok: true as const, session: result.session };
}
