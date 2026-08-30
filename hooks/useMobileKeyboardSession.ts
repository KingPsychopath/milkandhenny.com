import { useCallback, useEffect, useRef, type RefObject } from "react";
import {
  measureMobileKeyboardViewport,
  placeMobileKeyboardViewport,
  type MobileKeyboardViewportMetrics,
  type MobileKeyboardViewportPlacement,
} from "@/lib/shared/mobile-keyboard-viewport";

interface MobileKeyboardSessionContext<TInput extends HTMLElement, TSurface extends HTMLElement> {
  input: TInput;
  metrics: MobileKeyboardViewportMetrics;
  placement: MobileKeyboardViewportPlacement;
  surface: TSurface;
}

interface MobileKeyboardSessionOptions<
  TInput extends HTMLElement,
  TDock extends HTMLElement,
  TSurface extends HTMLElement,
> {
  dockRef: RefObject<TDock | null>;
  enabled?: boolean;
  inputRef: RefObject<TInput | null>;
  onSessionClose?: () => void;
  onSessionOpen?: (context: MobileKeyboardSessionContext<TInput, TSurface>) => void;
  restoreScrollOnClose?: boolean;
  settleDelayMs?: number;
  surfaceRef: RefObject<TSurface | null>;
}

/**
 * Opt-in lifecycle for mobile surfaces with a fixed rapid-entry control. It normalizes Safari's
 * competing VisualViewport coordinate spaces without imposing scroll or focus policy on ordinary
 * forms.
 */
export function useMobileKeyboardSession<
  TInput extends HTMLElement,
  TDock extends HTMLElement,
  TSurface extends HTMLElement,
