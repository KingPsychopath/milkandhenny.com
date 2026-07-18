export interface SpellingWord {
  id: string;
  word: string;
  partOfSpeech?: string;
  definition?: string;
  speakAs?: string;
  sentence?: string;
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
      word("address", "noun", "the details of where someone lives or works"),
      word("beginning", "noun", "the point at which something starts"),
      word("business", "noun", "work involving buying or selling goods or services"),
      word("committee", "noun", "a group appointed to make decisions"),
      word("environment", "noun", "the surroundings in which people, animals or plants live"),
      word("exercise", "noun", "activity done to improve health or practise a skill"),
      word("friend", "noun", "a person with whom one shares affection and trust"),
      word("immediately", "adverb", "at once or without delay"),
      word("library", "noun", "a place where books and other resources are kept"),
      word("privilege", "noun", "a special right or advantage"),
      word("receive", "verb", "to be given or presented with something"),
      word("surprise", "noun", "an unexpected event or discovery"),
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
      word("chrysanthemum", "noun", "a flowering plant with brightly coloured blooms"),
      word("connoisseur", "noun", "an expert judge in matters of taste"),
      word("entrepreneur", "noun", "a person who starts and runs a business"),
      word("juxtaposition", "noun", "the placing of things together for contrast"),
      word("liaison", "noun", "communication or cooperation between people or groups"),
      word("millennium", "noun", "a period of one thousand years"),
      word("miscellaneous", "adjective", "made up of varied and unrelated things"),
      word("occurrence", "noun", "an event or something that happens"),
      word("pharaoh", "noun", "a ruler of ancient Egypt"),
      word("pronunciation", "noun", "the way in which a word is spoken"),
      word("supersede", "verb", "to replace something older or less effective"),
      word("vicissitude", "noun", "an unwelcome change of circumstances or fortune"),
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
      word("artefact", "noun", "an object made by a person, often of historical interest"),
      word("catalogue", "noun", "a complete list of items arranged systematically"),
      word("centre", "noun", "the middle point of something"),
      word("colour", "noun", "the appearance created by reflected light"),
      word("defence", "noun", "protection against attack or criticism"),
      word("flavour", "noun", "the distinctive taste of food or drink"),
      word("grey", "adjective", "a colour between black and white"),
      word("jewellery", "noun", "decorative items worn for personal adornment"),
      word("programme", "noun", "a planned series of events or broadcasts"),
      word("pyjamas", "noun", "clothes worn for sleeping"),
      word("theatre", "noun", "a building where plays or films are shown"),
      word("travelling", "verb", "making a journey from one place to another"),
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
      word("artifact", "noun", "an object made by a person, often of historical interest"),
      word("catalog", "noun", "a complete list of items arranged systematically"),
      word("favorite", "adjective", "preferred above all others"),
      word("flavor", "noun", "the distinctive taste of food or drink"),
      word("fulfill", "verb", "to carry out or bring something to completion"),
      word("honor", "noun", "high respect or a mark of distinction"),
      word("labor", "noun", "work, especially work requiring physical effort"),
      word("neighbor", "noun", "a person living near another person"),
      word("program", "noun", "a planned series of events or instructions"),
      word("realize", "verb", "to become fully aware of something"),
      word("traveling", "verb", "making a journey from one place to another"),
      word("woolen", "adjective", "made wholly or partly from wool"),
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

export function spellingRoundOptions(wordCount: number) {
  return [...new Set([5, 10, 15, 20, wordCount])].filter((count) => count > 0 && count <= wordCount).sort((left, right) => left - right);
}
