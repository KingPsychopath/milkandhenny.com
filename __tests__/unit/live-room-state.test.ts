import { describe, expect, it } from "vitest";
import {
  RECONNECTING_MESSAGE,
  UNAVAILABLE_READS_BEFORE_ENDING,
  resolveLiveRoomRead,
  shouldApplyLiveRoomSnapshot,
} from "../../features/things/shared/live-room-state";

const snapshot = { sequence: 4, serverNow: 1_000 };

describe("live room recovery", () => {
  it("keeps a player in the game through a single unavailable read", () => {
    const outcome = resolveLiveRoomRead({ ok: false, error: "Room unavailable" }, 0);
    expect(outcome.ended).toBe(false);
    expect(outcome.message).toBe(RECONNECTING_MESSAGE);
    expect(outcome.snapshot).toBeUndefined();
  });

  it("ends the session once the room is unavailable repeatedly", () => {
    let failures = 0;
    let ended = false;
    let message: string | null = null;
    for (let attempt = 0; attempt < UNAVAILABLE_READS_BEFORE_ENDING; attempt += 1) {
      const outcome = resolveLiveRoomRead({ ok: false, error: "Room unavailable" }, failures);
      failures = outcome.consecutiveFailures;
      ended = outcome.ended;
      message = outcome.message;
    }
    expect(ended).toBe(true);
    expect(message).toBe("Room unavailable");
  });

  it("never counts an unreachable server towards ending the session", () => {
    let failures = 0;
    for (let attempt = 0; attempt < UNAVAILABLE_READS_BEFORE_ENDING * 4; attempt += 1) {
      const outcome = resolveLiveRoomRead({ ok: false, unreachable: true }, failures);
      failures = outcome.consecutiveFailures;
      expect(outcome.ended).toBe(false);
    }
    expect(failures).toBe(0);
  });

  it("forgets earlier failures as soon as one read succeeds", () => {
    const first = resolveLiveRoomRead({ ok: false, error: "Room unavailable" }, 0);
    const recovered = resolveLiveRoomRead({ ok: true, snapshot }, first.consecutiveFailures);
    expect(recovered.consecutiveFailures).toBe(0);
    expect(recovered.snapshot).toBe(snapshot);
    expect(recovered.message).toBeNull();

    // A later blip therefore starts counting from scratch rather than tipping straight over.
    const afterRecovery = resolveLiveRoomRead(
      { ok: false, error: "Room unavailable" },
      recovered.consecutiveFailures,
    );
    expect(afterRecovery.ended).toBe(false);
  });

  it("treats an unchanged response as a healthy read without replacing the snapshot", () => {
    const outcome = resolveLiveRoomRead(
      { ok: true, unchanged: true, serverNow: 2_000 },
      UNAVAILABLE_READS_BEFORE_ENDING - 1,
    );
    expect(outcome).toEqual({ consecutiveFailures: 0, ended: false, message: null });
  });

  it("clears the snapshot only when the session actually ends", () => {
    const transient = resolveLiveRoomRead({ ok: false, error: "Room unavailable" }, 0);
    expect(transient.snapshot).toBeUndefined();
    const terminal = resolveLiveRoomRead(
      { ok: false, error: "Room unavailable" },
      UNAVAILABLE_READS_BEFORE_ENDING - 1,
    );
    expect(terminal.snapshot).toBeNull();
  });

  it("never lets an older reconciliation replace a newer mutation response", () => {
    expect(shouldApplyLiveRoomSnapshot(12, 11)).toBe(false);
    expect(shouldApplyLiveRoomSnapshot(12, 12)).toBe(true);
    expect(shouldApplyLiveRoomSnapshot(12, 13)).toBe(true);
  });
});
