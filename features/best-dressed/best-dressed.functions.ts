import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { requireAdminStepUp, authenticateRequest } from "@/features/auth/auth.server";
import {
  clearBestDressedVotes,
  getBestDressedLeaderboardSnapshot,
  getBestDressedSnapshot,
  voteBestDressed,
} from "./best-dressed.server";
import type { VoteInput } from "./best-dressed.server";

export const getBestDressedSnapshotFn = createServerFn({ method: "GET" }).handler(() =>
  getBestDressedSnapshot(),
);

export const voteBestDressedFn = createServerFn({ method: "POST" })
  .validator((data: VoteInput) => data)
  .handler(({ data }) => voteBestDressed(data));

export const getBestDressedLeaderboardFn = createServerFn({ method: "GET" }).handler(() =>
  getBestDressedLeaderboardSnapshot(),
);

export const clearBestDressedVotesFn = createServerFn({ method: "POST" }).handler(async () => {
  const request = getRequest();
  const auth = await authenticateRequest(request, "admin");
  if (!auth.ok) return { ok: false as const, status: auth.status, error: auth.error };

  const stepUpError = await requireAdminStepUp(request);
  if (stepUpError) {
    const result: unknown = await stepUpError.json().catch(() => null);
    const error =
      result && typeof result === "object" && "error" in result && typeof result.error === "string"
        ? result.error
        : "Unauthorized";
    return { ok: false as const, status: stepUpError.status, error };
  }

  const result = await clearBestDressedVotes();
  return { ok: true as const, session: result.session };
});
