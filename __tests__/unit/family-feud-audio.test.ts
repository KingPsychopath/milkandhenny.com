import { beforeEach, describe, expect, it, vi } from "vitest";

function fakeAudioContext() {
  const oscillators: Array<{
    connect: ReturnType<typeof vi.fn>;
    frequency: { setValueAtTime: ReturnType<typeof vi.fn> };
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    type: OscillatorType;
  }> = [];
  const destination = {};
  const context = {
    createGain: vi.fn(() => ({
      connect: vi.fn(() => destination),
      gain: {
        exponentialRampToValueAtTime: vi.fn(),
        setValueAtTime: vi.fn(),
      },
    })),
    createOscillator: vi.fn(() => {
      const oscillator = {
        connect: vi.fn((target: unknown) => target),
        frequency: { setValueAtTime: vi.fn() },
        start: vi.fn(),
        stop: vi.fn(),
        type: "sine" as OscillatorType,
      };
      oscillators.push(oscillator);
      return oscillator;
    }),
    currentTime: 1,
    destination,
    resume: vi.fn(),
    state: "running",
  };
  return { context, oscillators };
}

describe("Family Feud audio cues", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("schedules every game cue and honours mute", async () => {
    const { context, oscillators } = fakeAudioContext();
    vi.stubGlobal(
      "AudioContext",
      vi.fn(function AudioContextMock() {
        return context;
      }),
    );
    const { playFamilyFeudSound } =
      await import("../../features/things/family-feud/family-feud-audio.client");

    for (const cue of ["buzz", "open", "correct", "miss", "timer", "steal", "victory"] as const)
      playFamilyFeudSound(cue);

    expect(oscillators).toHaveLength(18);
    expect(
      oscillators.every(({ start, stop }) => start.mock.calls.length && stop.mock.calls.length),
    ).toBe(true);
    playFamilyFeudSound("correct", true);
    expect(oscillators).toHaveLength(18);
  });

  it("keeps controls usable when Web Audio is unavailable", async () => {
    vi.stubGlobal(
      "AudioContext",
      vi.fn(function AudioContextMock() {
        throw new Error("unsupported");
      }),
    );
    const { playFamilyFeudSound, unlockFamilyFeudAudio } =
      await import("../../features/things/family-feud/family-feud-audio.client");

    expect(() => unlockFamilyFeudAudio()).not.toThrow();
    expect(() => playFamilyFeudSound("buzz")).not.toThrow();
  });
});
