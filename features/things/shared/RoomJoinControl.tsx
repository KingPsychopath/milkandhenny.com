import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import { useHasMounted } from "@/hooks/useHasMounted";

const ROOM_CODE_PATTERN = /^[A-Z2-9]{7}$/;

interface RoomJoinControlProps {
  value: string;
  gamePath: string;
  tone: "light" | "dark";
  message?: string | null;
  onValueChange: (value: string) => void;
  onJoin: (roomCode: string) => void | Promise<void>;
}

interface RoomQrScannerProps {
  gamePath: string;
  tone: RoomJoinControlProps["tone"];
  onCancel: () => void;
  onScan: (roomCode: string) => void;
}

function normalizeRoomCode(value: string) {
  return value
    .toUpperCase()
    .replace(/[^A-Z2-9]/g, "")
    .slice(0, 7);
}

function roomCodeFromQr(value: string, gamePath: string) {
  const directCode = normalizeRoomCode(value.trim());
  if (ROOM_CODE_PATTERN.test(directCode) && value.trim().length === 7) return directCode;

  try {
    const invite = new URL(value, window.location.origin);
    if (invite.origin !== window.location.origin) return null;

    const pathParts = invite.pathname.replace(/\/+$/, "").split("/");
    const gameParts = gamePath.replace(/^\/+|\/+$/g, "").split("/");
    if (pathParts.length !== gameParts.length + 2) return null;
    if (gameParts.some((part, index) => pathParts[index + 1] !== part)) return null;

    const roomCode = normalizeRoomCode(decodeURIComponent(pathParts.at(-1) ?? ""));
    return ROOM_CODE_PATTERN.test(roomCode) ? roomCode : null;
  } catch {
    return null;
  }
}

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="size-5 fill-none stroke-current">
      <path
        d="M8.5 6.5 10 4.75h4l1.5 1.75H18A2.5 2.5 0 0 1 20.5 9v7A2.5 2.5 0 0 1 18 18.5H6A2.5 2.5 0 0 1 3.5 16V9A2.5 2.5 0 0 1 6 6.5h2.5Z"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12.5" r="3.25" strokeWidth="1.6" />
    </svg>
  );
}

function RoomQrScanner({ gamePath, tone, onCancel, onScan }: RoomQrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const onScanRef = useRef(onScan);
  const dialogRef = useFocusTrap<HTMLDivElement>(true);
  const titleId = useId();
  const statusId = useId();
  const [message, setMessage] = useState("asking for camera access…");
  const mounted = useHasMounted();
  useEscapeKey(onCancel, true);

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

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

    const handleVisibilityChange = () => {
      if (!document.hidden) return;
      stop();
      setMessage("Camera paused. Close this and scan again when you're ready.");
    };

    const start = async () => {
      const Detector = window.BarcodeDetector;
      if (!Detector || !navigator.mediaDevices?.getUserMedia) {
        setMessage(
          "Live scanning isn't available here. Use your Camera app to open the invite, or enter the room code.",
        );
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" } },
        });
        if (!active || !videoRef.current) return stop();
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        if (!active) return stop();

        setMessage("Point the camera at the room QR code.");
        const detector = new Detector({ formats: ["qr_code"] });
        const scanFrame = async () => {
          if (!active || !videoRef.current) return;
          try {
            const codes = await detector.detect(videoRef.current);
            if (codes[0]) {
              const roomCode = roomCodeFromQr(codes[0].rawValue, gamePath);
              if (roomCode) {
                setMessage("Room found. Joining…");
                stop();
                onScanRef.current(roomCode);
                return;
              }
              setMessage("That isn't an invite for this game. Try another QR code.");
            }
          } catch {
            // Detection can fail while the video warms up; the next frame retries.
          }
          animationFrame = requestAnimationFrame(() => void scanFrame());
        };
        animationFrame = requestAnimationFrame(() => void scanFrame());
      } catch {
        setMessage("Camera access wasn't available. Enter the room code instead.");
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    void start();
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      stop();
    };
  }, [gamePath]);

  if (!mounted) return null;

  const surface =
    tone === "light"
      ? "border-black/10 bg-[var(--things-cream)] text-black"
      : "border-white/12 bg-[var(--things-night)] text-white";
  const muted = tone === "light" ? "text-black/55" : "text-white/60";
  const frame = tone === "light" ? "border-black/70" : "border-white/80";
  const close = tone === "light" ? "border-black/20" : "border-white/20";

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center bg-black/65 p-3 backdrop-blur-sm sm:items-center sm:p-5">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={statusId}
        className={`animate-in slide-in-from-bottom anim-duration-300 max-h-[calc(100svh-1.5rem)] w-full max-w-md overflow-y-auto rounded-[2rem] border p-5 shadow-2xl motion-reduce:animate-none sm:p-6 ${surface}`}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className={`font-mono text-micro uppercase tracking-[0.18em] ${muted}`}>
              join a room
            </p>
            <h2 id={titleId} className="mt-2 font-serif text-3xl font-semibold">
              Scan the room code.
            </h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close QR scanner"
            className={`flex size-11 shrink-0 items-center justify-center rounded-full border font-mono text-lg ${close}`}
          >
            ×
          </button>
        </div>
        <div className="relative mt-5 aspect-square overflow-hidden rounded-3xl bg-black">
          <video
            ref={videoRef}
            muted
            playsInline
            disablePictureInPicture
            aria-label="Camera preview for scanning a room QR code"
            className="h-full w-full object-cover"
          />
          <div
            aria-hidden="true"
            className={`pointer-events-none absolute inset-[14%] rounded-2xl border-2 ${frame}`}
          />
        </div>
        <p id={statusId} aria-live="polite" className={`mt-4 min-h-10 font-mono text-xs ${muted}`}>
          {message}
        </p>
        <button
          type="button"
          onClick={onCancel}
          className={`mt-2 min-h-12 w-full rounded-full border px-5 font-mono text-xs font-semibold ${close}`}
        >
          enter code instead
        </button>
      </div>
    </div>,
    document.body,
  );
}

