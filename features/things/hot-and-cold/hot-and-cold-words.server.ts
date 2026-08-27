import { createHash, randomInt } from "node:crypto";

/** Curated targets. General guesses remain open; targets need reliable semantic neighbourhoods. */
export const HOT_AND_COLD_TARGETS = [
  "airport",
  "anchor",
  "apple",
  "avalanche",
  "bakery",
  "balloon",
  "beach",
  "bicycle",
  "blanket",
  "bridge",
  "butterfly",
  "camera",
  "candle",
  "castle",
  "cave",
  "cheese",
  "chimney",
  "circus",
  "clock",
  "cloud",
  "coffee",
  "comet",
  "compass",
  "concert",
  "crown",
  "desert",
  "diamond",
  "dinosaur",
  "doctor",
  "dragon",
  "dream",
  "earthquake",
  "engine",
  "feather",
  "festival",
  "fireplace",
  "forest",
  "fountain",
  "garden",
  "ghost",
  "glacier",
  "guitar",
  "harbour",
  "helmet",
  "honey",
  "hospital",
  "island",
  "jungle",
  "kettle",
  "kingdom",
  "ladder",
  "lantern",
  "library",
  "lighthouse",
  "lightning",
  "market",
  "mirror",
  "moon",
  "mountain",
  "museum",
  "music",
  "ocean",
  "orchard",
  "painting",
  "passport",
  "piano",
  "picnic",
  "pirate",
  "planet",
  "prison",
  "rainbow",
  "river",
  "robot",
  "rocket",
  "sandwich",
  "school",
  "shadow",
  "ship",
  "snowman",
  "stadium",
  "storm",
  "submarine",
  "sunrise",
  "telescope",
  "theatre",
  "thunder",
  "tiger",
  "tower",
  "train",
  "treasure",
  "tunnel",
  "umbrella",
  "village",
  "volcano",
  "waterfall",
  "wedding",
  "whistle",
  "window",
  "winter",
  "wizard",
  "accordion",
  "adventure",
  "ambulance",
  "angel",
  "ant",
  "apartment",
  "archer",
  "armour",
  "artist",
  "astronaut",
  "autumn",
  "backpack",
  "badger",
  "banana",
  "bank",
  "barber",
  "barn",
  "basket",
  "bathroom",
  "battery",
  "battle",
  "bear",
  "bell",
  "bench",
  "bird",
  "birthday",
  "boat",
  "book",
  "bottle",
  "bowl",
  "box",
  "bread",
  "breakfast",
  "breeze",
  "brick",
  "brother",
  "brush",
  "bubble",
  "bucket",
  "bus",
  "cabinet",
  "cactus",
  "calendar",
  "campfire",
  "canal",
  "captain",
  "carpet",
  "carrot",
  "cartoon",
  "cat",
  "cathedral",
  "chair",
  "chocolate",
  "cinema",
  "clown",
  "coat",
  "coconut",
  "coin",
  "college",
  "computer",
  "cooking",
  "cottage",
  "cowboy",
  "crab",
  "crystal",
  "cupboard",
  "curtain",
  "dance",
  "dentist",
  "diary",
  "dinner",
  "dog",
  "dolphin",
  "door",
  "drum",
  "duck",
  "eagle",
  "elephant",
  "elevator",
  "emerald",
  "envelope",
  "factory",
  "fairy",
  "family",
  "farmer",
  "ferry",
  "finger",
  "fishing",
  "flower",
  "flute",
  "football",
  "fork",
  "friendship",
  "frog",
  "garage",
  "garlic",
  "giant",
  "giraffe",
  "glove",
  "gold",
  "goose",
  "grape",
  "grass",
  "hammer",
  "hamster",
  "hat",
  "hedgehog",
  "helicopter",
  "horse",
  "hotel",
  "iceberg",
  "jacket",
  "jellyfish",
  "jewel",
  "journey",
  "kangaroo",
  "key",
  "kitchen",
  "kite",
  "knife",
  "lake",
  "lemon",
  "lion",
  "lobster",
  "magnet",
  "mermaid",
  "monkey",
  "motorcycle",
  "mushroom",
  "necklace",
  "newspaper",
  "nightmare",
  "octopus",
  "onion",
  "orange",
  "owl",
  "panda",
  "paper",
  "parade",
  "parrot",
  "pencil",
  "penguin",
  "pepper",
  "photograph",
  "pigeon",
  "pillow",
  "pizza",
  "playground",
  "pocket",
  "potato",
  "queen",
  "rabbit",
  "radio",
  "rain",
  "restaurant",
  "ring",
  "road",
  "robin",
  "ruby",
  "sailor",
  "scarf",
  "shark",
  "shoe",
  "sister",
  "skeleton",
  "snake",
  "soap",
  "spider",
  "spoon",
  "spring",
  "star",
  "summer",
  "sun",
  "swan",
  "sword",
  "table",
  "taxi",
  "telephone",
  "tent",
  "toothbrush",
  "tornado",
  "tractor",
  "traffic",
  "trumpet",
  "turtle",
  "unicorn",
  "violin",
  "wallet",
  "whale",
  "windmill",
  "wolf",
  "zebra",
] as const;

