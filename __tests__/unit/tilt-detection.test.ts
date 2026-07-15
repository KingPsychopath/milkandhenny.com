import { describe, expect, it } from "vitest";
import { stablePitch, TiltGestureDetector } from "../../features/things/shared/tiltDetection";

describe("TiltGestureDetector", () => {
  it("ignores a brief accidental threshold crossing", () => {
    const detector = new TiltGestureDetector();
    detector.reset(0);

    expect(detector.sample(0, 0)).toBeNull();
    expect(detector.sample(28, 20)).toBeNull();
    expect(detector.sample(4, 80)).toBeNull();
  });

  it("accepts a deliberate held gesture without adding noticeable delay", () => {
    const detector = new TiltGestureDetector();
    detector.reset(0);

    expect(detector.sample(0, 0)).toBeNull();
    expect(detector.sample(-28, 20)).toBeNull();
    expect(detector.sample(-30, 145)).toBe("correct");
  });

  it("requires a return to neutral before another decision", () => {
    const detector = new TiltGestureDetector();
    detector.reset(0);

    detector.sample(0, 0);
    detector.sample(28, 20);
    expect(detector.sample(30, 145)).toBe("pass");
    expect(detector.sample(31, 300)).toBeNull();
    expect(detector.sample(0, 350)).toBeNull();
    expect(detector.sample(28, 380)).toBeNull();
    expect(detector.sample(30, 510)).toBe("pass");
  });
});

describe("stablePitch", () => {
  it("rejects a phone that is still moving", () => {
    const samples = [
      { pitch: 0, time: 0 },
      { pitch: 4, time: 100 },
      { pitch: 9, time: 200 },
      { pitch: 13, time: 300 },
      { pitch: 18, time: 400 },
    ];

    expect(stablePitch(samples, 400)).toBeNull();
  });

  it("finds a stable baseline across the angle wrap", () => {
    const samples = [
      { pitch: 179, time: 0 },
      { pitch: -179, time: 100 },
      { pitch: 180, time: 200 },
      { pitch: -178, time: 300 },
      { pitch: 179, time: 400 },
    ];

    expect(stablePitch(samples, 400)).toBe(-180);
  });
});
