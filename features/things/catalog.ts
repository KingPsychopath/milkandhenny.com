import { THING_OFFLINE } from "./offline";

export interface Thing {
  slug:
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
  href:
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
    slug: "family-feud",
    name: "family feud",
    description: "Two teams, ten answers, and one host running the room from their phone.",
    eyebrow: "team game · 2–40 people",
    href: "/things/family-feud",
    status: "ready",
    mark: { kind: "icon", value: "feud" },
    offline: null,
  },
  {
    slug: "hot-and-cold",
    name: "hot and cold",
    description: "Guess the hidden word. Lower numbers take you closer to the heat.",
    eyebrow: "word hunt · 1–8 people",
    href: "/things/hot-and-cold",
    status: "ready",
    mark: { kind: "icon", value: "temperature" },
    offline: null,
  },
  {
    slug: "centre",
    name: "centre",
    description: "Hold the start. Find the route. First to the middle wins.",
    eyebrow: "maze race · 1–8 people",
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
    eyebrow: "party game · 3–16 people",
    href: "/things/same-brain",
    status: "ready",
    mark: { kind: "icon", value: "brain" },
    offline: null,
  },
  {
    slug: "twin",
    name: "twin",
    description: "Two cards, one shared symbol. Find it first and empty your hand.",
    eyebrow: "speed matching · 1–10 people",
    href: "/things/twin",
    status: "ready",
    mark: { kind: "icon", value: "pair" },
    offline: THING_OFFLINE.twin,
  },
  {
    slug: "mafia",
    name: "mafia",
    description: "The town sleeps. The mafia chooses. Find them before they take over.",
    eyebrow: "social deduction · 5–16 people",
    href: "/things/mafia",
    status: "ready",
    mark: { kind: "symbol", value: "◒" },
    offline: null,
  },
  {
    slug: "imposter",
    name: "imposter",
    description: "Everyone knows the secret word except the imposter. Blend in or find the liar.",
    eyebrow: "social deduction · 4–16 people",
    href: "/things/imposter",
    status: "ready",
    mark: { kind: "symbol", value: "◑" },
    offline: null,
  },
  {
    slug: "pitches",
    name: "pitch night studio",
    description: "Make six slides, seal the idea, and take over the big screen.",
    eyebrow: "slides · draw, type, paste",
    href: "/things/pitches",
    status: "ready",
    mark: { kind: "symbol", value: "▱" },
    offline: THING_OFFLINE.pitches,
  },
  {
    slug: "draw-country",
    name: "draw the country",
    description: "Draw a country from memory and see how close you get.",
    eyebrow: "drawing game · 1–16 people",
    href: "/things/draw-country",
    status: "ready",
    mark: { kind: "symbol", value: "◇" },
    offline: THING_OFFLINE["draw-country"],
  },
  {
    slug: "spelling-bee",
    name: "spelling bee",
    description: "Hear the word. Spell it aloud, together or solo.",
    eyebrow: "word game · 1+ people",
    href: "/things/spelling-bee",
    status: "ready",
    mark: { kind: "symbol", value: "æ" },
    offline: THING_OFFLINE["spelling-bee"],
  },
  {
    slug: "heads-up",
    name: "heads up",
    description: "Guess the card from your friends' clues.",
    eyebrow: "party game · 2+ people",
    href: "/things/heads-up",
    status: "ready",
    mark: { kind: "symbol", value: "↕" },
    offline: THING_OFFLINE["heads-up"],
  },
  {
    slug: "icebreaker",
    name: "icebreaker",
    description: "Reveal a colour and find your people.",
    eyebrow: "social tool · groups",
    href: "/things/icebreaker",
    status: "ready",
    mark: { kind: "symbol", value: "◉" },
    offline: THING_OFFLINE.icebreaker,
  },
] satisfies readonly Thing[];
