import type { ReactNode } from "react";
import { useState } from "react";
import { AppImage } from "@/components/AppImage";
import { useNativeShareAvailability } from "@/hooks/useNativeShareAvailability";
import { useQrCode } from "@/hooks/useQrCode";
import { shareOrCopy } from "@/lib/client/share";
import { PlayerReadyControl } from "./PlayerReadyControl";
import type { PixelWorldPlayer } from "./pixel-world";
import "./PixelWorld.css";

export function LobbyIntro({
  title,
  description,
  rules,
  tone = "dark",
}: {
  title: string;
  description: ReactNode;
  rules?: ReactNode;
  tone?: "light" | "dark";
}) {
  const muted = tone === "light" ? "text-black/55" : "text-white/55";
  const faint = tone === "light" ? "text-black/40" : "text-white/40";
  const border = tone === "light" ? "border-black/15" : "border-white/15";

  return (
    <div>
      <h1 className="font-serif text-4xl font-semibold leading-[1.02] sm:text-5xl">{title}</h1>
      <p className={`mt-4 max-w-md font-serif text-lg leading-relaxed ${muted}`}>{description}</p>
      {rules ? (
        <details className={`mt-5 border-y py-3 ${border}`}>
          <summary className={`min-h-11 cursor-pointer font-mono text-xs ${faint}`}>
            how it works
          </summary>
          <div className={`pt-2 font-serif text-base leading-relaxed ${muted}`}>{rules}</div>
        </details>
      ) : null}
    </div>
  );
}

export function RoomAdmissionControl({
  locked,
  canChange = false,
  onChange,
  tone = "dark",
}: {
  locked: boolean;
  canChange?: boolean;
  onChange?: (locked: boolean) => void;
  tone?: "light" | "dark" | "theme";
}) {
  const muted =
    tone === "theme" ? "theme-muted" : tone === "light" ? "text-black/50" : "text-white/50";
  const faint =
    tone === "theme" ? "theme-faint" : tone === "light" ? "text-black/35" : "text-white/35";
  const label = locked ? "room locked" : "room open";
  const consequence = locked ? "allow new joins" : "stop new joins";

  if (!canChange || !onChange) {
    return (
      <p className={`mb-2 inline-flex min-h-8 items-center gap-2 font-mono text-micro ${faint}`}>
        <RoomAdmissionIcon locked={locked} />
        {label}
      </p>
    );
  }

  return (
    <button
      type="button"
      aria-pressed={locked}
      aria-label={`Room is ${locked ? "locked" : "open"}. ${locked ? "Allow new joins." : "Stop new joins."}`}
      onClick={() => onChange(!locked)}
      className={`mb-2 inline-flex min-h-11 items-center gap-2 px-2 font-mono text-micro transition-opacity hover:opacity-70 ${muted}`}
    >
      <RoomAdmissionIcon locked={locked} />
      <span>{label}</span>
      <span className={faint}>· {consequence}</span>
    </button>
  );
}

function RoomAdmissionIcon({ locked }: { locked: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3.25" y="7" width="9.5" height="6.5" rx="1.75" />
      <path d={locked ? "M5.25 7V5a2.75 2.75 0 0 1 5.5 0v2" : "M10.75 7V5a2.75 2.75 0 0 0-5.5 0"} />
    </svg>
  );
}

