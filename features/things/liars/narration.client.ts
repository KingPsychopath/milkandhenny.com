import { getLocalVoices } from "../spelling/localSpeech";

/**
 * One device speaks the dawn. Which one is decided by the server (`narratorPlayerId`, or the
 * presenter when it is attached) — eight phones speaking a beat apart is the echo the party game
 * already documents.
 *
 * Voice selection reuses the spelling bee's scoring, which already filters out the novelty voices
 * and prefers the natural ones.
 */
export function speakLiarsNarration(text: string, locale = "en-GB") {
  return new Promise<boolean>((resolve) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return resolve(false);
    const voice = getLocalVoices(locale)[0];
    if (!voice) return resolve(false);
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.voice = voice;
    utterance.lang = voice.lang;
    // Slower and lower than the spelling bee: this is a story, not a word to write down.
    utterance.rate = 0.88;
    utterance.pitch = 0.9;
    utterance.onend = () => resolve(true);
    utterance.onerror = () => resolve(false);
    speechSynthesis.speak(utterance);
  });
}

export function cancelLiarsNarration() {
  if (typeof window !== "undefined" && "speechSynthesis" in window) speechSynthesis.cancel();
}
