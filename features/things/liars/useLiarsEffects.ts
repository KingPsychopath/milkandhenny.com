import { useCallback, useEffect, useRef, useState } from "react";
import { liarsHaptic, playLiarsSound } from "./liars-effects.client";
import { liarsTorch } from "./torch.client";
import { speakLiarsNarration } from "./narration.client";
import type { LiarsSnapshot } from "./types";

export type LiarsOverlay = "none" | "death" | "revive" | "dusk" | "dawn";

/**
 * Fires from snapshot transitions rather than from commands, so a re-poll, a socket wake and a
 * re-render cannot double-fire the same beat. Every effect is keyed on something that only changes
 * once — a phase and round pair, a report id, a dawn timestamp — and the key it last fired on is
 * held in a ref.
 */
export function useLiarsEffects(input: {
  snapshot: LiarsSnapshot | null;
  clockOffset: number;
  muted: boolean;
  /** Only one device makes noise in a shared room, or eight phones echo a beat apart. */
  isNarrator: boolean;
}) {
  const [overlay, setOverlay] = useState<LiarsOverlay>("none");
  const firedRef = useRef(new Set<string>());
  const overlayTimerRef = useRef<number | null>(null);
  const { snapshot, clockOffset, muted } = input;

  /**
   * One clearing timer, held in a ref rather than inside a phase effect. The death overlay is a
   * near-opaque full-screen layer, and it used to be cleared by a timer owned by the dawn effect —
   * so a phase change before it fired cancelled the clear and left the screen black for good.
   */
  const showOverlay = useCallback((kind: LiarsOverlay, holdMs: number) => {
    setOverlay(kind);
    if (overlayTimerRef.current !== null) window.clearTimeout(overlayTimerRef.current);
    overlayTimerRef.current = window.setTimeout(() => {
      overlayTimerRef.current = null;
      setOverlay("none");
    }, holdMs);
  }, []);

  // A shared room routes sound to one device; on a call every device needs it.
  const audible = !muted && (snapshot?.roomMode === "remote" || input.isNarrator);
  const audibleRef = useRef(audible);
  audibleRef.current = audible;

  const once = (key: string, run: () => void) => {
    if (firedRef.current.has(key)) return;
    firedRef.current.add(key);
    run();
  };

  // Phase openings.
  useEffect(() => {
    if (!snapshot) return;
    const key = `${snapshot.phase}:${snapshot.round}:${snapshot.gameNumber}`;
    if (snapshot.phase === "night")
      once(`dusk:${key}`, () => {
        showOverlay("dusk", 2_500);
        playLiarsSound("dusk", audibleRef.current);
      });
    if (snapshot.phase === "dawn")
      once(`dawn:${key}`, () => showOverlay("dawn", 2_500));
    if (snapshot.phase === "verdict")
      once(`toll:${key}`, () => {
        playLiarsSound("toll", audibleRef.current);
        liarsHaptic("toll");
      });
    if (snapshot.phase === "ending" && snapshot.ending) {
      const won = snapshot.ending.roles.some(
        ({ playerId, role }) =>
          playerId === snapshot.player?.playerId &&
          (snapshot.ending!.winner === "third"
            ? role === "jester"
            : snapshot.ending!.winner === "mafia"
              ? role === "mafia" || role === "godfather" || role === "jammer" || role === "imposter" || role === "mole"
              : true),
      );
      once(`end:${snapshot.gameNumber}`, () =>
        playLiarsSound(won ? "win" : "lose", audibleRef.current),
      );
    }
  }, [showOverlay, snapshot]);

  // The night report card. Its own key, so it lands the same on every device.
  useEffect(() => {
    const report = snapshot?.player?.report;
    if (!report) return;
    once(`report:${report.id}`, () => {
      playLiarsSound("report", audibleRef.current);
      liarsHaptic("report");
    });
  }, [snapshot]);

  // The heartbeat through the last ten seconds of night.
  useEffect(() => {
    if (!snapshot || snapshot.phase !== "night" || !snapshot.player?.alive) return;
    const endsAt = snapshot.phaseEndsAt;
    const timers: number[] = [];
    for (let beat = 0; beat < 6; beat += 1) {
      // Accelerating: the gaps close as the night runs out.
      const at = endsAt - (9_500 - beat * 1_500) - clockOffset - Date.now();
      if (at <= 0) continue;
      timers.push(
        window.setTimeout(() => {
          playLiarsSound("heartbeat", audibleRef.current);
        }, at),
      );
    }
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [clockOffset, snapshot]);

  // The dawn choreography: the name lands, three seconds of dead, then the revive.
  useEffect(() => {
    const dawn = snapshot?.dawn;
    if (!snapshot || !dawn || snapshot.phase !== "dawn") return;
    const you = snapshot.player?.playerId;
    const yours = dawn.deaths.find(({ playerId }) => playerId === you);
    const timers: number[] = [];
    const at = (moment: number) => moment - clockOffset - Date.now();

    const land = at(dawn.nameLandsAt);
    if (land > -1_500)
      timers.push(
        window.setTimeout(
          () =>
            once(`death:${dawn.nameLandsAt}`, () => {
              playLiarsSound("death", audibleRef.current);
              if (yours) {
                // Capped, so the layer can never outlive the beat it belongs to.
                showOverlay("death", Math.max(2_600, dawn.settleAt - dawn.nameLandsAt));
                liarsHaptic("death");
                if (snapshot.toggles.cameraTorch) void liarsTorch(600);
              }
            }),
          Math.max(0, land),
        ),
      );

    if (dawn.reviveAt !== null) {
      const revive = at(dawn.reviveAt);
      if (revive > -1_500)
        timers.push(
          window.setTimeout(
            () =>
              once(`revive:${dawn.reviveAt}`, () => {
                playLiarsSound("revive", audibleRef.current);
                if (yours) {
                  showOverlay("revive", 1_800);
                  liarsHaptic("revive");
                }
              }),
            Math.max(0, revive),
          ),
        );
    }

    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [clockOffset, showOverlay, snapshot]);

  // Belt and braces: nothing survives the phase it belongs to, whatever happened to its timer.
  const phase = snapshot?.phase;
  useEffect(() => {
    if (phase === "dawn" || phase === "night") return;
    if (overlayTimerRef.current !== null) {
      window.clearTimeout(overlayTimerRef.current);
      overlayTimerRef.current = null;
    }
    setOverlay("none");
  }, [phase]);

  useEffect(
    () => () => {
      if (overlayTimerRef.current !== null) window.clearTimeout(overlayTimerRef.current);
    },
    [],
  );

  // The story, read aloud by whichever single device the server elected.
  useEffect(() => {
    const dawn = snapshot?.dawn;
    if (!dawn || snapshot?.phase !== "dawn" || !audible) return;
    // Remote rooms have no shared speaker, so each device reads its own copy.
    if (snapshot.roomMode === "same-room" && !input.isNarrator) return;
    once(`narration:${dawn.nameLandsAt}`, () => void speakLiarsNarration(dawn.narration));
  }, [audible, input.isNarrator, snapshot]);

  // A new game starts with a clean slate, or last game's ids would suppress this one's beats.
  const gameNumber = snapshot?.gameNumber;
  useEffect(() => {
    firedRef.current = new Set();
  }, [gameNumber]);

  return { overlay };
}
