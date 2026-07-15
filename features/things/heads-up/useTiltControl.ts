import { useCallback, useEffect, useRef, useState } from "react";

type TiltDecision = "correct" | "pass";
type MotionStatus = "idle" | "enabled" | "denied" | "unavailable";

type PermissionedDeviceOrientationEvent = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

function toRadians(degrees: number) {
  return (degrees * Math.PI) / 180;
}

function screenAngle() {
  const legacyOrientation = (window as Window & { orientation?: number }).orientation;
  return window.screen.orientation?.angle ?? legacyOrientation ?? 0;
}

function normalizedDifference(current: number, baseline: number) {
  return ((current - baseline + 540) % 360) - 180;
}

/** Pitch around the screen's horizontal axis, independent of portrait/landscape rotation. */
export function screenRelativePitch(beta: number, gamma: number, orientationAngle: number) {
  const betaRadians = toRadians(beta);
  const gammaRadians = toRadians(gamma);
  const orientationRadians = toRadians(orientationAngle);

  // Earth's up vector expressed in the device's natural coordinate frame.
  const deviceX = -Math.cos(betaRadians) * Math.sin(gammaRadians);
  const deviceY = Math.sin(betaRadians);
  const deviceZ = Math.cos(betaRadians) * Math.cos(gammaRadians);

  // Rotate natural device coordinates into the screen's current orientation.
  const screenUp = Math.cos(orientationRadians) * deviceY - Math.sin(orientationRadians) * deviceX;

  return (Math.atan2(deviceZ, screenUp) * 180) / Math.PI;
}

export function useTiltControl(enabled: boolean, onDecision: (decision: TiltDecision) => void) {
  const [status, setStatus] = useState<MotionStatus>("idle");
  const neutral = useRef<number | null>(null);
  const currentPitch = useRef<number | null>(null);
  const orientationAngle = useRef<number | null>(null);
  const armed = useRef(true);
  const decisionRef = useRef(onDecision);
  decisionRef.current = onDecision;

  const calibrate = useCallback(() => {
    neutral.current = currentPitch.current;
    armed.current = true;
  }, []);

  const requestAccess = useCallback(async () => {
    if (typeof window === "undefined" || !("DeviceOrientationEvent" in window)) {
      setStatus("unavailable");
      return false;
    }

    const OrientationEvent = DeviceOrientationEvent as PermissionedDeviceOrientationEvent;
    if (typeof OrientationEvent.requestPermission === "function") {
      try {
        const permission = await OrientationEvent.requestPermission();
        setStatus(permission === "granted" ? "enabled" : "denied");
        return permission === "granted";
      } catch {
        setStatus("denied");
        return false;
      }
    }

    setStatus("enabled");
    return true;
  }, []);

  useEffect(() => {
    if (status !== "enabled") return;

    const handleOrientation = (event: DeviceOrientationEvent) => {
      if (event.beta === null || event.gamma === null) return;
      const nextOrientationAngle = screenAngle();
      const nextPitch = screenRelativePitch(event.beta, event.gamma, nextOrientationAngle);
      currentPitch.current = nextPitch;

      if (orientationAngle.current !== nextOrientationAngle) {
        orientationAngle.current = nextOrientationAngle;
        neutral.current = nextPitch;
        armed.current = true;
        return;
      }

      if (!enabled) return;
      neutral.current ??= nextPitch;

      const difference = normalizedDifference(nextPitch, neutral.current);
      if (Math.abs(difference) < 9) armed.current = true;
      if (!armed.current) return;

      if (difference <= -24) {
        armed.current = false;
        decisionRef.current("correct");
      } else if (difference >= 24) {
        armed.current = false;
        decisionRef.current("pass");
      }
    };

    window.addEventListener("deviceorientation", handleOrientation, true);
    return () => window.removeEventListener("deviceorientation", handleOrientation, true);
  }, [enabled, status]);

  return { status, requestAccess, calibrate };
}
