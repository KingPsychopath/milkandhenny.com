import { randomInt } from "node:crypto";

/**
 * Narration and word content. Server-only: the imposter's word must never reach a client that is
 * not entitled to it, and the narration template is chosen here so every device tells the same
 * story rather than each picking its own.
 */

export interface LiarsWordPair {
  /** What the crew are given. */
  word: string;
  /** What the understudy is given — close enough to survive a round, wrong enough to surface. */
  decoy: string;
}

/**
 * The pairing is the whole mechanic. Too far apart and the understudy is obvious on their first
 * clue; too close and the role is indistinguishable from a crew member and nobody can win. Each of
 * these shares a first association and diverges on the second or third.
 */
export const LIARS_WORD_PAIRS: LiarsWordPair[] = [
  { word: "beach", decoy: "desert" },
  { word: "library", decoy: "museum" },
  { word: "hospital", decoy: "school" },
  { word: "wedding", decoy: "funeral" },
  { word: "airport", decoy: "train station" },
  { word: "cinema", decoy: "theatre" },
  { word: "guitar", decoy: "piano" },
  { word: "coffee", decoy: "tea" },
  { word: "winter", decoy: "autumn" },
  { word: "volcano", decoy: "mountain" },
  { word: "pirate", decoy: "viking" },
  { word: "dentist", decoy: "barber" },
  { word: "prison", decoy: "boarding school" },
  { word: "circus", decoy: "carnival" },
  { word: "submarine", decoy: "spaceship" },
  { word: "vampire", decoy: "ghost" },
  { word: "marathon", decoy: "triathlon" },
  { word: "casino", decoy: "arcade" },
  { word: "farm", decoy: "zoo" },
  { word: "bakery", decoy: "butcher" },
  { word: "lighthouse", decoy: "windmill" },
  { word: "aquarium", decoy: "greenhouse" },
  { word: "snow", decoy: "sand" },
  { word: "detective", decoy: "journalist" },
  { word: "campfire", decoy: "fireplace" },
  { word: "helicopter", decoy: "hot air balloon" },
  { word: "supermarket", decoy: "market stall" },
  { word: "swimming pool", decoy: "lake" },
  { word: "birthday", decoy: "anniversary" },
  { word: "chess", decoy: "poker" },
  { word: "umbrella", decoy: "raincoat" },
  { word: "castle", decoy: "cathedral" },
  { word: "orchestra", decoy: "choir" },
  { word: "desert island", decoy: "shipwreck" },
  { word: "laundry", decoy: "dishwashing" },
  { word: "haircut", decoy: "tattoo" },
  { word: "earthquake", decoy: "thunderstorm" },
  { word: "honeymoon", decoy: "road trip" },
  { word: "bicycle", decoy: "motorbike" },
  { word: "greenhouse", decoy: "allotment" },
  { word: "opera", decoy: "ballet" },
  { word: "safari", decoy: "hiking" },
  { word: "post office", decoy: "bank" },
  { word: "graveyard", decoy: "battlefield" },
  { word: "museum", decoy: "art gallery" },
  { word: "nightclub", decoy: "pub" },
  { word: "ski resort", decoy: "spa hotel" },
  { word: "courtroom", decoy: "parliament" },
  { word: "kitchen", decoy: "workshop" },
  { word: "attic", decoy: "basement" },
  { word: "sunrise", decoy: "sunset" },
  { word: "cactus", decoy: "pine tree" },
  { word: "magician", decoy: "clown" },
  { word: "astronaut", decoy: "deep sea diver" },
  { word: "wedding cake", decoy: "birthday cake" },
  { word: "petrol station", decoy: "car wash" },
  { word: "photograph", decoy: "painting" },
  { word: "thunder", decoy: "fireworks" },
  { word: "honey", decoy: "syrup" },
  { word: "mirror", decoy: "window" },
  { word: "elevator", decoy: "escalator" },
  { word: "waterfall", decoy: "fountain" },
  { word: "bookshop", decoy: "record shop" },
  { word: "chef", decoy: "waiter" },
  { word: "fog", decoy: "smoke" },
  { word: "penguin", decoy: "seal" },
  { word: "hotel lobby", decoy: "waiting room" },
  { word: "hurricane", decoy: "blizzard" },
  { word: "violin", decoy: "cello" },
  { word: "tent", decoy: "caravan" },
  { word: "island", decoy: "peninsula" },
  { word: "ambulance", decoy: "fire engine" },
  { word: "chessboard", decoy: "crossword" },
  { word: "moustache", decoy: "beard" },
  { word: "harvest", decoy: "planting" },
  { word: "auction", decoy: "raffle" },
  { word: "cathedral", decoy: "mosque" },
  { word: "ferry", decoy: "cruise ship" },
  { word: "puppy", decoy: "kitten" },
  { word: "avalanche", decoy: "landslide" },
  { word: "tailor", decoy: "cobbler" },
  { word: "telescope", decoy: "microscope" },
  { word: "carnival mask", decoy: "gas mask" },
  { word: "bonfire", decoy: "barbecue" },
  { word: "labyrinth", decoy: "obstacle course" },
  { word: "monastery", decoy: "boarding house" },
  { word: "quicksand", decoy: "swamp" },
  { word: "typewriter", decoy: "sewing machine" },
  { word: "eclipse", decoy: "aurora" },
  { word: "orchard", decoy: "vineyard" },
  { word: "stadium", decoy: "amphitheatre" },
  { word: "cellar", decoy: "pantry" },
  { word: "seagull", decoy: "pigeon" },
  { word: "compass", decoy: "map" },
  { word: "hammock", decoy: "deckchair" },
  { word: "shipyard", decoy: "scrapyard" },
  { word: "midnight", decoy: "dawn" },
  { word: "acrobat", decoy: "gymnast" },
  { word: "greengrocer", decoy: "fishmonger" },
  { word: "sandcastle", decoy: "snowman" },
  { word: "rehearsal", decoy: "audition" },
  { word: "moth", decoy: "butterfly" },
  { word: "canyon", decoy: "fjord" },
  { word: "postcard", decoy: "letter" },
  { word: "sauna", decoy: "greenhouse" },
  { word: "trampoline", decoy: "diving board" },
  { word: "pharmacy", decoy: "corner shop" },
  { word: "lullaby", decoy: "anthem" },
  { word: "windmill", decoy: "water wheel" },
  { word: "custard", decoy: "gravy" },
  { word: "hedge maze", decoy: "hall of mirrors" },
  { word: "roadworks", decoy: "building site" },
  { word: "harbour", decoy: "marina" },
  { word: "referee", decoy: "lifeguard" },
  { word: "scarecrow", decoy: "statue" },
  { word: "chandelier", decoy: "campfire" },
  { word: "swamp", decoy: "marsh" },
  { word: "attic ladder", decoy: "fire escape" },
  { word: "monsoon", decoy: "drought" },
  { word: "puppet", decoy: "doll" },
  { word: "conveyor belt", decoy: "assembly line" },
  { word: "glacier", decoy: "iceberg" },
  { word: "pilgrimage", decoy: "expedition" },
  { word: "junk drawer", decoy: "toolbox" },
  { word: "lantern", decoy: "torch" },
  { word: "quarry", decoy: "mine" },
  { word: "revolving door", decoy: "turnstile" },
  { word: "tea room", decoy: "canteen" },
  { word: "vending machine", decoy: "cash machine" },
  { word: "whirlpool", decoy: "riptide" },
  { word: "yacht", decoy: "rowing boat" },
  { word: "zeppelin", decoy: "glider" },
  { word: "allotment", decoy: "back garden" },
  { word: "blacksmith", decoy: "carpenter" },
  { word: "chimney", decoy: "drainpipe" },
  { word: "duvet", decoy: "sleeping bag" },
  { word: "escalator", decoy: "travelator" },
  { word: "fishing rod", decoy: "butterfly net" },
  { word: "grandfather clock", decoy: "cuckoo clock" },
  { word: "haystack", decoy: "compost heap" },
  { word: "igloo", decoy: "log cabin" },
  { word: "jigsaw", decoy: "dominoes" },
  { word: "kaleidoscope", decoy: "prism" },
  { word: "lifeboat", decoy: "raft" },
  { word: "megaphone", decoy: "whistle" },
  { word: "nursery", decoy: "playground" },
  { word: "observatory", decoy: "control tower" },
  { word: "parachute", decoy: "kite" },
  { word: "quilt", decoy: "tapestry" },
  { word: "radiator", decoy: "kettle" },
  { word: "seesaw", decoy: "swing" },
  { word: "treehouse", decoy: "shed" },
  { word: "umbrella stand", decoy: "coat rack" },
  { word: "vineyard", decoy: "brewery" },
  { word: "wheelbarrow", decoy: "trolley" },
  { word: "x-ray", decoy: "photocopy" },
  { word: "yoga class", decoy: "dance class" },
  { word: "zoo keeper", decoy: "vet" },
];

