/**
 * The camera torch, which is the one effect that needs a permission.
 *
 * It is opt-in and never load-bearing: Chrome on Android is the only place it works at all, and a
 * denial has to be visible rather than silent. Asking for the camera in the middle of somebody's
 * death, with no explanation, is the worst possible moment — so the ask happens when the host turns
 * the toggle on, and the answer is reported back.
 *
 * No video is ever rendered. The track exists only to hold the lamp on.
 */

export type LiarsTorchState = "unsupported" | "prompt" | "granted" | "denied" | "no-torch";

interface TorchCapabilities extends MediaTrackCapabilities {
  torch?: boolean;
}

function cameraAvailable() {
  return typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
}

/** Reads the current answer without asking, where the browser will tell us. */
export async function liarsTorchState(): Promise<LiarsTorchState> {
  if (!cameraAvailable()) return "unsupported";
  try {
    const status = await navigator.permissions?.query({
      name: "camera" as PermissionName,
    });
    if (status?.state === "granted") return "granted";
    if (status?.state === "denied") return "denied";
    return "prompt";
  } catch {
    // Safari has no camera permission descriptor; the only way to know is to ask.
    return "prompt";
  }
}

/**
 * Asks, and releases the camera again immediately. Returns what actually happened so the setup
 * screen can say "your browser is blocking the camera" instead of leaving a dead toggle on.
 */
export async function requestLiarsTorch(): Promise<LiarsTorchState> {
  if (!cameraAvailable()) return "unsupported";
  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    const [track] = stream.getVideoTracks();
    const capabilities = track.getCapabilities?.() as TorchCapabilities | undefined;
    const hasTorch = Boolean(capabilities?.torch);
    return hasTorch ? "granted" : "no-torch";
  } catch (error) {
    // NotAllowedError is a refusal; anything else means the hardware is not there.
    return error instanceof DOMException && error.name === "NotAllowedError"
      ? "denied"
      : "unsupported";
  } finally {
    stream?.getTracks().forEach((track) => track.stop());
  }
}

export function liarsTorchAdvice(state: LiarsTorchState) {
  switch (state) {
    case "granted":
      return "the lamp will flash when you die";
    case "denied":
      return "your browser is blocking the camera — allow it in site settings, then try again";
    case "no-torch":
      return "this camera has no lamp, so everything else still works";
    case "unsupported":
      return "only Chrome on Android can do this one";
    default:
      return "we will ask for the camera once, now rather than mid-game";
  }
}

/** Holds the lamp on for `durationMs`, then puts it out and releases the camera. */
export async function liarsTorch(durationMs: number) {
  if (!cameraAvailable()) return;
  let stream: MediaStream | null = null;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    const [track] = stream.getVideoTracks();
    const capabilities = track.getCapabilities?.() as TorchCapabilities | undefined;
    if (!capabilities?.torch) {
      stream.getTracks().forEach((each) => each.stop());
      return;
    }
    // `torch` is a Chrome-on-Android extension the DOM lib does not describe.
    const set = (on: boolean) =>
      track.applyConstraints({ advanced: [{ torch: on }] } as unknown as MediaTrackConstraints);
    await set(true);
    const held = stream;
    window.setTimeout(() => {
      void set(false).finally(() => held.getTracks().forEach((each) => each.stop()));
    }, durationMs);
  } catch {
    // Denied, unsupported, or no camera. The game plays exactly the same.
    stream?.getTracks().forEach((each) => each.stop());
  }
}
