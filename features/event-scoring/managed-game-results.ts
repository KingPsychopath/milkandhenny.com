import type { OfficialResultPlayer } from "@/features/game-results/types";

export function pitchesPlayersFromBallots(input: {
  candidateParticipantIds: string[];
  ballots: Array<{ voterParticipantId: string; candidateParticipantId: string }>;
}): { ok: true; players: OfficialResultPlayer[] } | { ok: false; error: string } {
  const candidates = new Set(input.candidateParticipantIds);
  if (candidates.size < 2)
    return { ok: false, error: "Pitches needs at least two distinct candidates" };
  const voters = new Set<string>();
  const totals = new Map([...candidates].map((id) => [id, 0]));
  for (const ballot of input.ballots) {
    if (voters.has(ballot.voterParticipantId))
      return { ok: false, error: "Each participant can vote only once" };
    if (!candidates.has(ballot.candidateParticipantId))
      return { ok: false, error: "A ballot names an unknown candidate" };
    if (ballot.voterParticipantId === ballot.candidateParticipantId)
      return { ok: false, error: "A candidate cannot vote for themselves" };
    voters.add(ballot.voterParticipantId);
    totals.set(ballot.candidateParticipantId, (totals.get(ballot.candidateParticipantId) ?? 0) + 1);
  }
  const ordered = [...totals].sort(
    ([leftId, left], [rightId, right]) => right - left || leftId.localeCompare(rightId),
  );
  let previousVotes: number | undefined;
  let rank = 0;
  return {
    ok: true,
    players: ordered.map(([playerId, votes], index) => {
      if (votes !== previousVotes) rank = index + 1;
      previousVotes = votes;
      return {
        playerId,
        outcome: "completed",
        rawScore: votes,
        placement: rank,
        won: rank === 1,
      };
    }),
  };
}

export function icebreakerEncounterPlayers(participantIds: string[]) {
  const unique = [...new Set(participantIds)];
  if (unique.length !== 2)
    return { ok: false as const, error: "An Icebreaker encounter needs two distinct people" };
  return {
    ok: true as const,
    players: unique.sort().map((playerId) => ({
      playerId,
      outcome: "completed" as const,
      rawScore: 1,
      won: true,
    })),
  };
}
