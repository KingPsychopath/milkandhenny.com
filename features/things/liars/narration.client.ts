import { getLocalVoices } from "../spelling/localSpeech";

/**
 * One device speaks the dawn. Which one is decided by the server (`narratorPlayerId`, or the
 * presenter when it is attached) — eight phones speaking a beat apart is the echo the party game
 * already documents.
 *
 * Voice selection reuses the spelling bee's scoring, which already filters out the novelty voices
 * and prefers the natural ones.
 */
/**
 * A narrator is not a screen reader. The default voice reads a death like a train announcement,
 * so this does three things to it: prefers the fuller-bodied voices the platform ships (Daniel,
 * Serena, Arthur — the ones with real prosody rather than the compact fallbacks), drops the pitch,
 * and — the part that actually matters — **speaks the sentence in clauses with pauses between
 * them**, because the pause is what makes a line land.
 *
 * Web Speech gives no control over emphasis, so the clause split is the only real instrument here.
 */
const NARRATOR_NAMES =
  /arthur|daniel|serena|kate|martha|oliver|stephanie|jamie|matilda|nathan|gordon/i;

function narratorVoice(locale: string) {
  const voices = getLocalVoices(locale);
  return voices.find(({ name }) => NARRATOR_NAMES.test(name)) ?? voices[0] ?? null;
}

/** Splits on the punctuation a reader would breathe at, keeping the mark with its clause. */
function clauses(text: string) {
  return text
    .split(/(?<=[.,;:—–])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

export function speakLiarsNarration(text: string, locale = "en-GB") {
  return new Promise<boolean>((resolve) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return resolve(false);
    const voice = narratorVoice(locale);
    if (!voice) return resolve(false);
    speechSynthesis.cancel();

    const parts = clauses(text);
    let spoken = 0;
    parts.forEach((part, index) => {
      const utterance = new SpeechSynthesisUtterance(part);
      utterance.voice = voice;
      utterance.lang = voice.lang;
      // Slower and lower than the spelling bee: a story, not a word anyone has to write down.
      utterance.rate = 0.82;
      utterance.pitch = 0.75;
      utterance.volume = 1;
      // A comma gets a beat, a full stop gets a breath.
      const last = index === parts.length - 1;
      utterance.onend = () => {
        spoken += 1;
        if (last) resolve(true);
      };
      utterance.onerror = () => resolve(spoken > 0);
      speechSynthesis.speak(utterance);
      if (!last) {
        const gap = new SpeechSynthesisUtterance(" ");
        gap.voice = voice;
        gap.volume = 0;
        gap.rate = /[.—–;:]$/.test(part) ? 0.24 : 0.5;
        speechSynthesis.speak(gap);
      }
    });
  });
}

export function cancelLiarsNarration() {
  if (typeof window !== "undefined" && "speechSynthesis" in window) speechSynthesis.cancel();
}
