import { SPELLING_DECKS, type SpellingWord } from "../spelling-bee/decks";
import type { PartyDeckSummary } from "./types";

const SENTENCES: Record<string, string> = {
  beautiful: "The garden looked beautiful after the rain.", calendar: "I marked the date on the calendar.", definitely: "I will definitely remember this time.",
  embarrass: "Please do not embarrass him in front of everyone.", february: "Her birthday falls in February.", guarantee: "The receipt includes a one-year guarantee.",
  necessary: "Water is necessary for every living thing.", occasionally: "We occasionally walk home through the park.", restaurant: "They booked a table at the new restaurant.",
  separate: "Keep the clean towels in a separate cupboard.", tomorrow: "We can finish the puzzle tomorrow.", wednesday: "The next rehearsal is on Wednesday.",
  acquiesce: "After a long discussion, she chose to acquiesce.", bellwether: "The first result may be a bellwether for the others.", conscientious: "He is a conscientious student who checks every detail.",
  diaphanous: "The curtains were made from diaphanous fabric.", effervescent: "Her effervescent personality lifted the room.", idiosyncrasy: "That cheerful whistle was his best-known idiosyncrasy.",
  mnemonic: "She invented a mnemonic to remember the planets.", onomatopoeia: "Buzz is a familiar example of onomatopoeia.", perspicacious: "The perspicacious editor noticed the hidden contradiction.",
  questionnaire: "Every volunteer completed the questionnaire.", rhythm: "The dancers moved together in rhythm.", sesquipedalian: "His sesquipedalian speech was full of enormous words.",
  aluminium: "The lightweight frame is made from aluminium.", aubergine: "She roasted an aubergine with garlic and herbs.", bureaucracy: "The application was delayed by unnecessary bureaucracy.",
  caricature: "The artist drew a playful caricature of the mayor.", courgette: "Slice the courgette into thin ribbons.", handkerchief: "He folded the handkerchief into his pocket.",
  licence: "You need a licence before you can drive.", manoeuvre: "Parking there requires a careful manoeuvre.", parliament: "The proposal will be debated in parliament.",
  quay: "Fishing boats were tied along the quay.", silhouette: "We could see her silhouette against the sunset.", yoghurt: "He added berries to a bowl of yoghurt.",
  aluminum: "The bicycle frame is made from aluminum.", analyze: "The scientist will analyze the results tomorrow.", canceled: "The outdoor concert was canceled because of the storm.",
  center: "Place the vase in the center of the table.", color: "She chose a bright color for the front door.", defense: "The team strengthened its defense before the final game.",
  gray: "A gray cloud drifted over the city.", jewelry: "The necklace was her favorite piece of jewelry.", license: "You need a license before you can drive.",
  maneuver: "Parking there requires a careful maneuver.", pajamas: "He changed into his pajamas before bed.", theater: "We arrived at the theater before the show began.",
};

export interface PartyWord extends SpellingWord {
  sentence: string;
}

export function partyDeckCatalog(): PartyDeckSummary[] {
  return SPELLING_DECKS.map(({ id, name, description, symbol, words }) => ({ id, name, description, symbol, wordCount: words.length }));
}

export function partyDeck(deckId: string) {
  const deck = SPELLING_DECKS.find(({ id }) => id === deckId);
  if (!deck) return null;
  return {
    id: deck.id,
    name: deck.name,
    words: deck.words.map((word) => ({ ...word, sentence: SENTENCES[word.word.toLocaleLowerCase()] ?? `The word for this round is ${word.word}.` })),
  };
}

export function partyAudioAssetKey(word: PartyWord, kind: "word" | "definition" | "sentence") {
  return `${word.id.replace(/^preset-/, "")}-${kind}.mp3`;
}
