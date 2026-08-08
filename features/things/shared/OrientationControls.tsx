import { useId } from "react";
import type { GameOrientation } from "./orientation";

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
  orientation: GameOrientation;
  /** "denied" is recoverable and worth offering; "unavailable" is the device and is not. */
  motionStatus: "idle" | "enabled" | "denied" | "unavailable";
  onFullscreen: () => void;
  onOrientationChange: (orientation: GameOrientation) => void;
  onRequestMotion?: () => void;
}

export function OrientationControls({
  fullscreenActive,
  fullscreenInstallFallback,
  fullscreenMessage,
  fullscreenStandalone,
  fullscreenSupported,
  orientation,
  motionStatus,
  onFullscreen,
  onOrientationChange,
  onRequestMotion,
}: OrientationControlsProps) {
  return (
    <div className="mx-auto mt-6 max-w-lg">
      <fieldset>
        <legend className="font-mono text-micro uppercase tracking-[0.18em] text-white/45">screen orientation</legend>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {(["auto", "portrait", "landscape"] as const).map((value) => {
            const selected = orientation === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => onOrientationChange(value)}
                aria-pressed={selected}
                className={`min-h-11 rounded-full border px-3 font-mono text-xs ${selected ? "border-white/55 bg-white/12 text-white" : "border-white/15 text-white/55"}`}
              >
                {value}
              </button>
            );
          })}
        </div>
        <p className="mt-3 font-mono text-micro leading-relaxed text-white/45">
          {orientation === "auto" ? "adapts if the phone rotates" : `locks ${orientation} when the round starts`}
        </p>
      </fieldset>
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
      {/*
        A refused permission and a device that simply cannot do it are different problems, and only
        one of them has a way out. Saying "unavailable" to someone who tapped "don't allow" leaves
        them with no idea that they can change their mind.
      */}
      {motionStatus === "denied" ? (
        <p className="mt-3 text-center font-mono text-micro text-white/55" role="status">
          motion is turned off — the buttons still work
          {onRequestMotion ? (
            <>
              {" · "}
              <button
                type="button"
                onClick={onRequestMotion}
                className="min-h-11 underline underline-offset-4 hover:text-white"
              >
                turn it on
              </button>
            </>
          ) : null}
        </p>
      ) : motionStatus === "unavailable" ? (
        <p className="mt-3 text-center font-mono text-micro text-white/45">
          this device has no motion sensor — use the on-screen buttons
        </p>
      ) : (
        <p className="mt-3 text-center font-mono text-micro text-white/45">
          {orientation === "auto"
            ? "portrait + landscape · auto-calibrates"
            : `${orientation} · set before play`}
        </p>
      )}
    </div>
  );
}
