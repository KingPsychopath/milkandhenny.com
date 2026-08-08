import { useCallback, useEffect, useRef, useState } from "react";
import { liarsHaptic, playLiarsSound } from "./liars-effects.client";
import { liarsTorch } from "./torch.client";
import { speakLiarsNarration } from "./narration.client";
import type { LiarsSnapshot } from "./types";

export type LiarsOverlay = "none" | "death" | "revive" | "dusk" | "dawn" | "dread";

/**
 * Fires from snapshot transitions rather than from commands, so a re-poll, a socket wake and a
 * re-render cannot double-fire the same beat. Every effect is keyed on something that only changes
 * once — a phase and round pair, a report id, a dawn timestamp — and the key it last fired on is
 * held in a ref.
 */
export function useLiarsEffects(input: {
  snapshot: LiarsSnapshot | null;
  clockOffset: number;
  /** Bells, heartbeats, the death sting. */
  effects: boolean;
  /** Anything read aloud. Separate, so a room can keep the atmosphere and lose the voice. */
  voice: boolean;
  /** Only one device makes noise in a shared room, or eight phones echo a beat apart. */
  isNarrator: boolean;
}) {
  const [overlay, setOverlay] = useState<LiarsOverlay>("none");
  const firedRef = useRef(new Set<string>());
  const overlayTimerRef = useRef<number | null>(null);
  const { snapshot, clockOffset } = input;

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
  const audible = input.effects && (snapshot?.roomMode === "remote" || input.isNarrator);
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

  // Your turn, on a call, where nobody can catch your eye to tell you. Long and unmistakable —
  // the only friction anybody reported was people not noticing the turn had reached them.
  useEffect(() => {
    const clue = snapshot?.clue;
    if (!clue || snapshot?.phase !== "clue") return;
    if (clue.handoff !== "each-turn") return;
    if (clue.currentPlayerId !== snapshot.player?.playerId) return;
    once(`turn:${clue.round}:${clue.doneIds.length}`, () => {
      playLiarsSound("report", audibleRef.current);
      liarsHaptic("turn");
    });
  }, [snapshot]);

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

    /*
     * The dread: every screen reddens in the seconds before the name lands, and then only one of
     * them keeps going.
     *
     * Doing this to a random few people would be false signal — they would flinch, everybody would
     * read the flinch, and it would mean nothing. Doing it to everybody means nothing can be read
     * from it at all, which is the same rule the night report card follows: identical envelope,
     * different contents. With the attack announcement off, or a cold open, it is also the only
     * thing covering a saved player's reaction.
     */
    const dread = at(dawn.nameLandsAt - 2_200);
    if (dread > -800)
      timers.push(
        window.setTimeout(
          () => once(`dread:${dawn.nameLandsAt}`, () => showOverlay("dread", 2_200)),
          Math.max(0, dread),
        ),
      );

    /*
     * Three beats under the dread, closing up into the name.
     *
     * The redden was carrying this moment on its own and a colour shift alone is easy to miss on a
     * phone lying flat on a table. The night already ends on an accelerating heartbeat, so this is
     * the same instrument picked back up rather than a new one — and it runs on every device, for
     * the same reason the redden does.
     */
    for (let beat = 0; beat < 3; beat += 1) {
      const thud = at(dawn.nameLandsAt - (2_000 - beat * 700));
      if (thud <= 0) continue;
      timers.push(
        window.setTimeout(() => playLiarsSound("heartbeat", audibleRef.current), thud),
      );
    }

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
    if (!dawn || snapshot?.phase !== "dawn" || !input.voice) return;
    // Remote rooms have no shared speaker, so each device reads its own copy.
    if (snapshot.roomMode === "same-room" && !input.isNarrator) return;
    once(`narration:${dawn.nameLandsAt}`, () => void speakLiarsNarration(dawn.narration));
  }, [input.voice, input.isNarrator, snapshot]);

  // A new game starts with a clean slate, or last game's ids would suppress this one's beats.
  const gameNumber = snapshot?.gameNumber;
  useEffect(() => {
    firedRef.current = new Set();
  }, [gameNumber]);

  return { overlay };
}
