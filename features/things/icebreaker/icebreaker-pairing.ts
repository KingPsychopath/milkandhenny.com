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

export interface IcebreakerEncounter {
  id: string;
  partnerId: string;
  ownColourCode: Colour["code"];
  partnerColourCode: Colour["code"];
  kind: PairingResult["kind"];
  name: string;
  question: string;
  firstMetAt: string;
  lastMetAt: string;
}

export interface IcebreakerLedger {
  version: 1;
  ownerId: string;
  ownerColourCode: Colour["code"];
  encounters: IcebreakerEncounter[];
}

export interface EncounterOutcome {
  encounter: IcebreakerEncounter | null;
  ledger: IcebreakerLedger;
  persisted?: boolean;
  status: "new" | "repeat" | "self";
}

export const MAX_LEDGER_ENCOUNTERS = 100;

const PLAYER_ID_PATTERN = /^[A-Z2-9]{5}$/;
const CODE_PATTERN = /^(?:MH1-)?([RSEATOLC])-([A-Z2-9]{5})$/;
const MAX_PAIRING_INPUT_LENGTH = 512;

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

function colourFromCode(code: unknown): Colour | null {
  return typeof code === "string"
    ? (COLOURS.find((candidate) => candidate.code === code) ?? null)
    : null;
}

function pairingValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_PAIRING_INPUT_LENGTH) return null;

  const hashIndex = trimmed.indexOf("#");
  if (hashIndex >= 0) {
    const parameters = new URLSearchParams(trimmed.slice(hashIndex + 1));
    return parameters.get("pair");
  }
  return trimmed.startsWith("pair=") ? new URLSearchParams(trimmed).get("pair") : trimmed;
}

export function isPlayerId(value: string) {
  return PLAYER_ID_PATTERN.test(value);
}

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

export function pairingUrl(origin: string, player: IcebreakerPlayer) {
  const cleanOrigin = origin.replace(/\/$/, "");
  return `${cleanOrigin}/things/icebreaker#pair=${encodeURIComponent(pairingPayload(player))}`;
}

export function parsePairingCode(value: string): IcebreakerPlayer | null {
  const candidate = pairingValue(value);
  if (!candidate) return null;
  const match = CODE_PATTERN.exec(candidate.trim().toUpperCase().replaceAll(" ", ""));
  if (!match) return null;
  const colour = colourFromCode(match[1]);
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

export function encounterId(firstId: string, secondId: string) {
  return [firstId, secondId].sort().join(".");
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

export function createEmptyLedger(player: IcebreakerPlayer): IcebreakerLedger {
  return {
    version: 1,
    ownerId: player.id,
    ownerColourCode: player.colour.code,
    encounters: [],
  };
}

function isValidTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length <= 40 && !Number.isNaN(Date.parse(value));
}

function parseEncounter(value: unknown, player: IcebreakerPlayer): IcebreakerEncounter | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<IcebreakerEncounter>;
  const partnerColour = colourFromCode(record.partnerColourCode);
  if (
    typeof record.partnerId !== "string" ||
    !isPlayerId(record.partnerId) ||
    record.partnerId === player.id ||
    record.ownColourCode !== player.colour.code ||
    !partnerColour ||
    !isValidTimestamp(record.firstMetAt) ||
    !isValidTimestamp(record.lastMetAt)
  ) {
    return null;
  }

  const partner = { id: record.partnerId, colour: partnerColour };
  const result = createPairingResult(player, partner);
  return {
    id: encounterId(player.id, partner.id),
    partnerId: partner.id,
    ownColourCode: player.colour.code,
    partnerColourCode: partner.colour.code,
    kind: result.kind,
    name: result.name,
    question: result.question,
    firstMetAt: record.firstMetAt,
    lastMetAt: record.lastMetAt,
  };
}

export function parseLedger(value: string | null, player: IcebreakerPlayer): IcebreakerLedger {
  if (!value) return createEmptyLedger(player);
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return createEmptyLedger(player);
    const record = parsed as Partial<IcebreakerLedger>;
    if (
      record.version !== 1 ||
      record.ownerId !== player.id ||
      record.ownerColourCode !== player.colour.code ||
      !Array.isArray(record.encounters)
    ) {
      return createEmptyLedger(player);
    }

    const unique = new Map<string, IcebreakerEncounter>();
    for (const candidate of record.encounters) {
      const encounter = parseEncounter(candidate, player);
      if (encounter && !unique.has(encounter.partnerId)) {
        unique.set(encounter.partnerId, encounter);
      }
      if (unique.size === MAX_LEDGER_ENCOUNTERS) break;
    }
    return { ...createEmptyLedger(player), encounters: [...unique.values()] };
  } catch {
    return createEmptyLedger(player);
  }
}

export function recordEncounter(
  ledger: IcebreakerLedger,
  player: IcebreakerPlayer,
  partner: IcebreakerPlayer,
  now: string,
): EncounterOutcome {
  const current =
    ledger.ownerId === player.id && ledger.ownerColourCode === player.colour.code
      ? ledger
      : createEmptyLedger(player);
  if (partner.id === player.id) return { encounter: null, ledger: current, status: "self" };

  const existing = current.encounters.find((encounter) => encounter.partnerId === partner.id);
  if (existing) {
    const updated = { ...existing, lastMetAt: now };
    return {
      encounter: updated,
      ledger: {
        ...current,
        encounters: [updated, ...current.encounters.filter((item) => item.id !== updated.id)],
      },
      status: "repeat",
    };
  }

  const result = createPairingResult(player, partner);
  const encounter: IcebreakerEncounter = {
    id: encounterId(player.id, partner.id),
    partnerId: partner.id,
    ownColourCode: player.colour.code,
    partnerColourCode: partner.colour.code,
    kind: result.kind,
    name: result.name,
    question: result.question,
    firstMetAt: now,
    lastMetAt: now,
  };
  return {
    encounter,
    ledger: {
      ...current,
      encounters: [encounter, ...current.encounters].slice(0, MAX_LEDGER_ENCOUNTERS),
    },
    status: "new",
  };
}

export function encounterResult(encounter: IcebreakerEncounter): PairingResult | null {
  const partnerColour = colourFromCode(encounter.partnerColourCode);
  if (!partnerColour) return null;
  return {
    kind: encounter.kind,
    name: encounter.name,
    question: encounter.question,
    partner: { id: encounter.partnerId, colour: partnerColour },
  };
}
