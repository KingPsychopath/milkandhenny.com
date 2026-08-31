import { shuffledCopy } from "../shared/content-random";

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
      word("accommodate", "verb", "to provide enough space or meet a need"),
      word("appearance", "noun", "the way that someone or something looks"),
      word("believe", "verb", "to accept that something is true"),
      word("convenient", "adjective", "fitting well with a person’s needs or plans"),
      word("disappear", "verb", "to cease to be visible"),
      word("familiar", "adjective", "well known from repeated experience"),
      word("government", "noun", "the group responsible for governing a country"),
      word("knowledge", "noun", "facts and understanding gained through experience"),
      word("maintenance", "noun", "work done to keep something in good condition"),
      word("parallel", "adjective", "side by side and always the same distance apart"),
      word("recommend", "verb", "to suggest something as suitable"),
      word("successful", "adjective", "achieving the intended result"),
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
      word("antediluvian", "adjective", "ridiculously old-fashioned"),
      word("bougainvillea", "noun", "a climbing plant with brightly coloured bracts"),
      word("circumlocution", "noun", "the use of many words where fewer would do"),
      word("dichotomy", "noun", "a division into two contrasting parts"),
      word("ephemeral", "adjective", "lasting for a very short time"),
      word("fastidious", "adjective", "very attentive to accuracy and detail"),
      word("grandiloquent", "adjective", "using language intended to sound impressive"),
      word("incontrovertible", "adjective", "not able to be denied or disputed"),
      word("lachrymose", "adjective", "tearful or inclined to weep"),
      word("prestidigitation", "noun", "magic tricks performed with the hands"),
      word("quintessential", "adjective", "representing the most perfect example"),
      word("surreptitious", "adjective", "kept secret because it would not be approved"),
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
      word("apologise", "verb", "to express regret for something"),
      word("cheque", "noun", "a written instruction to a bank to pay money"),
      word("dialogue", "noun", "conversation between two or more people"),
      word("enrolment", "noun", "the act of joining a course or organisation"),
      word("fibre", "noun", "a thin thread forming part of a material"),
      word("fulfil", "verb", "to carry out or bring something to completion"),
      word("honour", "noun", "high respect or a mark of distinction"),
      word("labour", "noun", "work, especially work requiring physical effort"),
      word("neighbour", "noun", "a person living near another person"),
      word("recognise", "verb", "to identify someone or something known before"),
      word("sceptical", "adjective", "not easily convinced that something is true"),
      word("tyre", "noun", "a rubber covering fitted around a wheel"),
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
      word("apologize", "verb", "to express regret for something"),
      word("check", "noun", "a written instruction to a bank to pay money"),
      word("dialog", "noun", "conversation between two or more people"),
      word("enrollment", "noun", "the act of joining a course or organization"),
      word("fiber", "noun", "a thin thread forming part of a material"),
      word("focused", "adjective", "giving close attention to one thing"),
      word("labeled", "verb", "marked with a name or description"),
      word("liter", "noun", "a metric unit of volume"),
      word("recognize", "verb", "to identify someone or something known before"),
      word("skeptical", "adjective", "not easily convinced that something is true"),
      word("tire", "noun", "a rubber covering fitted around a wheel"),
      word("vacation", "noun", "a period spent away from work or school"),
    ],
  },
] satisfies readonly SpellingDeck[];

export function shuffledWords(words: readonly SpellingWord[]) {
  return shuffledCopy(words).map((item) => ({ ...item }));
}

export function spellingRoundOptions(wordCount: number) {
  return [...new Set([5, 10, 15, 20, wordCount])]
    .filter((count) => count > 0 && count <= wordCount)
    .sort((left, right) => left - right);
}
