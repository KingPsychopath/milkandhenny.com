import { useCallback, useEffect, useRef, useState } from "react";

type TiltDecision = "correct" | "pass";
type MotionStatus = "idle" | "enabled" | "denied" | "unavailable";

type PermissionedDeviceOrientationEvent = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

export function useTiltControl(enabled: boolean, onDecision: (decision: TiltDecision) => void) {
  const [status, setStatus] = useState<MotionStatus>("idle");
  const neutral = useRef<number | null>(null);
  const currentAngle = useRef<number | null>(null);
  const armed = useRef(true);
  const decisionRef = useRef(onDecision);
  decisionRef.current = onDecision;

  const calibrate = useCallback(() => {
    neutral.current = currentAngle.current;
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
      if (event.beta === null) return;
      currentAngle.current = event.beta;
      if (!enabled) return;
      neutral.current ??= event.beta;

      const difference = event.beta - neutral.current;
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
