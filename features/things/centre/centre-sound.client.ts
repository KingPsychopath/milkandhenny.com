import { gameNote, primeGameAudio } from "../shared/game-sound.client";

export function primeCentreAudio() {
  primeGameAudio();
}

export function playCentreSound(
  sound: "count" | "go" | "wall" | "finish" | "winner",
  enabled: boolean,
) {
  if (!enabled) return;
  if (sound === "count") gameNote(330, 0, 0.08, 0.045, "triangle");
  else if (sound === "go") {
    gameNote(440, 0, 0.09, 0.07, "triangle");
    gameNote(660, 0.06, 0.13, 0.07, "triangle");
  } else if (sound === "wall") gameNote(145, 0, 0.07, 0.035, "square");
  else if (sound === "finish") {
    gameNote(523, 0, 0.1, 0.07, "sine");
    gameNote(659, 0.08, 0.12, 0.07, "sine");
    gameNote(784, 0.17, 0.22, 0.08, "sine");
  } else {
    gameNote(392, 0, 0.1, 0.07, "triangle");
    gameNote(523, 0.09, 0.12, 0.075, "triangle");
    gameNote(784, 0.2, 0.28, 0.09, "triangle");
  }
}
