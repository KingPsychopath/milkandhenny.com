export interface SpellingWord {
  id: string;
  word: string;
  partOfSpeech?: string;
  definition?: string;
  speakAs?: string;
}

export interface SpellingDeck {
  id: string;
  name: string;
  description: string;
  symbol: string;
  words: readonly SpellingWord[];
}

function word(
  value: string,
  partOfSpeech: string,
  definition: string,
  speakAs?: string,
): SpellingWord {
  return {
    id: `preset-${value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    word: value,
    partOfSpeech,
    definition,
    speakAs,
  };
}

export const SPELLING_DECKS = [
  {
    id: "warm-up",
    name: "Warm-up words",
    description: "Familiar words with just enough room for a wobble.",
    symbol: "abc",
    words: [
      word("beautiful", "adjective", "pleasing the senses or mind"),
      word("calendar", "noun", "a system for organising days and months"),
      word("definitely", "adverb", "without doubt"),
      word("embarrass", "verb", "to make someone feel awkward or ashamed"),
      word("February", "noun", "the second month of the year"),
      word("guarantee", "noun", "a formal promise or assurance"),
      word("necessary", "adjective", "needed to achieve a result"),
      word("occasionally", "adverb", "from time to time"),
      word("restaurant", "noun", "a place where meals are prepared and served"),
      word("separate", "adjective", "forming or viewed as a distinct unit"),
      word("tomorrow", "adverb", "on the day after today"),
      word("Wednesday", "noun", "the day between Tuesday and Thursday"),
    ],
  },
  {
    id: "proper-test",
    name: "A proper test",
    description: "Longer, stranger and pleasingly dictionary-shaped.",
    symbol: "æ",
    words: [
      word("acquiesce", "verb", "to accept something reluctantly but without protest"),
      word("bellwether", "noun", "a leading indicator of a future trend"),
      word("conscientious", "adjective", "wishing to do one’s work thoroughly and well"),
      word("diaphanous", "adjective", "light, delicate and translucent"),
      word("effervescent", "adjective", "vivacious and enthusiastic"),
      word("idiosyncrasy", "noun", "a distinctive habit or feature"),
      word("mnemonic", "noun", "a device that assists memory", "neh-MON-ik"),
      word("onomatopoeia", "noun", "a word formed from the sound it describes"),
      word("perspicacious", "adjective", "having a ready insight into things"),
      word("questionnaire", "noun", "a written set of questions used for research"),
      word("rhythm", "noun", "a repeated pattern of sound or movement"),
      word("sesquipedalian", "adjective", "characterised by long words"),
    ],
  },
  {
    id: "british-drawer",
    name: "British drawer",
    description: "A cupboard of queues, biscuits and awkward vowels.",
    symbol: "☂",
    words: [
      word("aluminium", "noun", "a light silvery-grey metal"),
      word("aubergine", "noun", "a glossy purple vegetable"),
      word("bureaucracy", "noun", "a system governed by administrative procedures"),
      word("caricature", "noun", "an exaggerated portrayal of someone"),
      word("courgette", "noun", "a small green summer squash"),
      word("handkerchief", "noun", "a square of fabric carried for personal use"),
      word("licence", "noun", "official permission to do or own something"),
      word("manoeuvre", "noun", "a movement requiring skill and care"),
      word("parliament", "noun", "the supreme legislative body of a country"),
      word("quay", "noun", "a platform beside water where ships load", "key"),
      word("silhouette", "noun", "a dark outline against a lighter background"),
      word("yoghurt", "noun", "a fermented milk food"),
    ],
  },
  {
    id: "american-english",
    name: "American English",
    description: "Color, center and other familiar US spellings.",
    symbol: "US",
    words: [
      word("aluminum", "noun", "a lightweight silvery metal"),
      word("analyze", "verb", "to examine something carefully"),
      word("canceled", "verb", "called off before it could happen"),
      word("center", "noun", "the middle point of something"),
      word("color", "noun", "the appearance created by reflected light"),
      word("defense", "noun", "protection against attack or criticism"),
      word("gray", "adjective", "a color between black and white"),
      word("jewelry", "noun", "decorative items worn for personal adornment"),
      word("license", "noun", "official permission to do or own something"),
      word("maneuver", "noun", "a movement requiring skill and care"),
      word("pajamas", "noun", "clothes worn for sleeping"),
      word("theater", "noun", "a building where plays or films are shown"),
    ],
  },
] satisfies readonly SpellingDeck[];

export function shuffledWords(words: readonly SpellingWord[]) {
  const next = words.map((item) => ({ ...item }));
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}