export function liarsWordPair(recentWords: string[] = []): LiarsWordPair {
  const fresh = LIARS_WORD_PAIRS.filter(({ word }) => !recentWords.includes(word));
  const pool = fresh.length > 0 ? fresh : LIARS_WORD_PAIRS;
  return pool[randomInt(pool.length)];
}

type NarrationOutcome =
  | "killed"
  | "saved"
  | "nobody-died"
  | "bodyguard"
  | "ejected-guilty"
  | "ejected-innocent"
  | "tie"
  | "left";

/**
 * `{victim}`, `{ejected}` and `{substitute}` are filled in by the engine.
 *
 * Kept to one short line each. The narration plays over a choreographed dawn with about seven
 * seconds of room, and on a phone a long sentence pushes the thing people actually need to read —
 * who died — off the first screen. There are enough of them that a five-round game should not
 * hear the same line twice; the engine also remembers the last dozen and avoids them.
 */
const NARRATION: Record<NarrationOutcome, string[]> = {
  killed: [
    "The milk was still on {victim}'s step.",
    "{victim} did not make it to morning.",
    "Someone came for {victim} and left the door open.",
    "The town woke up one short. It was {victim}.",
    "{victim} slept through it. All of it.",
    "There was frost on the windows and {victim} underneath it.",
    "Whoever took {victim} walked home the long way.",
    "{victim} had been saying they slept badly.",
    "Nobody heard {victim} go.",
    "They found {victim} before the kettle boiled.",
    "{victim}'s light was on all night. {victim} was not.",
    "It was quick, and it was {victim}.",
    "The dogs stayed quiet. {victim} did not wake up.",
    "{victim} is gone, and the street looks the same.",
    "Somebody knew exactly which door was {victim}'s.",
    "{victim} never locked it. Nobody here does.",
  ],
  saved: [
    "They came for {victim}. Somebody got there first.",
    "{victim} should not have seen this morning.",
    "There was blood on {victim}'s step and none of it mattered.",
    "{victim} woke up owing somebody a great deal.",
    "Someone was already sitting with {victim} when they arrived.",
    "{victim} was chosen. {victim} is still here.",
    "It nearly took {victim}. It very nearly did.",
  ],
  "nobody-died": [
    "Nothing happened. That is its own kind of news.",
    "The whole town slept, which nobody quite believes.",
    "No door opened. Everyone is still here.",
    "A quiet night. Somebody chose to make it one.",
    "Morning came and took nobody with it.",
    "Not a sound. Draw from that what you like.",
  ],
  bodyguard: [
    "They came for {victim}. {substitute} stepped in front.",
    "{substitute} had been at {victim}'s door all night.",
    "It should have been {victim}. {substitute} saw to that.",
    "{substitute} died where {victim} was meant to.",
  ],
  "ejected-guilty": [
    "They took {ejected} to the square, and they were right.",
    "{ejected} talked the whole way. It did not help.",
    "Right about {ejected}. They will not always be.",
    "{ejected} ran out of story before they ran out of road.",
    "The town got one. The town got {ejected}.",
  ],
  "ejected-innocent": [
    "They took {ejected}, who had never hurt anyone.",
    "{ejected} said they were innocent. {ejected} was.",
    "Everyone agreed about {ejected}. Everyone was wrong.",
    "{ejected} went quietly. That was the worst of it.",
    "One fewer of you, and none of them.",
  ],
  tie: [
    "The town argued until dark and agreed on nothing.",
    "No majority. Everybody goes home.",
    "The vote split clean down the middle.",
    "Nobody could carry the square today.",
  ],
  left: ["{victim} left town in the night."],
};

export interface LiarsNarrationLine {
  /** Stable enough to remember and avoid, without storing the whole sentence. */
  id: string;
  text: string;
}

export function liarsNarration(
  outcome: NarrationOutcome,
  slots: { victim?: string; ejected?: string; substitute?: string },
  recentIds: string[] = [],
): LiarsNarrationLine {
  const templates = NARRATION[outcome];
  const fresh = templates
    .map((template, index) => ({ template, id: `${outcome}:${index}` }))
    .filter(({ id }) => !recentIds.includes(id));
  const pool = fresh.length > 0 ? fresh : templates.map((template, index) => ({ template, id: `${outcome}:${index}` }));
  const chosen = pool[randomInt(pool.length)];
  return {
    id: chosen.id,
    text: chosen.template
      .replaceAll("{victim}", slots.victim ?? "someone")
      .replaceAll("{ejected}", slots.ejected ?? "someone")
      .replaceAll("{substitute}", slots.substitute ?? "someone"),
  };
}