export function RoomJoinControl({
  value,
  gamePath,
  tone,
  message,
  onValueChange,
  onJoin,
}: RoomJoinControlProps) {
  const inputId = useId();
  const messageId = useId();
  const [scannerOpen, setScannerOpen] = useState(false);
  const dark = tone === "dark";
  const input = dark
    ? "border-white/20 bg-white/[0.06] text-white placeholder:text-white/30"
    : "border-black/15 bg-white/55 text-black placeholder:text-black/30";
  const camera = dark
    ? "border-white/15 bg-white/[0.08] text-white"
    : "border-black/10 bg-black/[0.06] text-black";
  const join = dark ? "border-white/20 text-white" : "border-black/25 text-black";
  const status = dark ? "text-amber-200" : "text-amber-800";

  return (
    <>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void onJoin(value);
        }}
      >
        <label htmlFor={inputId} className="block font-serif text-3xl font-semibold">
          Room code
        </label>
        <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]">
          <div className="relative min-w-0">
            <input
              id={inputId}
              name="roomCode"
              value={value}
              maxLength={7}
              minLength={7}
              pattern="[A-Z2-9]{7}"
              required
              title="Enter the 7-character room code"
              autoCapitalize="characters"
              autoComplete="off"
              enterKeyHint="go"
              spellCheck={false}
              placeholder="ROOM CODE"
              aria-describedby={message ? messageId : undefined}
              onChange={(event) => onValueChange(normalizeRoomCode(event.target.value))}
              className={`min-h-14 w-full rounded-full border py-3 pl-5 pr-16 text-center font-mono text-base uppercase tracking-[0.16em] ${input}`}
            />
            <button
              type="button"
              onClick={() => setScannerOpen(true)}
              aria-label="Scan room QR code"
              className={`absolute right-1 top-1 flex size-12 items-center justify-center rounded-full border ${camera}`}
            >
              <CameraIcon />
            </button>
          </div>
          <button
            type="submit"
            disabled={!ROOM_CODE_PATTERN.test(value)}
            className={`min-h-14 rounded-full border px-6 font-mono text-xs font-semibold uppercase tracking-[0.12em] disabled:opacity-35 ${join}`}
          >
            join room
          </button>
        </div>
        <p id={messageId} aria-live="polite" className={`mt-3 min-h-5 font-mono text-xs ${status}`}>
          {message}
        </p>
      </form>
      {scannerOpen ? (
        <RoomQrScanner
          gamePath={gamePath}
          tone={tone}
          onCancel={() => setScannerOpen(false)}
          onScan={(roomCode) => {
            onValueChange(roomCode);
            void onJoin(roomCode);
          }}
        />
      ) : null}
    </>
  );
}
