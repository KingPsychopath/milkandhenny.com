import type {
  FamilyFeudAnswerDefinition,
  FamilyFeudCardDefinition,
  FamilyFeudPhase,
  FamilyFeudTeamId,
} from "./types";

export const FAMILY_FEUD_ROUND_OPTIONS = [4, 6, 8] as const;
export const FAMILY_FEUD_MAIN_SECOND_OPTIONS = [30, 45, 60] as const;
export const FAMILY_FEUD_STEAL_SECOND_OPTIONS = [10, 15] as const;
export const FAMILY_FEUD_DEFAULT_ROUNDS = 6;
export const FAMILY_FEUD_DEFAULT_MAIN_SECONDS = 45;
export const FAMILY_FEUD_DEFAULT_STEAL_SECONDS = 10;
export const FAMILY_FEUD_FACE_OFF_SECONDS = 5;
export const FAMILY_FEUD_PLAYER_LIMITS = { min: 2, max: 40 } as const;
export const FAMILY_FEUD_CARD_ANSWER_TOTAL = 10;

export function familyFeudBoardValue(position: number) {
  if (!Number.isInteger(position) || position < 1 || position > FAMILY_FEUD_CARD_ANSWER_TOTAL)
    return 0;
  return FAMILY_FEUD_CARD_ANSWER_TOTAL + 1 - position;
}

export const FAMILY_FEUD_PHASE_LABELS: Record<FamilyFeudPhase, string> = {
  lobby: "Pair the MC",
  rules: "How to play",
  practice: "Practice",
  "round-intro": "Next round",
  category: "The category",
  faceoff: "Face-off",
  "main-ready": "Main round",
  main: "Main round",
  "steal-ready": "Steal chance",
  steal: "Steal chance",
  "round-reveal": "The full board",
  "round-score": "Round complete",
  finished: "Final score",
};

export function otherFamilyFeudTeam(teamId: FamilyFeudTeamId): FamilyFeudTeamId {
  return teamId === "one" ? "two" : "one";
}

export function familyFeudActiveTeam(round: number, firstTeamId: FamilyFeudTeamId) {
  return round % 2 === 1 ? firstTeamId : otherFamilyFeudTeam(firstTeamId);
}

export function normaliseFamilyFeudAnswer(value: string) {
  return value
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/-+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function familyFeudAnswerMatches(answer: FamilyFeudAnswerDefinition, spoken: string) {
  const normalised = normaliseFamilyFeudAnswer(spoken);
  return [answer.label, ...answer.aliases].some(
    (candidate) => normaliseFamilyFeudAnswer(candidate) === normalised,
  );
}

export function validateFamilyFeudCard(card: FamilyFeudCardDefinition) {
  if (!card.id.trim() || !card.prompt.trim()) return false;
  if (card.answers.length !== FAMILY_FEUD_CARD_ANSWER_TOTAL) return false;
  const ids = new Set<string>();
  const labels = new Set<string>();
  for (const answer of card.answers) {
    const label = normaliseFamilyFeudAnswer(answer.label);
    if (!answer.id.trim() || !label || ids.has(answer.id) || labels.has(label)) return false;
    ids.add(answer.id);
    labels.add(label);
  }
  return true;
}

export function familyFeudPlacements(scores: Record<FamilyFeudTeamId, number>) {
  if (scores.one === scores.two)
    return {
      one: { placement: 1, won: true },
      two: { placement: 1, won: true },
    } as const;
  const winner = scores.one > scores.two ? "one" : "two";
  return {
    one: { placement: winner === "one" ? 1 : 2, won: winner === "one" },
    two: { placement: winner === "two" ? 1 : 2, won: winner === "two" },
  } as const;
}