export function MultiplayerLobby({
  admissionLocked,
  actions,
  canSetAdmission = false,
  canPassLead = false,
  currentPlayerId,
  inviteLabel = "room code",
  inviteText,
  inviteTitle,
  inviteUrl,
  onPassLead,
  onAdmissionChange,
  onReadyChange,
  onRename,
  players,
  roomId,
  settings,
  tone = "dark",
  ready,
}: {
  admissionLocked?: boolean;
  actions?: ReactNode;
  canSetAdmission?: boolean;
  canPassLead?: boolean;
  currentPlayerId: string | null;
  inviteLabel?: string;
  inviteText?: string;
  inviteTitle?: string;
  inviteUrl?: string | null;
  onPassLead?: (playerId: string) => void;
  onAdmissionChange?: (locked: boolean) => void;
  onReadyChange?: (ready: boolean) => void;
  onRename?: () => void;
  players: PixelWorldPlayer[];
  roomId: string;
  settings?: ReactNode;
  tone?: "light" | "dark";
  ready?: boolean;
}) {
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const { dataUrl: qr, failed: qrFailed } = useQrCode(inviteUrl ?? null, 320);
  const nativeShare = useNativeShareAvailability({ coarsePointerOnly: true });
  const light = tone === "light";
  const muted = light ? "text-black/50" : "text-white/50";
  const faint = light ? "text-black/40" : "text-white/40";
  const border = light ? "border-black/15" : "border-white/15";
  const buttonBorder = light ? "border-black/20" : "border-white/20";

  const shareInvite = async () => {
    if (!inviteUrl) return;
    const result = await shareOrCopy(
      {
        title: inviteTitle ?? "Join this room",
        text: inviteText ?? `Join room ${roomId}.`,
        url: inviteUrl,
      },
      { useNativeShare: nativeShare, copyValue: inviteUrl },
    );
    setShareMessage(
      result === "shared"
        ? "invite shared"
        : result === "copied"
          ? "invite copied"
          : result === "failed"
            ? "copy the invite link or read the room code out"
            : null,
    );
  };

  const present = players.filter(({ left }) => !left);
  const ordered = [...present].sort((left, right) => {
    if (left.id === currentPlayerId) return -1;
    if (right.id === currentPlayerId) return 1;
    return 0;
  });

  return (
    <section className="mt-6 w-full text-left" aria-label="Room lobby">
      {inviteUrl ? (
        <details
          open={present.length <= 1 ? true : undefined}
          className={`overflow-hidden rounded-3xl border ${border}`}
        >
          <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 px-5 py-3 [&::-webkit-details-marker]:hidden">
            <span>
              <span className={`block font-mono text-micro uppercase tracking-[0.18em] ${faint}`}>
                {inviteLabel}
              </span>
              <span
                className={`mt-1 block font-mono text-xl font-bold tracking-[0.18em] ${light ? "text-black" : "text-[var(--things-amber)]"}`}
              >
                {roomId}
              </span>
            </span>
            <span className={`font-mono text-xs ${muted}`}>invite people ↓</span>
          </summary>
          <div className={`border-t px-5 pb-5 pt-4 text-center ${border}`}>
            {admissionLocked !== undefined ? (
              <RoomAdmissionControl
                locked={admissionLocked}
                canChange={canSetAdmission}
                onChange={onAdmissionChange}
                tone={tone}
              />
            ) : null}
            {qr ? (
              <AppImage
                src={qr}
                alt={`QR code to join room ${roomId}`}
                width={320}
                height={320}
                className="mx-auto w-52 rounded-3xl bg-white p-3"
              />
            ) : qrFailed ? (
              <p className={`font-mono text-xs ${muted}`}>
                QR unavailable — share the link or read the room code out.
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => void shareInvite()}
              className={`mt-4 min-h-12 rounded-full border px-6 font-mono text-xs ${buttonBorder}`}
            >
              {nativeShare ? "share invite" : "copy invite link"}
            </button>
            <p aria-live="polite" className={`mt-2 min-h-5 font-mono text-xs ${muted}`}>
              {shareMessage}
            </p>
          </div>
        </details>
      ) : null}

      {ready !== undefined && onReadyChange ? (
        <PlayerReadyControl ready={ready} onChange={onReadyChange} tone={tone} />
      ) : null}

      <div className="multiplayer-lobby-panel">
        <h2 className="multiplayer-lobby-panel-heading">who is here · {present.length}</h2>
        <ul className="multiplayer-lobby-roster" aria-label="Players in the room">
          {ordered.map((player) => (
            <li key={player.id}>
              <span>
                {player.name ?? "guest"}
                {player.id === currentPlayerId ? " · you" : ""}
                {player.lead ? " · room lead" : ""}
              </span>
              <span>{player.ready ? "ready" : "not ready"}</span>
              {canPassLead && !player.lead && onPassLead ? (
                <button type="button" onClick={() => onPassLead(player.id)}>
                  make lead
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        {onRename ? (
          <button type="button" className="multiplayer-lobby-rename" onClick={onRename}>
            change my name
          </button>
        ) : null}
      </div>

      {settings ? (
        <details className={`mt-6 border-y py-2 ${border}`}>
          <summary
            className={`flex min-h-11 cursor-pointer items-center font-mono text-xs ${muted}`}
          >
            room options
          </summary>
          <div className="pb-3 pt-2">{settings}</div>
        </details>
      ) : null}

      {actions ? <div className="mt-6">{actions}</div> : null}
    </section>
  );
}