>({
  dockRef,
  enabled = true,
  inputRef,
  onSessionClose,
  onSessionOpen,
  restoreScrollOnClose = false,
  settleDelayMs = 90,
  surfaceRef,
}: MobileKeyboardSessionOptions<TInput, TDock, TSurface>) {
  const onSessionCloseRef = useRef(onSessionClose);
  const onSessionOpenRef = useRef(onSessionOpen);
  onSessionCloseRef.current = onSessionClose;
  onSessionOpenRef.current = onSessionOpen;

  const dismissKeyboard = useCallback(() => inputRef.current?.blur(), [inputRef]);

  useEffect(() => {
    const visualViewport = window.visualViewport;
    const dock = dockRef.current;
    const input = inputRef.current;
    const surface = surfaceRef.current;
    if (
      !enabled ||
      !visualViewport ||
      !dock ||
      !input ||
      !surface ||
      navigator.maxTouchPoints === 0
    )
      return;

    let frame = 0;
    let openTimer: ReturnType<typeof setTimeout> | null = null;
    let restoreTimer: ReturnType<typeof setTimeout> | null = null;
    let keyboardWasOpen = false;
    let openedForSession = false;
    let restorePending = false;
    let readingPosition: number | null = null;
    let latestContext: MobileKeyboardSessionContext<TInput, TSurface> | null = null;
    let expandedHeight = Math.max(
      window.innerHeight,
      document.documentElement.clientHeight,
      visualViewport.height + visualViewport.offsetTop,
    );
    const clearLayout = () => {
      surface.removeAttribute("data-mobile-keyboard");
      surface.style.removeProperty("--mobile-keyboard-layout-height");
      surface.style.removeProperty("--mobile-keyboard-viewport-height");
      surface.style.removeProperty("--mobile-keyboard-viewport-top");
      surface.style.removeProperty("--mobile-keyboard-dock-offset");
    };
    const rememberReadingPosition = () => {
      if (!restoreScrollOnClose || keyboardWasOpen || restorePending || readingPosition !== null)
        return;
      readingPosition = window.scrollY + Math.max(0, visualViewport.offsetTop);
    };
    const cancelRestore = () => {
      if (restoreTimer) clearTimeout(restoreTimer);
      restoreTimer = null;
      restorePending = false;
    };
    const scheduleRestore = () => {
      if (!restorePending || readingPosition === null) return;
      if (restoreTimer) clearTimeout(restoreTimer);
      restoreTimer = setTimeout(() => {
        restoreTimer = null;
        if (!restorePending || readingPosition === null) return;
        const top = readingPosition;
        readingPosition = null;
        restorePending = false;
        requestAnimationFrame(() => window.scrollTo({ top, behavior: "auto" }));
      }, 140);
    };
    const closeSession = (viewportContracted: boolean, preserveReadingPosition = false) => {
      const sessionWasOpen = keyboardWasOpen;
      const shouldRestore =
        readingPosition !== null && (sessionWasOpen || viewportContracted || restorePending);
      keyboardWasOpen = false;
      openedForSession = false;
      latestContext = null;
      if (openTimer) clearTimeout(openTimer);
      openTimer = null;
      clearLayout();
      if (sessionWasOpen) onSessionCloseRef.current?.();
      if (!shouldRestore) {
        if (!preserveReadingPosition) readingPosition = null;
        return;
      }
      restorePending = true;
      scheduleRestore();
    };
    const announceOpen = () => {
      openTimer = null;
      if (!keyboardWasOpen || document.activeElement !== input || !latestContext) return;
      openedForSession = true;
      onSessionOpenRef.current?.(latestContext);
    };
    const measure = () => {
      frame = 0;
      const currentLayoutHeight = Math.max(
        window.innerHeight,
        document.documentElement.clientHeight,
        visualViewport.height + visualViewport.offsetTop,
      );
      const metrics = measureMobileKeyboardViewport({
        currentLayoutHeight,
        expandedLayoutHeight: expandedHeight,
        scale: visualViewport.scale,
        visualHeight: visualViewport.height,
        visualTop: visualViewport.offsetTop,
      });
      const focused = document.activeElement === input;
      if (!focused) {
        expandedHeight = Math.max(expandedHeight, currentLayoutHeight);
        closeSession(metrics.keyboardOpen);
        return;
      }
      if (!metrics.keyboardOpen) {
        closeSession(false, true);
        return;
      }
      if (restorePending) cancelRestore();
      if (!keyboardWasOpen) {
        keyboardWasOpen = true;
        openedForSession = false;
      }

      surface.setAttribute("data-mobile-keyboard", "");
      surface.style.setProperty("--mobile-keyboard-layout-height", `${metrics.layoutHeight}px`);
      surface.style.setProperty("--mobile-keyboard-viewport-height", `${metrics.visualHeight}px`);
      surface.style.setProperty("--mobile-keyboard-viewport-top", "0px");
      surface.style.setProperty("--mobile-keyboard-dock-offset", "0px");
      const placement = placeMobileKeyboardViewport(metrics, dock.getBoundingClientRect().bottom);
      surface.style.setProperty("--mobile-keyboard-viewport-top", `${placement.topOffset}px`);
      surface.style.setProperty("--mobile-keyboard-dock-offset", `${placement.bottomOffset}px`);
      latestContext = { input, metrics, placement, surface };
      if (!openedForSession) {
        if (openTimer) clearTimeout(openTimer);
        openTimer = setTimeout(announceOpen, settleDelayMs);
      }
    };
    const scheduleMeasure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };

    input.addEventListener("pointerdown", rememberReadingPosition);
    input.addEventListener("focus", rememberReadingPosition);
    input.addEventListener("focus", scheduleMeasure);
    input.addEventListener("blur", scheduleMeasure);
    visualViewport.addEventListener("resize", scheduleMeasure);
    visualViewport.addEventListener("scroll", scheduleMeasure);
    window.addEventListener("resize", scheduleMeasure);
    scheduleMeasure();
    return () => {
      cancelAnimationFrame(frame);
      if (openTimer) clearTimeout(openTimer);
      if (restoreTimer) clearTimeout(restoreTimer);
      input.removeEventListener("pointerdown", rememberReadingPosition);
      input.removeEventListener("focus", rememberReadingPosition);
      input.removeEventListener("focus", scheduleMeasure);
      input.removeEventListener("blur", scheduleMeasure);
      visualViewport.removeEventListener("resize", scheduleMeasure);
      visualViewport.removeEventListener("scroll", scheduleMeasure);
      window.removeEventListener("resize", scheduleMeasure);
      clearLayout();
    };
  }, [dockRef, enabled, inputRef, restoreScrollOnClose, settleDelayMs, surfaceRef]);

  return { dismissKeyboard };
}
