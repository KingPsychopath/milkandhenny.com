import type { SpellingWord } from "./decks";

export function getLocalVoices(locale = "en-GB") {
  if (!("speechSynthesis" in window)) return [];
  const language = locale.split("-")[0];
  return speechSynthesis
    .getVoices()
    .filter((voice) => voice.localService && voice.lang.toLocaleLowerCase().startsWith(language))
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

export function speakWord(item: SpellingWord, options?: { slower?: boolean; locale?: string }) {
  return new Promise<boolean>((resolve) => {
    if (!("speechSynthesis" in window)) return resolve(false);
    const locale = options?.locale ?? "en-GB";
    const voices = getLocalVoices(locale);
    const voice =
      voices.find(({ lang }) => lang.toLocaleLowerCase() === locale.toLocaleLowerCase()) ??
      voices[0];
    if (!voice) return resolve(false);
    speechSynthesis.cancel();
    const spokenWord = item.speakAs ?? item.word;
    const utterance = new SpeechSynthesisUtterance(
      options?.slower ? spokenWord.replace(/[-–—/]+/g, ", ") : spokenWord,
    );
    utterance.voice = voice;
    utterance.lang = voice.lang;
    // 0.8 is rendered almost identically to 0.95 by several Apple voices.
    // A materially slower rate makes this control useful while punctuation in
    // custom pronunciation hints produces a short, natural pause.
    utterance.rate = options?.slower ? 0.52 : 0.95;
    utterance.pitch = 1;
    utterance.onend = () => resolve(true);
    utterance.onerror = () => resolve(false);
    speechSynthesis.speak(utterance);
  });
}

export function cancelLocalSpeech() {
  if ("speechSynthesis" in window) speechSynthesis.cancel();
}
