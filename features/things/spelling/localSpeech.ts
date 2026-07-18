import type { SpellingWord } from "./decks";

const NOVELTY_VOICE_PATTERN =
  /bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox/i;

export function getLocalVoices(locale = "en-GB") {
  if (!("speechSynthesis" in window)) return [];
  const language = locale.split("-")[0];
  return speechSynthesis
    .getVoices()
    .filter(
      (voice) =>
        voice.localService &&
        voice.lang.toLocaleLowerCase().startsWith(language) &&
        !NOVELTY_VOICE_PATTERN.test(voice.name),
    )
    .sort((left, right) => voiceScore(right, locale) - voiceScore(left, locale));
}

function voiceScore(voice: SpeechSynthesisVoice, locale: string) {
  const name = voice.name.toLocaleLowerCase();
  const exactLocale = voice.lang.toLocaleLowerCase() === locale.toLocaleLowerCase();
  const qualityHint = /premium|enhanced|natural/.test(name);
  const naturalVoiceName = /arthur|daniel|jamie|kate|martha|moira|samantha|serena|siri/.test(name);
  const lowQualityHint = /compact|espeak|novelty/.test(name);
  return (
    (exactLocale ? 100 : 0) +
    (qualityHint ? 40 : 0) +
    (naturalVoiceName ? 20 : 0) +
    (voice.default ? 10 : 0) -
    (lowQualityHint ? 50 : 0)
  );
}

const SLOW_RATES = [0.62, 0.45, 0.32] as const;

export function speakWord(
  item: SpellingWord,
  options?: { locale?: string; slowLevel?: number; voiceURI?: string },
) {
  return new Promise<boolean>((resolve) => {
    if (!("speechSynthesis" in window)) return resolve(false);
    const locale = options?.locale ?? "en-GB";
    const voices = getLocalVoices(locale);
    const preferredVoice = options?.voiceURI
      ? voices.find(({ voiceURI }) => voiceURI === options.voiceURI)
      : null;
    const voice =
      preferredVoice ??
      voices.find(({ lang }) => lang.toLocaleLowerCase() === locale.toLocaleLowerCase()) ??
      voices[0];
    if (!voice) return resolve(false);
    speechSynthesis.cancel();
    const spokenWord = item.speakAs ?? item.word;
    const utterance = new SpeechSynthesisUtterance(
      options?.slowLevel ? spokenWord.replace(/[-–—/]+/g, ", ") : spokenWord,
    );
    utterance.voice = voice;
    utterance.lang = voice.lang;
    const slowIndex = options?.slowLevel
      ? Math.min(SLOW_RATES.length - 1, Math.max(0, options.slowLevel - 1))
      : null;
    utterance.rate = slowIndex === null ? 0.95 : SLOW_RATES[slowIndex];
    utterance.pitch = 1;
    utterance.onend = () => resolve(true);
    utterance.onerror = () => resolve(false);
    speechSynthesis.speak(utterance);
  });
}

export function cancelLocalSpeech() {
  if ("speechSynthesis" in window) speechSynthesis.cancel();
}
