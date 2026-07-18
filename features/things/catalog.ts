import { THING_OFFLINE } from "./offline";

export interface Thing {
  slug: "icebreaker" | "heads-up" | "spelling-bee" | "draw-country";
  name: string;
  description: string;
  eyebrow: string;
  href: "/things/icebreaker" | "/things/heads-up" | "/things/spelling-bee" | "/things/draw-country";
  status: "ready";
  symbol: string;
  offline: (typeof THING_OFFLINE)[keyof typeof THING_OFFLINE] | null;
}

export const THINGS = [
  {
    slug: "draw-country",
    name: "draw the country",
    description: "Draw a country from memory and see how close you get.",
    eyebrow: "drawing game · 1–16 people",
    href: "/things/draw-country",
    status: "ready",
    symbol: "◇",
    offline: THING_OFFLINE["draw-country"],
  },
  {
    slug: "spelling-bee",
    name: "spelling bee",
    description: "Hear the word. Spell it aloud—or type together.",
    eyebrow: "word game · 1+ people",
    href: "/things/spelling-bee",
    status: "ready",
    symbol: "æ",
    offline: THING_OFFLINE["spelling-bee"],
  },
  {
    slug: "heads-up",
    name: "forehead",
    description: "Guess the card from your friends' clues.",
    eyebrow: "party game · 2+ people",
    href: "/things/heads-up",
    status: "ready",
    symbol: "↕",
    offline: THING_OFFLINE["heads-up"],
  },
  {
    slug: "icebreaker",
    name: "icebreaker",
    description: "Reveal a colour and find your people.",
    eyebrow: "social tool · groups",
    href: "/things/icebreaker",
    status: "ready",
    symbol: "◉",
    offline: THING_OFFLINE.icebreaker,
  },
] satisfies readonly Thing[];
