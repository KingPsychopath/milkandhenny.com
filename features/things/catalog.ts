import { THING_OFFLINE } from "./offline";

export interface Thing {
  slug: "icebreaker" | "heads-up";
  name: string;
  description: string;
  eyebrow: string;
  href: "/things/icebreaker" | "/things/heads-up";
  status: "ready";
  symbol: string;
  offline: (typeof THING_OFFLINE)[keyof typeof THING_OFFLINE] | null;
}

export const THINGS = [
  {
    slug: "heads-up",
    name: "forehead",
    description: "Guess the card from your friends' clues. Tilt down for correct, up to pass.",
    eyebrow: "party game · 2+ people",
    href: "/things/heads-up",
    status: "ready",
    symbol: "↕",
    offline: THING_OFFLINE["heads-up"],
  },
  {
    slug: "icebreaker",
    name: "icebreaker",
    description: "Find your colour, meet your group, and start a better conversation.",
    eyebrow: "social tool · groups",
    href: "/things/icebreaker",
    status: "ready",
    symbol: "◉",
    offline: THING_OFFLINE.icebreaker,
  },
] satisfies readonly Thing[];
