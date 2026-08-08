/**
 * The symbol set. 31 shapes, which is a full order-5 deck (§2.2 of docs/twin.md).
 *
 * Everything is drawn in a 100×100 box, centred on (50,50), stroked in `currentColor` with no fills
 * except where a shape genuinely needs a solid dot. Nothing here may carry a hardcoded colour — the
 * card decides the ink.
 *
 * The one rule that constrains the whole set: **no shape may become another shape when rotated.**
 * Symbols are dealt at any angle, so a square and a rhombus are the same symbol, and so are a plus
 * and a saltire. Both pairs were caught by that rule and only one of each survives. The others were
 * chosen for distinct silhouettes at 44px: vertex counts that differ by more than one, closed
 * outlines against open line figures, and a few pictograms carrying detail no outline has.
 */

/** A full circle as two semicircular arcs — reliable, unlike a zero-length single arc. */
function circle(cx: number, cy: number, r: number) {
  return `M${cx - r} ${cy} A${r} ${r} 0 1 1 ${cx + r} ${cy} A${r} ${r} 0 1 1 ${cx - r} ${cy} Z`;
}

/** Rays from `inner` to `outer` at each angle, for the radial shapes. */
function rays(count: number, inner: number, outer: number, offset = 0) {
  return Array.from({ length: count }, (_unused, index) => {
    const angle = offset + (index * 2 * Math.PI) / count;
    const [dx, dy] = [Math.cos(angle), Math.sin(angle)];
    const from = [50 + dx * inner, 50 + dy * inner].map((n) => n.toFixed(1));
    const to = [50 + dx * outer, 50 + dy * outer].map((n) => n.toFixed(1));
    return `M${from[0]} ${from[1]} L${to[0]} ${to[1]}`;
  });
}

export interface TwinSymbolShape {
  id: string;
  /** One word. Used for the constellation's edge labels and for screen readers. */
  name: string;
  /** Stroked with `currentColor`, never filled. */
  paths: string[];
  /** Filled with `currentColor`. Only for shapes that need a solid mark. */
  fills?: string[];
}

