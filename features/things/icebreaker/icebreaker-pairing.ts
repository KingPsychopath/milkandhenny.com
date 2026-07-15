export const COLOURS = [
  { code: "R", name: "Ruby", background: "oklch(0.58 0.22 25)", ink: "white" },
  { code: "S", name: "Sapphire", background: "oklch(0.53 0.2 255)", ink: "white" },
  { code: "E", name: "Emerald", background: "oklch(0.57 0.16 155)", ink: "white" },
  { code: "A", name: "Amethyst", background: "oklch(0.56 0.2 305)", ink: "white" },
  { code: "T", name: "Topaz", background: "oklch(0.78 0.16 78)", ink: "black" },
  { code: "O", name: "Rose", background: "oklch(0.66 0.2 5)", ink: "white" },
  { code: "C", name: "Coral", background: "oklch(0.68 0.19 45)", ink: "black" },
  { code: "L", name: "Teal", background: "oklch(0.61 0.12 190)", ink: "black" },
] as const;

export const QUESTIONS = [
  "What's a hill you're willing to die on?",
  "What's your most unpopular opinion?",
  "What's the best meal you've ever had?",
  "What's something you're irrationally afraid of?",
  "What's your go-to karaoke song?",
  "What's a skill you wish you had?",
  "What's the most spontaneous thing you've ever done?",
  "If you could live anywhere for a year, where would it be?",
  "What's the best advice you've ever received?",
  "What would your last meal be?",
  "What's something on your bucket list?",
  "What's the most overrated thing?",
] as const;

export type Colour = (typeof COLOURS)[number];

export interface IcebreakerPlayer {
  colour: Colour;
  id: string;
}

export interface PairingResult {
  kind: "match" | "mix";
  name: string;
  question: string;
  partner: IcebreakerPlayer;
}

const BLEND_NAMES: Record<string, string> = {
  "Amethyst-Coral": "Electric Sunset",
  "Amethyst-Emerald": "Enchanted Forest",
  "Amethyst-Rose": "Wild Orchid",
  "Amethyst-Ruby": "Velvet",
  "Amethyst-Sapphire": "Midnight",
  "Amethyst-Teal": "Northern Lights",
  "Amethyst-Topaz": "Golden Hour",
  "Coral-Emerald": "Secret Garden",
  "Coral-Rose": "Watermelon",
  "Coral-Ruby": "Bonfire",
  "Coral-Sapphire": "Afterglow",
  "Coral-Teal": "Reef",
  "Coral-Topaz": "Sunrise",
  "Emerald-Rose": "Rose Garden",
  "Emerald-Ruby": "Holly",
  "Emerald-Sapphire": "Deep Sea",
  "Emerald-Teal": "Lagoon",
  "Emerald-Topaz": "Meadow",
  "Rose-Ruby": "Raspberry",
  "Rose-Sapphire": "Twilight",
  "Rose-Teal": "Tropical",
  "Rose-Topaz": "Peach Fizz",
  "Ruby-Sapphire": "Cosmic",
  "Ruby-Teal": "Dragonfruit",
  "Ruby-Topaz": "Ember",
  "Sapphire-Teal": "Blue Lagoon",
  "Sapphire-Topaz": "Solar Flare",
  "Teal-Topaz": "Citrus Tide",
};

const CODE_PATTERN = /^(?:MH1-)?([RSEATOLC])-([A-Z2-9]{5})$/;

export function createPlayerId() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

export function pairingCode(player: IcebreakerPlayer) {
  return `${player.colour.code}-${player.id}`;
}

export function pairingPayload(player: IcebreakerPlayer) {
  return `MH1-${pairingCode(player)}`;
}

export function parsePairingCode(value: string): IcebreakerPlayer | null {
  const match = CODE_PATTERN.exec(value.trim().toUpperCase().replaceAll(" ", ""));
  if (!match) return null;
  const colour = COLOURS.find((candidate) => candidate.code === match[1]);
  const id = match[2];
  return colour && id ? { colour, id } : null;
}

function hashPair(firstId: string, secondId: string) {
  let hash = 2166136261;
  for (const character of [firstId, secondId].sort().join("")) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createPairingResult(
  player: IcebreakerPlayer,
  partner: IcebreakerPlayer,
): PairingResult {
  const question = QUESTIONS[hashPair(player.id, partner.id) % QUESTIONS.length] ?? QUESTIONS[0];
  if (player.colour.code === partner.colour.code) {
    return { kind: "match", name: `${player.colour.name} crew`, question, partner };
  }

  const key = [player.colour.name, partner.colour.name].sort().join("-");
  return {
    kind: "mix",
    name: BLEND_NAMES[key] ?? `${player.colour.name} mix`,
    question,
    partner,
  };
}
