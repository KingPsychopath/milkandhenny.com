import type { SpellingWord } from "./decks";

export function getLocalVoices(locale = "en-GB") {
  if (!("speechSynthesis" in window)) return [];
  const language = locale.split("-")[0];
  return speechSynthesis
    .getVoices()
    .filter((voice) => voice.localService && voice.lang.toLocaleLowerCase().startsWith(language));
}

export function speakWord(item: SpellingWord, options?: { slower?: boolean; locale?: string }) {
  return new Promise<boolean>((resolve) => {
    if (!("speechSynthesis" in window)) return resolve(false);
    const locale = options?.locale ?? "en-GB";
    const voices = getLocalVoices(locale);
    const voice = voices.find(({ lang }) => lang.toLocaleLowerCase() === locale.toLocaleLowerCase()) ?? voices[0];
    if (!voice) return resolve(false);
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(item.speakAs ?? item.word);
    utterance.voice = voice;
    utterance.lang = voice.lang;
    utterance.rate = options?.slower ? 0.72 : 0.9;
    utterance.pitch = 1;
    utterance.onend = () => resolve(true);
    utterance.onerror = () => resolve(false);
    speechSynthesis.speak(utterance);
  });
}

export function cancelLocalSpeech() {
  if ("speechSynthesis" in window) speechSynthesis.cancel();
}
