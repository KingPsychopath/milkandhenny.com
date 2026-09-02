import type { DoorTicketView } from "./types";

function normalise(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Enough typo tolerance for a noisy door without making unrelated names look equivalent. */
function oneEditAway(left: string, right: string): boolean {
  if (Math.abs(left.length - right.length) > 1) return false;
  if (left.length === right.length) {
    const mismatches = [...left].flatMap((character, index) =>
      character === right[index] ? [] : [index],
    );
    if (mismatches.length <= 1) return true;
    if (mismatches.length === 2) {
      const [first, second] = mismatches;
      if (second === first + 1 && left[first] === right[second] && left[second] === right[first])
        return true;
    }
    return false;
  }
  let leftIndex = 0;
  let rightIndex = 0;
  let edits = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (left.length > right.length) leftIndex += 1;
    else if (right.length > left.length) rightIndex += 1;
    else {
      leftIndex += 1;
      rightIndex += 1;
    }
  }
  return edits + Number(leftIndex < left.length || rightIndex < right.length) <= 1;
}

function matchRank(ticket: DoorTicketView, rawQuery: string): number | null {
  const query = normalise(rawQuery);
  if (!query) return null;
  const name = normalise(ticket.holderName);
  const reference = ticket.id.toLowerCase();
  if (reference === query || name === query) return 0;
  if (reference.startsWith(query) || name.startsWith(query)) return 1;
  if (name.includes(query)) return 2;

  const queryWords = query.split(" ");
  const nameWords = name.split(" ");
  if (
    queryWords.every((word) =>
      nameWords.some((candidate) => candidate.startsWith(word) || oneEditAway(candidate, word)),
    )
  ) {
    return 3;
  }
  return null;
}

export function searchDoorTickets<T extends DoorTicketView>(
  tickets: readonly T[],
  query: string,
  limit = 8,
): T[] {
  if (normalise(query).length < 2) return [];
  return tickets
    .map((ticket, index) => ({ ticket, index, rank: matchRank(ticket, query) }))
    .filter((entry): entry is typeof entry & { rank: number } => entry.rank !== null)
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        Number(Boolean(left.ticket.redeemedAt)) - Number(Boolean(right.ticket.redeemedAt)) ||
        left.index - right.index,
    )
    .slice(0, limit)
    .map((entry) => entry.ticket);
}
