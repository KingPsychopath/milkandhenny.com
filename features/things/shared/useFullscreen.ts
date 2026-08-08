import { useCallback, useEffect, useRef, useState } from "react";
import type { GameOrientation } from "./orientation";
import { isStandaloneWebApp } from "./web-app.client";

interface WebkitFullscreenDocument extends Document {
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
}

interface WebkitFullscreenElement extends HTMLDivElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}

interface LockableScreenOrientation {
  lock?: (orientation: OrientationLockType) => Promise<void>;
  unlock?: () => void;
}

export function useFullscreen() {
  const targetRef = useRef<HTMLDivElement>(null);
  const [supported, setSupported] = useState(false);
  const [active, setActive] = useState(false);
  const [standalone, setStandalone] = useState(false);
  const [installFallback, setInstallFallback] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const target = targetRef.current as WebkitFullscreenElement | null;
    const webkitDocument = document as WebkitFullscreenDocument;
    const displayMode = window.matchMedia("(display-mode: standalone)");

    const update = () => {
      const installed = isStandaloneWebApp();
      const fullscreenElement =
        document.fullscreenElement ?? webkitDocument.webkitFullscreenElement;
      setStandalone(installed);
      setInstallFallback(
        !installed &&
          (navigator.maxTouchPoints > 0 || window.matchMedia("(pointer: coarse)").matches),
      );
      setActive(fullscreenElement === target);
      setSupported(
        !installed &&
          Boolean(
            target &&
            ((document.fullscreenEnabled !== false && target.requestFullscreen) ||
              (webkitDocument.webkitFullscreenEnabled !== false && target.webkitRequestFullscreen)),
          ),
      );
    };

    update();
    document.addEventListener("fullscreenchange", update);
    document.addEventListener("webkitfullscreenchange", update);
    displayMode.addEventListener?.("change", update);
    return () => {
      document.removeEventListener("fullscreenchange", update);
      document.removeEventListener("webkitfullscreenchange", update);
      displayMode.removeEventListener?.("change", update);
    };
  }, []);

  const toggle = useCallback(async () => {
    const target = targetRef.current as WebkitFullscreenElement | null;
    const webkitDocument = document as WebkitFullscreenDocument;
    if (!target) return;
    setMessage(null);

    try {
      const fullscreenElement =
        document.fullscreenElement ?? webkitDocument.webkitFullscreenElement;
      if (fullscreenElement) {
        if (document.exitFullscreen) await document.exitFullscreen();
        else await webkitDocument.webkitExitFullscreen?.();
        return;
      }

      if (target.requestFullscreen) await target.requestFullscreen();
      else await target.webkitRequestFullscreen?.();
    } catch {
      setMessage(
        "Fullscreen was blocked. Tap the button again, or add the game to your Home Screen.",
      );
    }
  }, []);

  const lockOrientation = useCallback(async (orientation: GameOrientation) => {
    const screenOrientation = window.screen.orientation as LockableScreenOrientation | undefined;
    if (orientation === "auto") {
      screenOrientation?.unlock?.();
      return;
    }
    setMessage(null);
    if (!screenOrientation?.lock) {
      setMessage(
        `This browser cannot lock ${orientation}. Turn the phone before the countdown ends.`,
      );
      return;
    }

    const target = targetRef.current as WebkitFullscreenElement | null;
    const webkitDocument = document as WebkitFullscreenDocument;
    try {
      const fullscreenElement =
        document.fullscreenElement ?? webkitDocument.webkitFullscreenElement;
      if (!fullscreenElement && !isStandaloneWebApp() && target) {
        if (target.requestFullscreen) await target.requestFullscreen();
        else await target.webkitRequestFullscreen?.();
      }
      await screenOrientation.lock(orientation);
    } catch {
      setMessage(
        `This browser could not lock ${orientation}. Turn the phone before the countdown ends.`,
      );
    }
  }, []);

  useEffect(
    () => () => {
      const screenOrientation = window.screen.orientation as LockableScreenOrientation | undefined;
      screenOrientation?.unlock?.();
    },
    [],
  );

  return {
    targetRef,
    supported,
    active,
    standalone,
    installFallback,
    message,
    toggle,
    lockOrientation,
  };
}
