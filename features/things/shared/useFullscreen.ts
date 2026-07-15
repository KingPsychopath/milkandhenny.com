import { useCallback, useEffect, useRef, useState } from "react";

interface WebkitFullscreenDocument extends Document {
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
}

interface WebkitFullscreenElement extends HTMLDivElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}

function isStandalone() {
  const navigatorWithStandalone = navigator as Navigator & { standalone?: boolean };
  return (
    navigatorWithStandalone.standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches
  );
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
      const installed = isStandalone();
      const fullscreenElement = document.fullscreenElement ?? webkitDocument.webkitFullscreenElement;
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
                (webkitDocument.webkitFullscreenEnabled !== false &&
                  target.webkitRequestFullscreen)),
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
      setMessage("Fullscreen was blocked. Tap the button again, or add the game to your Home Screen.");
    }
  }, []);

  return { targetRef, supported, active, standalone, installFallback, message, toggle };
}
