import { useCallback, useEffect, useRef, useState } from "react";
import {
  STABLE_WINDOW_MS,
  stablePitch,
  TiltGestureDetector,
  type TiltDecision,
  type TiltSample,
} from "./tiltDetection";

type MotionStatus = "idle" | "enabled" | "denied" | "unavailable";
export type MotionPauseReason = "wrong-orientation" | "settling";

type PermissionedDeviceOrientationEvent = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

const FALLBACK_SETTLE_MS = 700;

function toRadians(degrees: number) {
  return (degrees * Math.PI) / 180;
}

function screenAngle() {
  const legacyOrientation = (window as Window & { orientation?: number }).orientation;
  const angle = window.screen.orientation?.angle ?? legacyOrientation ?? 0;
  return ((angle % 360) + 360) % 360;
}

/** Pitch around the screen's horizontal axis, independent of portrait/landscape rotation. */
export function screenRelativePitch(beta: number, gamma: number, orientationAngle: number) {
  const betaRadians = toRadians(beta);
  const gammaRadians = toRadians(gamma);
  const orientationRadians = toRadians(orientationAngle);

  const deviceX = -Math.cos(betaRadians) * Math.sin(gammaRadians);
  const deviceY = Math.sin(betaRadians);
  const deviceZ = Math.cos(betaRadians) * Math.cos(gammaRadians);
  const screenUp = Math.cos(orientationRadians) * deviceY - Math.sin(orientationRadians) * deviceX;

  return (Math.atan2(deviceZ, screenUp) * 180) / Math.PI;
}

export function useTiltControl(
  enabled: boolean,
  onDecision: (decision: TiltDecision) => void,
  lockCurrentOrientation: boolean,
) {
  const [status, setStatus] = useState<MotionStatus>("idle");
  const [pauseReason, setPauseReason] = useState<MotionPauseReason | null>(null);
  const statusRef = useRef<MotionStatus>("idle");
  const pauseReasonRef = useRef<MotionPauseReason | null>(null);
  const currentPitch = useRef<number | null>(null);
  const orientationAngle = useRef<number | null>(null);
  const lockedOrientationAngle = useRef<number | null>(null);
  const stableSamples = useRef<TiltSample[]>([]);
  const gestureDetector = useRef(new TiltGestureDetector());
  const settleTimeout = useRef<number | null>(null);
  const decisionRef = useRef(onDecision);
  decisionRef.current = onDecision;
  statusRef.current = status;

  const updatePauseReason = useCallback((reason: MotionPauseReason | null) => {
    pauseReasonRef.current = reason;
    setPauseReason((current) => (current === reason ? current : reason));
  }, []);

  const clearSettleTimeout = useCallback(() => {
    if (settleTimeout.current === null) return;
    window.clearTimeout(settleTimeout.current);
    settleTimeout.current = null;
  }, []);

  const finishSettling = useCallback(
    (pitch = currentPitch.current) => {
      clearSettleTimeout();
      orientationAngle.current = screenAngle();
      stableSamples.current = [];
      gestureDetector.current.reset(pitch);
      updatePauseReason(null);
    },
    [clearSettleTimeout, updatePauseReason],
  );

  const beginSettling = useCallback(() => {
    clearSettleTimeout();
    stableSamples.current = [];
    gestureDetector.current.reset(null);
    updatePauseReason("settling");

    if (statusRef.current !== "enabled") {
      settleTimeout.current = window.setTimeout(() => finishSettling(), FALLBACK_SETTLE_MS);
    }
  }, [clearSettleTimeout, finishSettling, updatePauseReason]);

  const pauseForOrientation = useCallback(() => {
    clearSettleTimeout();
    stableSamples.current = [];
    gestureDetector.current.reset(null);
    updatePauseReason("wrong-orientation");
  }, [clearSettleTimeout, updatePauseReason]);

  const calibrate = useCallback(() => {
    clearSettleTimeout();
    const currentOrientationAngle = screenAngle();
    orientationAngle.current = currentOrientationAngle;
    lockedOrientationAngle.current = lockCurrentOrientation ? currentOrientationAngle : null;
    stableSamples.current = [];
    gestureDetector.current.reset(currentPitch.current);
    updatePauseReason(null);
  }, [clearSettleTimeout, lockCurrentOrientation, updatePauseReason]);

  const clearOrientationLock = useCallback(() => {
    clearSettleTimeout();
    lockedOrientationAngle.current = null;
    stableSamples.current = [];
    gestureDetector.current.reset(null);
    updatePauseReason(null);
  }, [clearSettleTimeout, updatePauseReason]);

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
      const now = Date.now();
      currentPitch.current = nextPitch;

      if (
        lockedOrientationAngle.current !== null &&
        nextOrientationAngle !== lockedOrientationAngle.current
      ) {
        if (pauseReasonRef.current !== "wrong-orientation") pauseForOrientation();
        return;
      }

      if (pauseReasonRef.current === "wrong-orientation") {
        orientationAngle.current = nextOrientationAngle;
        beginSettling();
      } else if (orientationAngle.current !== nextOrientationAngle) {
        orientationAngle.current = nextOrientationAngle;
        beginSettling();
      }

      if (pauseReasonRef.current === "settling") {
        const recentSamples = stableSamples.current.filter(
          (sample) => now - sample.time <= STABLE_WINDOW_MS,
        );
        recentSamples.push({ pitch: nextPitch, time: now });
        stableSamples.current = recentSamples;

        const baseline = stablePitch(recentSamples, now);
        if (baseline !== null) finishSettling(baseline);
        return;
      }

      if (!enabled) return;
      const decision = gestureDetector.current.sample(nextPitch, now);
      if (decision) decisionRef.current(decision);
    };

    window.addEventListener("deviceorientation", handleOrientation, true);
    return () => window.removeEventListener("deviceorientation", handleOrientation, true);
  }, [beginSettling, enabled, finishSettling, pauseForOrientation, status]);

  useEffect(() => {
    const handleScreenOrientation = () => {
      const nextOrientationAngle = screenAngle();
      if (
        lockedOrientationAngle.current !== null &&
        nextOrientationAngle !== lockedOrientationAngle.current
      ) {
        pauseForOrientation();
        return;
      }

      orientationAngle.current = nextOrientationAngle;
      beginSettling();
    };

    window.screen.orientation?.addEventListener("change", handleScreenOrientation);
    window.addEventListener("orientationchange", handleScreenOrientation);
    return () => {
      window.screen.orientation?.removeEventListener("change", handleScreenOrientation);
      window.removeEventListener("orientationchange", handleScreenOrientation);
    };
  }, [beginSettling, pauseForOrientation]);

  useEffect(() => clearSettleTimeout, [clearSettleTimeout]);

  return {
    status,
    pauseReason,
    requestAccess,
    calibrate,
    settle: beginSettling,
    clearOrientationLock,
  };
}
