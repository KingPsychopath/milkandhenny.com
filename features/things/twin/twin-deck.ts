import { TWIN_SYMBOL_COUNT, twinSymbolIds } from "./twin-symbols";

/**
 * The deck: a finite projective plane of order n, where symbols are points and cards are lines.
 *
 * Points of PG(2,n) are the non-zero triples over GF(n), normalised so the leading non-zero
 * coordinate is 1. Lines are indexed by the same triples, and a symbol lies on a card when their dot
 * product vanishes. That gives n²+n+1 cards, n+1 symbols on each, and **exactly one shared symbol
 * between any two cards** — the rule the entire game rests on.
 *
 * The trap, and the reason this file does field arithmetic rather than modular arithmetic: **GF(n) is
 * only the integers mod n when n is prime.** Order 4 is GF(2²) and its coefficients multiply modulo
 * an irreducible polynomial. The widely-copied version of this algorithm uses `% n` throughout, works
 * beautifully for 3, 5 and 7, and silently emits an order-4 deck whose cards share two symbols or
 * none. Order 4 is the duel deck, so that is the default path, not an edge case.
 */

/** Monic irreducible polynomials for the prime-power orders, low degree first, leading 1 included. */
const EXTENSIONS: Record<number, { prime: number; degree: number; polynomial: number[] }> = {
  4: { prime: 2, degree: 2, polynomial: [1, 1, 1] }, // x² + x + 1
  8: { prime: 2, degree: 3, polynomial: [1, 1, 0, 1] }, // x³ + x + 1
  9: { prime: 3, degree: 2, polynomial: [1, 0, 1] }, // x² + 1
};

interface GaloisField {
  order: number;
  add: (a: number, b: number) => number;
  multiply: (a: number, b: number) => number;
  inverse: (a: number) => number;
}

/**
 * GF(order) with elements as integers, each encoding its coefficient vector in base `prime`.
 * Tables rather than arithmetic at the call site: the orders here are at most 9, so the whole field
 * is a few hundred bytes and every operation becomes a lookup.
 */
function galoisField(order: number): GaloisField {
  const extension = EXTENSIONS[order];
  const prime = extension?.prime ?? order;
  const degree = extension?.degree ?? 1;

  const digits = (value: number) => {
    const result: number[] = [];
    for (let index = 0, rest = value; index < degree; index += 1, rest = Math.floor(rest / prime))
      result.push(rest % prime);
    return result;
  };
  const encode = (coefficients: number[]) =>
    coefficients.reduce((total, coefficient, index) => total + coefficient * prime ** index, 0);

  const addTable = new Int8Array(order * order);
  const multiplyTable = new Int8Array(order * order);
  for (let a = 0; a < order; a += 1)
    for (let b = 0; b < order; b += 1) {
      const [left, right] = [digits(a), digits(b)];
      addTable[a * order + b] = encode(left.map((value, index) => (value + right[index]) % prime));

      // Polynomial product, then reduced by the irreducible polynomial from the top down.
      const raw = Array<number>((degree - 1) * 2 + 1).fill(0);
      for (let i = 0; i < degree; i += 1)
        for (let j = 0; j < degree; j += 1) raw[i + j] = (raw[i + j] + left[i] * right[j]) % prime;
      if (extension)
        for (let power = raw.length - 1; power >= degree; power -= 1) {
          const coefficient = raw[power];
          if (coefficient === 0) continue;
          raw[power] = 0;
          for (let index = 0; index < degree; index += 1)
            raw[power - degree + index] =
              (raw[power - degree + index] -
                coefficient * extension.polynomial[index] +
                prime * prime) %
              prime;
        }
      multiplyTable[a * order + b] = encode(raw.slice(0, degree));
    }

  const inverses = new Int8Array(order).fill(-1);
  for (let a = 1; a < order; a += 1)
    for (let b = 1; b < order; b += 1) if (multiplyTable[a * order + b] === 1) inverses[a] = b;

  return {
    order,
    add: (a, b) => addTable[a * order + b],
    multiply: (a, b) => multiplyTable[a * order + b],
    inverse: (a) => inverses[a],
  };
}

export interface TwinCard {
  /** Stable for a given order, so a card can be referenced across a snapshot and a log. */
  id: string;
  symbolIds: string[];
}

/** Orders the symbol set can currently fill. Order 7 arrives with the remaining 26 symbols. */
export const TWIN_ORDERS = [4, 5, 7] as const;
export type TwinOrder = (typeof TWIN_ORDERS)[number];

export const TWIN_MIN_HAND = 3;
export const TWIN_MAX_HAND = 10;
export const TWIN_DEFAULT_HAND = 6;

export function twinDeckCapacity(order: number) {
  return order * order + order + 1;
}

export function twinSymbolsPerCard(order: number) {
  return order + 1;
}

/** Orders this build can actually deal, given how many symbols have been drawn. */
export function twinAvailableOrders(symbolCount = TWIN_SYMBOL_COUNT) {
  return TWIN_ORDERS.filter((order) => twinDeckCapacity(order) <= symbolCount);
}

const planeCache = new Map<number, readonly (readonly number[])[]>();

/**
 * The plane itself: each card as the list of point indices on it.
 *
 * Deliberately knows nothing about symbols. The geometry is valid for every prime-power order,
 * whereas the symbol set is art and only covers what has actually been drawn — tying the two together
 * would mean the maths could not be proven past the order we happen to have icons for.
 *
 * Cached: the construction is O(n⁶) and the answer never changes.
 */
