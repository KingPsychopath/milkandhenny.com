const SCORE_REACTIONS = [
  {
    minimum: 100,
    lines: ["the atlas has nothing left to teach you", "did you trace the planet?"],
  },
  {
    minimum: 90,
    lines: ["the coastline bows", "cartographic witchcraft", "the atlas is intimidated"],
  },
  {
    minimum: 75,
    lines: ["the cartographers approve", "suspiciously well travelled", "the border remembers you"],
  },
  {
    minimum: 55,
    lines: ["the atlas is nodding", "you found the coastline", "respectably map-shaped"],
  },
  {
    minimum: 35,
    lines: [
      "recognisable from a polite distance",
      "the atlas is squinting, but it sees it",
      "the right country, a different coastline",
    ],
  },
  {
    minimum: 15,
    lines: [
      "the border took the scenic route",
      "geography, but make it abstract",
      "the atlas has questions",
    ],
  },
  {
    minimum: 0,
    lines: [
      "the cartographer has left the chat",
      "boldly unmapped",
      "that country is now in witness protection",
    ],
  },
] as const;

function hash(value: string) {
  let result = 0;
  for (const character of value) result = (result * 31 + character.charCodeAt(0)) >>> 0;
  return result;
}

export function resultReaction(score: number, seed: string) {
  const reaction =
    SCORE_REACTIONS.find(({ minimum }) => score >= minimum) ?? SCORE_REACTIONS.at(-1);
  if (!reaction) return "adventurous";
  return reaction.lines[hash(`${seed}:${score}`) % reaction.lines.length];
}
