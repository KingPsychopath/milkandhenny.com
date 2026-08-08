"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * QR camera preview shared by every scanner surface.
 *
 * Ref-stable callbacks so a re-render can never restart the camera, and a
 * paused flag so a verdict on screen stops further frames being decoded.
 * A refused camera is retryable with a tap — people mis-tap the permission
 * prompt at a busy door, and reloading the page to recover is not obvious.
 *
 * Decoding prefers the native BarcodeDetector, but that API does not exist
 * in Safari — and door helpers are mostly on iPhones — so a pure-JS decoder
 * (jsQR over a canvas) is the fallback rather than a "type it in" shrug.
 */

type Decoder = (video: HTMLVideoElement) => Promise<string | null>;

function nativeDecoder(): Decoder | null {
  const Detector = window.BarcodeDetector;
  if (!Detector) return null;
  const detector = new Detector({ formats: ["qr_code"] });
  return async (video) => {
    const codes = await detector.detect(video);
    return codes[0]?.rawValue ?? null;
  };
}

/**
 * Canvas + jsQR. Downscaled, and throttled to ~8 decodes a second — a
 * full-rate software decode drains an older iPhone and starves the video.
 */
async function jsQrDecoder(): Promise<Decoder> {
  const { default: jsQR } = await import("jsqr");
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  let lastDecodeAt = 0;
  return async (video) => {
    const now = Date.now();
    if (now - lastDecodeAt < 120) return null;
    lastDecodeAt = now;
    if (!context || video.videoWidth === 0) return null;
    const scale = Math.min(1, 640 / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(image.data, image.width, image.height, {
      inversionAttempts: "dontInvert",
    });
    return code?.data ?? null;
  };
}

export function CameraFeed({ onCode, paused }: { onCode: (raw: string) => void; paused: boolean }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onCodeRef = useRef(onCode);
  const pausedRef = useRef(paused);
  const [message, setMessage] = useState("asking for camera access…");
  const [failed, setFailed] = useState(false);
  // Bumping this restarts the camera effect — the "try again" tap.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    onCodeRef.current = onCode;
  }, [onCode]);

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  useEffect(() => {
    let active = true;
    let stream: MediaStream | null = null;
    let animationFrame = 0;

    const stop = () => {
      active = false;
      cancelAnimationFrame(animationFrame);
      stream?.getTracks().forEach((track) => track.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
    };

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setFailed(true);
        setMessage("No camera in this browser — type or search below instead.");
        return;
      }

      let decode: Decoder;
      try {
        decode = nativeDecoder() ?? (await jsQrDecoder());
      } catch {
        setFailed(true);
        setMessage("No QR decoder available — type or search below instead.");
        return;
      }

      setFailed(false);
      setMessage("asking for camera access…");

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" } },
        });
        if (!active || !videoRef.current) return stop();
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        if (!active) return stop();
        setMessage("Point at their code.");

        const scanFrame = async () => {
          if (!active || !videoRef.current) return;
          if (!pausedRef.current) {
            try {
              const raw = await decode(videoRef.current);
              if (raw) onCodeRef.current(raw);
            } catch {
              // Detection fails while the video warms up; the next frame retries.
            }
          }
          animationFrame = requestAnimationFrame(() => void scanFrame());
        };
        animationFrame = requestAnimationFrame(() => void scanFrame());
      } catch {
        if (!active) return;
        setFailed(true);
        setMessage(
          attempt === 0
            ? "Camera access was refused — tap to try again."
            : "Still no camera. Allow camera for this site in your browser settings, then tap again.",
        );
      }
    };

    void start();
    return stop;
  }, [attempt]);

  const retry = useCallback(() => {
    setAttempt((current) => current + 1);
  }, []);

  return (
    <div>
      <div className="relative aspect-square w-full overflow-hidden rounded-2xl border theme-border-strong bg-black/80">
        <video
          ref={videoRef}
          muted
          playsInline
          aria-label="Camera preview for scanning tickets"
          className="h-full w-full object-cover"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-[14%] rounded-xl border-2 border-white/70"
        />
        {failed && (
          <button
            type="button"
            onClick={retry}
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60 px-6 text-center"
          >
            <span className="rounded-lg border border-white/70 px-4 py-2 font-mono text-sm text-white">
              tap to turn the camera on
            </span>
          </button>
        )}
      </div>
      <p aria-live="polite" className="mt-2 text-center font-mono text-micro theme-muted">
        {message}
      </p>
    </div>
  );
}
