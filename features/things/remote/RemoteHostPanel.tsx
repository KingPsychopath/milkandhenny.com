import { useEffect, useState } from "react";
import QRCode from "qrcode";

interface RemoteHostPanelProps {
  gameLabel: string;
  inviteUrl: string | null;
  roomId: string | null;
  connected: boolean;
  syncing: boolean;
  message: string | null;
  exclusive: boolean;
  onCreate: () => Promise<unknown>;
  onClose: () => Promise<void>;
  onMessage: (message: string | null) => void;
  onToggleExclusive: () => void;
}

export function RemoteHostPanel({
  gameLabel,
  inviteUrl,
  roomId,
  connected,
  syncing,
  message,
  exclusive,
  onCreate,
  onClose,
  onMessage,
  onToggleExclusive,
}: RemoteHostPanelProps) {
  const [qrCode, setQrCode] = useState<string | null>(null);

  useEffect(() => {
    if (!inviteUrl) {
      setQrCode(null);
      return;
    }
    let active = true;
    void QRCode.toDataURL(inviteUrl, { width: 240, margin: 1 }).then((value) => {
      if (active) setQrCode(value);
    });
    return () => {
      active = false;
    };
  }, [inviteUrl]);

  const handleShare = async () => {
    let url = inviteUrl;
    if (!url) {
      const created = await onCreate();
      if (!created || typeof created !== "object" || !("roomId" in created)) return;
      const credentials = created as { roomId: string; judgeToken: string };
      url = `${window.location.origin}/things/judge/${credentials.roomId}#${credentials.judgeToken}`;
    }
    const share = {
      title: `Judge ${gameLabel}`,
      text: `Open this to judge our ${gameLabel} game.`,
      url,
    };
    try {
      if (navigator.share) {
        await navigator.share(share);
        onMessage("Invite shared.");
      } else {
        await navigator.clipboard.writeText(url);
        onMessage("Judge link copied.");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      try {
        await navigator.clipboard.writeText(url);
        onMessage("Judge link copied.");
      } catch {
        onMessage("Could not share—use the QR code instead.");
      }
    }
  };

  return (
    <section className="mt-9 rounded-3xl border border-white/12 bg-white/[0.04] p-5" aria-labelledby="remote-judge-title">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 id="remote-judge-title" className="font-serif text-2xl font-semibold">
            Remote judge
          </h2>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-white/55">
            Optional. Share one link; your game keeps working if either connection drops.
          </p>
        </div>
        {roomId ? (
          <span className={`rounded-full border px-3 py-2 font-mono text-micro uppercase tracking-[0.12em] ${connected ? "border-emerald-300/35 text-emerald-200" : "border-white/15 text-white/45"}`} aria-live="polite">
            {connected ? "● connected" : "○ waiting"}
          </span>
        ) : null}
      </div>

      <button
        type="button"
        onClick={() => void handleShare()}
        disabled={syncing}
        className="mt-5 min-h-12 w-full rounded-full border border-white/20 px-5 font-mono text-sm font-semibold text-white disabled:opacity-40"
      >
        {roomId ? "share judge invite" : syncing ? "making invite…" : "invite a judge"}
      </button>

      {roomId ? (
        <div className="mt-5 grid gap-5 sm:grid-cols-[9rem_1fr] sm:items-center">
          {qrCode ? (
            <img src={qrCode} alt="QR code for the remote judge invite" className="mx-auto w-36 rounded-2xl bg-white p-2" />
          ) : null}
          <div className="text-center sm:text-left">
            <p className="font-mono text-micro uppercase tracking-[0.15em] text-white/40">room</p>
            <p className="mt-1 font-mono text-2xl tracking-[0.18em] text-white/80">{roomId}</p>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 sm:justify-start">
              <a href={inviteUrl ?? undefined} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center font-mono text-xs text-white/60 hover:text-white">
                open judge view
              </a>
              <button type="button" onClick={() => void onClose()} className="min-h-11 font-mono text-xs text-white/45 hover:text-white/70">
                end remote judging
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {roomId ? (
        <label className="mt-4 flex min-h-11 cursor-pointer items-center justify-between gap-4 border-t border-white/10 pt-4 font-mono text-xs text-white/60">
          <span>judge-only controls</span>
          <input type="checkbox" checked={exclusive} onChange={onToggleExclusive} className="h-5 w-5 accent-[var(--things-amber)]" />
        </label>
      ) : null}
      <p aria-live="polite" className="mt-3 min-h-4 font-mono text-xs text-white/50">{message}</p>
    </section>
  );
}

export function RemoteConnectionBadge({ connected }: { connected: boolean }) {
  return (
    <span className="rounded-full border border-black/15 px-2 py-1 font-mono text-[0.6rem] uppercase tracking-[0.12em] text-black/55" aria-label={connected ? "Remote judge connected" : "Remote judge not connected"}>
      {connected ? "● judge" : "○ local"}
    </span>
  );
}
