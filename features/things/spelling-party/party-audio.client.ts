import { speakWord } from "../spelling/localSpeech";

export function unlockPartyAudio() {
  const AudioContextClass = window.AudioContext;
  if (!AudioContextClass) return;
  const context = new AudioContextClass();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  gain.gain.value = 0.0001;
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.02);
  void context.resume();
}

export async function playPartySpeech(
  audioUrl: string | null,
  text: string | undefined,
  locale: "en-GB" | "en-US" = "en-GB",
) {
  if (audioUrl) {
    try {
      await new Audio(audioUrl).play();
      return true;
    } catch {
      // A local voice keeps the round moving if a recorded asset is unavailable.
    }
  }
  return text ? speakWord({ id: text, word: text }, { locale }) : false;
}
