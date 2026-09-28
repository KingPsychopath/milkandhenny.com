import { Effect } from "effect";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getAdminWorkspaceAccess } from "@/features/auth/auth.server";
import { runMultiplayerEffect } from "@/features/things/shared/multiplayer-runtime.server";
import { BestDressedService } from "./best-dressed-service.server";

export const getAdminBestDressedFn = createServerFn({ method: "GET" }).handler(async () => {
  const request = getRequest();
  const access = await getAdminWorkspaceAccess(request);
  if (!access.ok || !access.permissions.manageScoring)
    throw new Error("Scoring management access required");
  const [snapshot, windowState] = await Promise.all([
    runMultiplayerEffect(
      Effect.gen(function* () {
        return yield* (yield* BestDressedService).leaderboard;
      }),
      request.signal,
    ),
    runMultiplayerEffect(
      Effect.gen(function* () {
        return yield* (yield* BestDressedService).getVotingWindow;
      }),
      request.signal,
    ),
  ]);
  if (!windowState.ok) throw new Error(windowState.error);
  return { snapshot, windowState };
});
