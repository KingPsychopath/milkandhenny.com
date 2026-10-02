import { THING_OFFLINE } from "./offline";

export interface Thing {
  slug:
    | "pairs"
    | "icebreaker"
    | "heads-up"
    | "spelling-bee"
    | "draw-country"
    | "pitches"
    | "mafia"
    | "imposter"
    | "same-brain"
    | "twin"
    | "centre"
    | "hot-and-cold"
    | "family-feud";
  name: string;
  description: string;
  eyebrow: string;
  category: "games" | "tools";
  minPlayers: number;
  href:
    | "/things/pairs"
    | "/things/icebreaker"
    | "/things/heads-up"
    | "/things/spelling-bee"
    | "/things/draw-country"
    | "/things/pitches"
    | "/things/mafia"
    | "/things/imposter"
    | "/things/same-brain"
    | "/things/twin"
    | "/things/centre"
    | "/things/hot-and-cold"
    | "/things/family-feud";
  status: "ready";
  mark:
    | { kind: "symbol"; value: string }
    | { kind: "icon"; value: "brain" | "feud" | "maze" | "pair" | "temperature" };
  offline: (typeof THING_OFFLINE)[keyof typeof THING_OFFLINE] | null;
}

export const THINGS = [
  {
    slug: "pairs",
    name: "pairs",
    description: "Match pairs from memory. Play solo, take turns, or race a friend.",
    eyebrow: "1–6 players",
    category: "games",
    minPlayers: 1,
    href: "/things/pairs",
    status: "ready",
    mark: { kind: "symbol", value: "♠" },
    offline: null,
  },
  {
    slug: "family-feud",
    name: "family feud",
    description: "Two teams, ten answers, and one host running the room from their phone.",
    eyebrow: "2–40 players",
    category: "games",
    minPlayers: 2,
    href: "/things/family-feud",
    status: "ready",
    mark: { kind: "icon", value: "feud" },
    offline: null,
  },
  {
    slug: "hot-and-cold",
    name: "hot and cold",
    description: "Guess the hidden word. Lower numbers take you closer to the heat.",
    eyebrow: "1–8 players",
    category: "games",
    minPlayers: 1,
    href: "/things/hot-and-cold",
    status: "ready",
    mark: { kind: "icon", value: "temperature" },
    offline: null,
  },
  {
    slug: "centre",
    name: "centre",
    description: "Hold the start. Find the route. First to the middle wins.",
    eyebrow: "1–8 players",
    category: "games",
    minPlayers: 1,
    href: "/things/centre",
    status: "ready",
    mark: { kind: "icon", value: "maze" },
    offline: THING_OFFLINE.centre,
  },
  {
    slug: "same-brain",
    name: "same brain",
    // The name is the goal; the description is the danger. "Odd one out" is how everybody already
    // describes this game to each other, so the card says it even though nothing is eliminated by
    // default — it is the phrase that makes the rules obvious without explaining them.
    description: "Answer like everyone else. Try not to be the odd one out.",
    eyebrow: "3–16 players",
    category: "games",
    minPlayers: 3,
    href: "/things/same-brain",
    status: "ready",
    mark: { kind: "icon", value: "brain" },
    offline: null,
  },
  {
    slug: "twin",
    name: "twin",
    description: "Two cards, one shared symbol. Find it first and empty your hand.",
    eyebrow: "1–10 players",
    category: "games",
    minPlayers: 1,
    href: "/things/twin",
    status: "ready",
    mark: { kind: "icon", value: "pair" },
    offline: THING_OFFLINE.twin,
  },
  {
    slug: "mafia",
    name: "mafia",
    description: "The town sleeps. The mafia chooses. Find them before they take over.",
    eyebrow: "5–16 players",
    category: "games",
    minPlayers: 5,
    href: "/things/mafia",
    status: "ready",
    mark: { kind: "symbol", value: "◒" },
    offline: null,
  },
  {
    slug: "imposter",
    name: "imposter",
    description: "Everyone knows the secret word except the imposter. Blend in or find the liar.",
    eyebrow: "4–16 players",
    category: "games",
    minPlayers: 4,
    href: "/things/imposter",
    status: "ready",
    mark: { kind: "symbol", value: "◑" },
    offline: null,
  },
  {
    slug: "pitches",
    name: "pitch night studio",
    description: "Make six slides, seal the idea, and take over the big screen.",
    eyebrow: "slides",
    category: "tools",
    minPlayers: 1,
    href: "/things/pitches",
    status: "ready",
    mark: { kind: "symbol", value: "▱" },
    offline: THING_OFFLINE.pitches,
  },
  {
    slug: "draw-country",
    name: "draw the country",
    description: "Draw a country from memory and see how close you get.",
    eyebrow: "1–16 players",
    category: "games",
    minPlayers: 1,
    href: "/things/draw-country",
    status: "ready",
    mark: { kind: "symbol", value: "◇" },
    offline: THING_OFFLINE["draw-country"],
  },
  {
    slug: "spelling-bee",
    name: "spelling bee",
    description: "Hear the word. Spell it aloud, together or solo.",
    eyebrow: "1+ players",
    category: "games",
    minPlayers: 1,
    href: "/things/spelling-bee",
    status: "ready",
    mark: { kind: "symbol", value: "æ" },
    offline: THING_OFFLINE["spelling-bee"],
  },
  {
    slug: "heads-up",
    name: "heads up",
    description: "Guess the card from your friends' clues.",
    eyebrow: "2+ players",
    category: "games",
    minPlayers: 2,
    href: "/things/heads-up",
    status: "ready",
    mark: { kind: "symbol", value: "↕" },
    offline: THING_OFFLINE["heads-up"],
  },
  {
    slug: "icebreaker",
    name: "icebreaker",
    description: "Reveal a colour and find your people.",
    eyebrow: "2+ people",
    category: "tools",
    minPlayers: 2,
    href: "/things/icebreaker",
    status: "ready",
    mark: { kind: "symbol", value: "◉" },
    offline: THING_OFFLINE.icebreaker,
  },
] satisfies readonly Thing[];
