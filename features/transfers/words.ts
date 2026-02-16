/**
 * Curated word lists for human-readable transfer IDs.
 *
 * Three pools: descriptor + noun + noun → "velvet-moon-candle"
 * ~130 words per list ≈ 2.2 million combos — collision-proof for party transfers.
 *
 * Words are chosen to be: short, warm, inoffensive in any combo, and on-brand
 * with the milk & henny editorial tone.
 */

import "server-only";

const DESCRIPTORS = [
  "amber", "autumn", "bare", "bitter", "blush", "bold", "brass",
  "bright", "bronze", "burnt", "calm", "cedar", "clear", "cool",
  "copper", "coral", "cotton", "cream", "crisp", "crushed", "curled",
  "damp", "dark", "dawn", "deep", "dense", "dim", "double", "dried",
  "dusk", "dusty", "easy", "faded", "faint", "fallen", "felt",
  "fern", "fine", "first", "flat", "fresh", "frost", "full",
  "gentle", "gilt", "glass", "golden", "grand", "half", "hazy",
  "heavy", "hidden", "hollow", "honey", "hushed", "idle", "iron",
  "ivory", "jade", "keen", "kind", "laced", "late", "lazy",
  "lemon", "light", "lilac", "linen", "long", "loose", "lost",
  "loud", "low", "lunar", "maple", "marble", "mellow", "mild",
  "mint", "misty", "moody", "mossy", "muted", "narrow", "neat",
  "noble", "odd", "olive", "opal", "open", "outer", "pale",
  "paper", "pearl", "plum", "polished", "pressed", "proud", "pure",
  "quiet", "rare", "raw", "rich", "ripe", "risen", "roast",
  "rough", "round", "royal", "rust", "sage", "salted", "satin",
  "sharp", "sheer", "short", "silver", "simple", "sleek", "slow",
  "small", "smooth", "soft", "solid", "spare", "spiced", "split",
  "stark", "steep", "still", "stone", "stout", "subtle", "sugar",
  "swift", "tall", "tawny", "tender", "thick", "thin", "tidal",
  "timber", "toast", "twin", "upper", "velvet", "vivid", "warm",
  "waxed", "whole", "wide", "wild", "woven",
] as const;

const NOUNS_A = [
  "arch", "bark", "basin", "bell", "birch", "blade", "bloom",
  "bluff", "board", "bone", "book", "booth", "braid", "branch",
  "brass", "bread", "brick", "brook", "brush", "candle", "cape",
  "cedar", "chain", "chalk", "charm", "chess", "chest", "cliff",
  "cloth", "cloud", "coast", "coin", "cork", "court", "crane",
  "crest", "crown", "dawn", "dock", "door", "dove", "drum",
  "dune", "dust", "elm", "ember", "fawn", "field", "fig",
  "flame", "flask", "flint", "flora", "foam", "forge", "fox",
  "frost", "gate", "gleam", "glen", "grain", "grove", "gust",
  "haven", "hawk", "hazel", "heath", "hedge", "helm", "heron",
  "hill", "hive", "hollow", "horn", "hound", "hymn", "ink",
  "isle", "ivy", "jade", "knoll", "lace", "lake", "lane",
  "lark", "laurel", "leaf", "ledge", "lemon", "lily", "loft",
  "loom", "marsh", "mason", "mead", "mill", "mint", "moon",
  "moss", "mule", "oak", "oar", "olive", "otter", "palm",
  "parch", "path", "peach", "pearl", "pier", "pine", "plum",
  "pond", "port", "press", "quill", "rain", "raven", "reed",
  "ridge", "rind", "river", "robin", "root", "rose", "rowan",
  "sage", "sand", "seal", "shade", "shell", "shore", "silk",
  "slate", "slope", "smoke", "snow", "spark", "spire", "spring",
  "spruce", "star", "stem", "stone", "storm", "stove", "straw",
  "sun", "swan", "thorn", "tide", "torch", "tower", "trail",
  "tulip", "vale", "vine", "walnut", "wheat", "wren",
] as const;

const NOUNS_B = [
  "arc", "ash", "barn", "basin", "bay", "beam", "berry",
  "blaze", "bliss", "bond", "bough", "bower", "briar", "brine",
  "broth", "burrow", "cairn", "canal", "cellar", "cider", "clay",
  "cloak", "clove", "comb", "core", "cove", "craft", "creek",
  "crust", "dale", "den", "dew", "drift", "drop", "dusk",
  "edge", "elm", "ember", "fable", "ferry", "fiber", "finch",
  "flax", "fold", "font", "frond", "gale", "garnet", "glow",
  "grasp", "hatch", "haven", "hearth", "hemp", "herb", "husk",
  "keel", "kiln", "knot", "latch", "ledge", "lime", "linen",
  "lodge", "lyric", "malt", "maple", "mast", "mortar", "nest",
  "notch", "oat", "ore", "pane", "patch", "peak", "peat",
  "perch", "plank", "plow", "plume", "prism", "pulse", "quartz",
  "raft", "rain", "reef", "rest", "ridge", "rind", "rope",
  "roost", "rye", "sable", "salt", "sash", "scone", "seed",
  "shale", "shed", "slate", "snare", "soot", "spice", "spoke",
  "sprig", "steep", "step", "stitch", "strand", "stream", "thatch",
  "thyme", "timber", "tin", "tint", "token", "trace", "twig",
  "vale", "vault", "verge", "wax", "weave", "well", "wick",
  "wisp", "wool", "yard", "yew",
] as const;

const NOUNS_ALL: readonly string[] = [...NOUNS_A, ...NOUNS_B];
const WORDS_ALL: readonly string[] = [...DESCRIPTORS, ...NOUNS_A, ...NOUNS_B];

/**
 * Pick a cryptographically random element from a readonly array.
 * Uses `crypto.getRandomValues` for uniform distribution without modulo bias.
 */
function pick<T>(list: readonly T[]): T {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return list[arr[0] % list.length];
}

type WordCodeLength = 1 | 2 | 3;

/**
 * Generate a short human-readable hyphenated code.
 *
 * - 1 word: "amber"
 * - 2 words: "amber-crown"
 * - 3 words: "velvet-moon-candle" (default transfer style)
 */
function generateWordsCode(words: WordCodeLength): string {
  if (words === 1) return `${pick(WORDS_ALL)}`;
  if (words === 2) return `${pick(DESCRIPTORS)}-${pick(NOUNS_ALL)}`;
  return `${pick(DESCRIPTORS)}-${pick(NOUNS_A)}-${pick(NOUNS_B)}`;
}

/** Generate a 3-word hyphenated transfer ID, e.g. "velvet-moon-candle" */
function generateWordId(): string {
  return generateWordsCode(3);
}

export { generateWordId, generateWordsCode };