export function twinPlane(order: number): readonly (readonly number[])[] {
  const cached = planeCache.get(order);
  if (cached) return cached;

  const field = galoisField(order);

  // Normalised representatives, in a deterministic order so card ids are stable across processes.
  const points: number[][] = [];
  const seen = new Set<string>();
  for (let x = 0; x < order; x += 1)
    for (let y = 0; y < order; y += 1)
      for (let z = 0; z < order; z += 1) {
        const triple = [x, y, z];
        const lead = triple.find((value) => value !== 0);
        if (lead === undefined) continue;
        const scale = field.inverse(lead);
        const normalised = triple.map((value) => field.multiply(value, scale));
        const key = normalised.join(",");
        if (seen.has(key)) continue;
        seen.add(key);
        points.push(normalised);
      }

  const lines = points.map((line) =>
    points.reduce<number[]>((indices, point, pointIndex) => {
      const dot = point.reduce(
        (sum, coefficient, axis) => field.add(sum, field.multiply(coefficient, line[axis])),
        0,
      );
      if (dot === 0) indices.push(pointIndex);
      return indices;
    }, []),
  );

  planeCache.set(order, lines);
  return lines;
}

const deckCache = new Map<number, readonly TwinCard[]>();

/** The plane with symbols painted on. Throws for an order the symbol set cannot cover. */
export function twinDeck(order: number): readonly TwinCard[] {
  const cached = deckCache.get(order);
  if (cached) return cached;

  const symbolIds = twinSymbolIds(twinDeckCapacity(order));
  const cards = twinPlane(order).map((line, index) => ({
    id: `o${order}c${index}`,
    symbolIds: line.map((point) => symbolIds[point]),
  }));

  deckCache.set(order, cards);
  return cards;
}

const byIdCache = new Map<number, Map<string, TwinCard>>();

/**
 * A card from its id.
 *
 * Room state stores `cardId` and a layout seed, never the symbol list — a hand of six cards would
 * otherwise carry forty-eight redundant strings into Redis and back out on every poll, and the deck is
 * derivable for free.
 */
export function twinCardById(order: number, id: string) {
  let index = byIdCache.get(order);
  if (!index) {
    index = new Map(twinDeck(order).map((card) => [card.id, card]));
    byIdCache.set(order, index);
  }
  return index.get(id) ?? null;
}

export interface TwinDeckPlan {
  order: TwinOrder;
  handSize: number;
}

/**
 * The deck order is derived from the table, never chosen.
 *
 * Two identical cards share every symbol, so the match stops being unique and the answer stops being
 * checkable — nothing may be dealt twice. That makes `players × hand + 1` a hard ceiling rather than
 * a preference. The host asks for a hand size; this shrinks it rather than exceed the deck.
 */
export function planTwinDeck(
  players: number,
  preferredHand = TWIN_DEFAULT_HAND,
  symbolCount = TWIN_SYMBOL_COUNT,
): TwinDeckPlan | null {
  const orders = twinAvailableOrders(symbolCount);
  const wanted = Math.max(TWIN_MIN_HAND, Math.min(TWIN_MAX_HAND, preferredHand));
  for (let handSize = wanted; handSize >= TWIN_MIN_HAND; handSize -= 1)
    for (const order of orders)
      if (players * handSize + 1 <= twinDeckCapacity(order)) return { order, handSize };
  return null;
}

/**
 * A ceiling the deck does not impose.
 *
 * The full 57-card deck would seat eighteen people at a hand of three, and that is not a game — three
 * heats, and a lobby nobody can read. Twelve is where a party still works.
 */
export const TWIN_MAX_PLAYERS = 12;

/** The largest table this build can seat, at the shortest hand worth playing. */
export function twinMaxPlayers(symbolCount = TWIN_SYMBOL_COUNT) {
  const orders = twinAvailableOrders(symbolCount);
  if (orders.length === 0) return 0;
  const capacity = Math.max(...orders.map(twinDeckCapacity));
  return Math.min(TWIN_MAX_PLAYERS, Math.floor((capacity - 1) / TWIN_MIN_HAND));
}

/** Deterministic given a seed, so a dealt game can be reproduced by a test or a saved scenario. */
export function twinRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffleTwinDeck<T>(items: readonly T[], random: () => number) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

export interface TwinDeal {
  /** One hand per player, in seat order. Index 0 of each hand is the top card. */
  hands: TwinCard[][];
  middle: TwinCard;
}

export function dealTwin(plan: TwinDeckPlan, players: number, seed: number): TwinDeal {
  const shuffled = shuffleTwinDeck(twinDeck(plan.order), twinRandom(seed));
  const needed = players * plan.handSize + 1;
  if (shuffled.length < needed)
    throw new Error(`Order ${plan.order} holds ${shuffled.length} cards; ${needed} were needed`);
  return {
    hands: Array.from({ length: players }, (_unused, seat) =>
      shuffled.slice(seat * plan.handSize, (seat + 1) * plan.handSize),
    ),
    middle: shuffled[players * plan.handSize],
  };
}

/** The single symbol two cards share. Null only if they are the same card, which never happens. */
export function twinMatch(left: TwinCard, right: TwinCard) {
  const shared = left.symbolIds.filter((id) => right.symbolIds.includes(id));
  return shared.length === 1 ? shared[0] : null;
}