export const TWIN_SYMBOLS: readonly TwinSymbolShape[] = [
  { id: "ring", name: "ring", paths: [circle(50, 50, 32)] },
  { id: "triangle", name: "triangle", paths: ["M50 14 L81 68 L19 68 Z"] },
  { id: "square", name: "square", paths: ["M22 22 H78 V78 H22 Z"] },
  { id: "pentagon", name: "pentagon", paths: ["M50 14 L84 39 L71 79 L29 79 L16 39 Z"] },
  { id: "hexagon", name: "hexagon", paths: ["M86 50 L68 81 L32 81 L14 50 L32 19 L68 19 Z"] },
  {
    id: "teardrop",
    name: "teardrop",
    paths: ["M50 12 C62 34 76 44 76 58 A26 26 0 1 1 24 58 C24 44 38 34 50 12 Z"],
  },
  {
    id: "crescent",
    name: "crescent",
    paths: ["M64 15 A38 38 0 1 0 64 85 A30 30 0 1 1 64 15 Z"],
  },
  {
    id: "heart",
    name: "heart",
    paths: ["M50 84 C22 63 13 45 13 35 A20 20 0 0 1 50 25 A20 20 0 0 1 87 35 C87 45 78 63 50 84 Z"],
  },
  { id: "leaf", name: "leaf", paths: ["M50 13 C75 32 75 68 50 87 C25 68 25 32 50 13 Z"] },
  {
    id: "capsule",
    name: "capsule",
    paths: ["M32 30 A18 18 0 0 1 68 30 V70 A18 18 0 0 1 32 70 Z"],
  },
  {
    id: "shield",
    name: "shield",
    paths: ["M50 13 L83 26 C83 56 68 79 50 88 C32 79 17 56 17 26 Z"],
  },
  {
    id: "blob",
    name: "blob",
    paths: [
      "M53 12 C74 10 89 31 80 49 C74 63 86 78 68 86 C54 92 40 80 27 83 C11 86 9 62 19 50 C28 39 21 19 38 14 Z",
    ],
  },
  {
    id: "star4",
    name: "sparkle",
    paths: ["M50 12 L59 41 L88 50 L59 59 L50 88 L41 59 L12 50 L41 41 Z"],
  },
  {
    id: "star5",
    name: "star",
    paths: ["M50 12 L59 37 L86 38 L65 55 L72 81 L50 66 L28 81 L35 55 L14 38 L41 37 Z"],
  },
  {
    id: "star6",
    name: "hexstar",
    paths: [
      "M88 50 L67 60 L69 83 L50 70 L31 83 L33 60 L12 50 L33 40 L31 17 L50 30 L69 17 L67 40 Z",
    ],
  },
  { id: "burst", name: "burst", paths: rays(8, 22, 38), fills: [circle(50, 50, 12)] },
  {
    id: "flower",
    name: "flower",
    paths: [
      circle(50, 28, 15),
      circle(70.9, 43.2, 15),
      circle(62.9, 69.1, 15),
      circle(37.1, 69.1, 15),
      circle(29.1, 43.2, 15),
    ],
  },
  { id: "cross", name: "cross", paths: ["M50 13 V87", "M13 50 H87"] },
  { id: "bolt", name: "bolt", paths: ["M59 12 L30 52 L48 52 L41 88 L72 44 L54 44 Z"] },
  { id: "wave", name: "wave", paths: ["M12 58 C24 32 36 84 50 50 C64 16 76 68 88 42"] },
  {
    id: "spiral",
    name: "spiral",
    paths: ["M50 50 C50 43 59 43 59 53 C59 65 44 65 44 48 C44 29 66 29 66 55 C66 80 37 80 37 46"],
  },
  { id: "chevron", name: "chevron", paths: ["M19 34 L50 67 L81 34"] },
  { id: "hook", name: "hook", paths: ["M64 13 V56 A20 20 0 1 1 28 56"] },
  {
    id: "infinity",
    name: "knot",
    paths: ["M50 50 C41 33 15 33 15 50 C15 67 41 67 50 50 C59 33 85 33 85 50 C85 67 59 67 50 50 Z"],
  },
  {
    id: "ladder",
    name: "ladder",
    paths: ["M32 13 V87", "M68 13 V87", "M32 32 H68", "M32 50 H68", "M32 68 H68"],
  },
  {
    id: "eye",
    name: "eye",
    paths: ["M13 50 C28 29 72 29 87 50 C72 71 28 71 13 50 Z"],
    fills: [circle(50, 50, 11)],
  },
  {
    id: "key",
    name: "key",
    paths: [circle(31, 34, 15), "M42 45 L82 85", "M64 60 L75 49", "M73 69 L84 58"],
  },
  {
    id: "anchor",
    name: "anchor",
    paths: ["M50 27 V85", "M30 43 H70", "M17 60 C17 78 32 87 50 87 C68 87 83 78 83 60"],
    fills: [circle(50, 18, 8)],
  },
  {
    id: "triad",
    name: "triad",
    paths: [],
    fills: [circle(50, 23, 12), circle(73, 65, 12), circle(27, 65, 12)],
  },
  { id: "window", name: "window", paths: ["M20 20 H80 V80 H20 Z", "M50 20 V80", "M20 50 H80"] },
  { id: "arrow", name: "arrow", paths: ["M50 87 V17", "M32 35 L50 15 L68 35"] },
] as const;

export const TWIN_SYMBOL_COUNT = TWIN_SYMBOLS.length;

const BY_ID = new Map(TWIN_SYMBOLS.map((symbol) => [symbol.id, symbol]));

export function twinSymbol(id: string) {
  return BY_ID.get(id) ?? null;
}

export function twinSymbolName(id: string) {
  return BY_ID.get(id)?.name ?? id;
}

/**
 * The symbol ids a deck of `count` symbols uses.
 *
 * Structured as a set from the start so a second look can be added later without the deck knowing
 * anything about it — `heads-up` and `spelling` both grew an alternate deck, and this one will too.
 */
export function twinSymbolIds(count: number) {
  if (count > TWIN_SYMBOLS.length)
    throw new Error(`The symbol set has ${TWIN_SYMBOLS.length} symbols; ${count} were asked for`);
  return TWIN_SYMBOLS.slice(0, count).map(({ id }) => id);
}
