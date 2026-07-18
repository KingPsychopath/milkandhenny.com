import { useId } from "react";

interface OrientationLockControlProps {
  disabled?: boolean;
  locked: boolean;
  onToggle: () => void;
}

export function OrientationLockControl({
  disabled = false,
  locked,
  onToggle,
}: OrientationLockControlProps) {
  const noteId = useId();
  return (
    <div className="mb-3 flex items-center justify-between gap-4">
      <p id={noteId} className="font-mono text-micro leading-relaxed text-white/45">
        {disabled
          ? "turn tilt judging on to use orientation lock"
          : locked
            ? "pauses if the phone rotates"
            : "adapts when the phone rotates"}
      </p>
      <button
        type="button"
        onClick={onToggle}
        disabled={disabled}
        aria-pressed={locked}
        aria-describedby={noteId}
        className={`min-h-11 shrink-0 rounded-full border px-4 font-mono text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
          locked ? "border-white/55 bg-white/12 text-white" : "border-white/15 text-white/55"
        }`}
      >
        orientation · {locked ? "locked" : "auto"} {locked ? "▣" : "↻"}
      </button>
    </div>
  );
}

interface OrientationControlsProps {
  fullscreenActive: boolean;
  fullscreenInstallFallback: boolean;
  fullscreenMessage: string | null;
  fullscreenStandalone: boolean;
  fullscreenSupported: boolean;
  locked: boolean;
  motionUnavailable: boolean;
  onFullscreen: () => void;
  onToggle: () => void;
}

export function OrientationControls({
  fullscreenActive,
  fullscreenInstallFallback,
  fullscreenMessage,
  fullscreenStandalone,
  fullscreenSupported,
  locked,
  motionUnavailable,
  onFullscreen,
  onToggle,
}: OrientationControlsProps) {
  return (
    <div className="mx-auto mt-6 max-w-lg">
      <OrientationLockControl locked={locked} onToggle={onToggle} />
      {fullscreenSupported ? (
        <button
          type="button"
          onClick={onFullscreen}
          aria-pressed={fullscreenActive}
          className="mb-3 min-h-11 w-full rounded-full border border-white/15 px-4 font-mono text-xs text-white/65"
        >
          {fullscreenActive ? "exit fullscreen" : "enter fullscreen"} {fullscreenActive ? "↙" : "↗"}
        </button>
      ) : fullscreenStandalone ? (
        <p className="mb-3 text-center font-mono text-micro text-white/45">running fullscreen</p>
      ) : fullscreenInstallFallback ? (
        <p className="mb-3 text-center font-mono text-micro leading-relaxed text-white/45">
          For fewer browser bars, add this page to your Home Screen.
        </p>
      ) : null}
      {fullscreenMessage ? (
        <p
          aria-live="polite"
          className="mb-3 text-center font-mono text-micro leading-relaxed text-white/55"
        >
          {fullscreenMessage}
        </p>
      ) : null}
      <p className="mt-3 text-center font-mono text-micro text-white/45">
        {motionUnavailable
          ? "motion unavailable — use the on-screen buttons"
          : `portrait + landscape · ${locked ? "locks when the round starts" : "auto-calibrates"}`}
      </p>
    </div>
  );
}
