import { appFragment, buildAppUrl } from "@/lib/shared/app-url";
import type { RemoteGameKind } from "./types";

export interface PairedGameJudgeInvite {
  judgeToken: string;
  playerToken?: string;
  game?: RemoteGameKind;
}

function remoteGameKind(value: string | null): RemoteGameKind | undefined {
  return value === "heads-up" || value === "spelling-bee" ? value : undefined;
}

export function pairedGameJudgePath(roomId: string) {
  return `/things/judge/${encodeURIComponent(roomId)}`;
}

export function pairedGamePlayerPath(roomId: string) {
  return `/things/play/${encodeURIComponent(roomId)}`;
}

export function pairedGameJudgeFragment(invite: PairedGameJudgeInvite) {
  return appFragment({
    judge: invite.judgeToken,
    player: invite.playerToken,
    game: invite.game,
  });
}

export function parsePairedGameJudgeFragment(fragment: string): PairedGameJudgeInvite {
  const value = fragment.replace(/^#/, "").trim();
  if (!value.includes("=")) return { judgeToken: value };
  const params = new URLSearchParams(value);
  return {
    judgeToken: params.get("judge") ?? "",
    playerToken: params.get("player") || undefined,
    game: remoteGameKind(params.get("game")),
  };
}

export function parsePairedGamePlayerFragment(fragment: string) {
  const value = fragment.replace(/^#/, "").trim();
  if (!value.includes("=")) return value;
  return new URLSearchParams(value).get("player") ?? "";
}

export function buildPairedGameJudgeInviteUrl(
  origin: string,
  roomId: string,
  invite: PairedGameJudgeInvite,
) {
  return buildAppUrl(origin, pairedGameJudgePath(roomId), {
    fragment: pairedGameJudgeFragment(invite),
  });
}

export function buildPairedGamePlayerInviteUrl(origin: string, roomId: string, playerToken: string) {
  return buildAppUrl(origin, pairedGamePlayerPath(roomId), {
    fragment: { player: playerToken },
  });
}