const DAILY_EPOCH = Date.UTC(2026, 7, 25);
// Preserve the words already served while discarding the fictional public count that preceded them.
const FIRST_SEASON_OPENING = ["chimney", "diary", "tower"] as const;
const UK_DAY = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function ukDay(date: Date): number {
  const parts = Object.fromEntries(
    UK_DAY.formatToParts(date)
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, Number(value)]),
  );
  return Date.UTC(parts.year, parts.month - 1, parts.day);
}

export function hotAndColdPuzzleNumber(date = new Date()) {
  return Math.max(1, Math.floor((ukDay(date) - DAILY_EPOCH) / 86_400_000) + 1);
}

export function hotAndColdTargetForPuzzle(puzzle: number) {
  const offset = Math.max(0, Math.floor(puzzle) - 1);
  const cycle = Math.floor(offset / HOT_AND_COLD_TARGETS.length);
  const position = offset % HOT_AND_COLD_TARGETS.length;
  const available =
    cycle === 0
      ? HOT_AND_COLD_TARGETS.filter(
          (word) => !FIRST_SEASON_OPENING.includes(word as (typeof FIRST_SEASON_OPENING)[number]),
        )
      : [...HOT_AND_COLD_TARGETS];
  const shuffled = available
    .map((word) => ({
      word,
      order: createHash("sha256")
        .update(`milk-and-henny:hot-and-cold:launch:${cycle}:${word}`)
        .digest()
        .readUInt32BE(0),
    }))
    .sort((left, right) => left.order - right.order || left.word.localeCompare(right.word));
  const ordered =
    cycle === 0
      ? [...FIRST_SEASON_OPENING, ...shuffled.map(({ word }) => word)]
      : shuffled.map(({ word }) => word);
  return ordered[position];
}

export function dailyHotAndColdTarget(date = new Date()) {
  return hotAndColdTargetForPuzzle(hotAndColdPuzzleNumber(date));
}

export function hotAndColdPuzzleDate(puzzle: number) {
  return new Date(DAILY_EPOCH + (Math.max(1, Math.floor(puzzle)) - 1) * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

export function previousHotAndColdPuzzles(date = new Date()) {
  const current = hotAndColdPuzzleNumber(date);
  return Array.from({ length: current - 1 }, (_unused, index) => {
    const puzzle = current - index - 1;
    return {
      puzzle,
      date: hotAndColdPuzzleDate(puzzle),
    };
  });
}

export function randomHotAndColdTargets(total: number, excluded: readonly string[] = []) {
  const fresh = HOT_AND_COLD_TARGETS.filter((word) => !excluded.includes(word));
  const pool = [...(fresh.length >= total ? fresh : HOT_AND_COLD_TARGETS)];
  const selected: string[] = [];
  while (pool.length > 0 && selected.length < total) {
    selected.push(...pool.splice(randomInt(pool.length), 1));
  }
  return selected;
}
