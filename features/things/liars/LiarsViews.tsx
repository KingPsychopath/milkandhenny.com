import { useEffect, useId, useState } from "react";
import { useQrCode } from "@/hooks/useQrCode";
import { shareOrCopy } from "@/lib/client/share";
import type { ReactNode } from "react";
import {
  LIARS_MODE_COPY,
  LIARS_PLAYER_LIMITS,
  LIARS_ROLES,
  liarsLineupEntries,
  liarsRolesForMode,
  liarsSideCounts,
  liarsSideLabel,
  liarsWrongVoteBudget,
} from "./liars-rules";
import type {
  LiarsLineup,
  LiarsMark,
  LiarsMode,
  LiarsNightReport,
  LiarsPlayerSummary,
  LiarsRole,
  LiarsSnapshot,
} from "./types";
import type { LiarsOverlay } from "./useLiarsEffects";
import { LIARS_NOTE_LENGTH, LIARS_NOTE_LIMIT, type LiarsNote } from "./useLiarsNotes";

const MARK_GLYPH: Record<LiarsMark, { glyph: string; label: string }> = {
  moved: { glyph: "→", label: "seen moving" },
  saved: { glyph: "✚", label: "saved" },
  attacked: { glyph: "✕", label: "attacked" },
  pointed: { glyph: "!", label: "pointed at" },
};

export function LiarsOverlayLayer({ overlay }: { overlay: LiarsOverlay }) {
  if (overlay === "none") return null;
  return <div className={`liars-overlay liars-overlay--${overlay}`} aria-hidden="true" />;
}

/** Accessible countdown: the bar is decoration, the text is the information. */
export function PhaseTimer({
  endsAt,
  clockOffset,
  label,
  hidden,
}: {
  endsAt: number;
  clockOffset: number;
  label: string;
  /** The clue phase has a failsafe deadline that must never be shown as a countdown. */
  hidden?: boolean;
}) {
  const [now, setNow] = useState(() => Date.now() + clockOffset);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now() + clockOffset), 250);
    return () => window.clearInterval(timer);
  }, [clockOffset]);

  const remaining = Math.max(0, endsAt - now);
  const seconds = Math.ceil(remaining / 1_000);
  if (hidden) return null;

  return (
    <p className="font-mono text-micro uppercase tracking-[0.18em] text-white/45" aria-live="off">
      <span className="sr-only">{label}: </span>
      {label} · {String(Math.floor(seconds / 60)).padStart(2, "0")}:
      {String(seconds % 60).padStart(2, "0")}
    </p>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <p className="font-mono text-micro uppercase tracking-[0.2em] text-white/40">{children}</p>
  );
}

export function Headline({ children }: { children: ReactNode }) {
  return (
    <h1 className="mt-3 font-serif text-4xl font-semibold leading-[1.02] tracking-tight sm:text-5xl">
      {children}
    </h1>
  );
}

function MarkRow({ marks }: { marks: LiarsMark[] }) {
  if (marks.length === 0) return null;
  return (
    <span className="font-mono text-xs text-white/50">
      {marks.map((mark) => (
        <span key={mark} className="ml-1.5" title={MARK_GLYPH[mark].label}>
          <span aria-hidden="true">{MARK_GLYPH[mark].glyph}</span>
          <span className="sr-only">{MARK_GLYPH[mark].label}</span>
        </span>
      ))}
    </span>
  );
}

/**
 * A living player's role is never printed on the roster, not even their own. The deal card is
 * hold-to-reveal precisely so a glance across the room gets nothing, and a permanent amber label
 * beside your name would hand back everything that bought.
 */
function showRole(snapshot: LiarsSnapshot, player: LiarsPlayerSummary) {
  if (!player.role) return false;
  return snapshot.phase === "ending" || !player.alive;
}

/**
 * One roster, used everywhere. Rows carry only what is true this round — a running history would
 * be confetti by round four — and everything older sits one tap away.
 */
export function PlayerList({
  snapshot,
  selectedId,
  selectableIds,
  onSelect,
  emptyLabel,
}: {
  snapshot: LiarsSnapshot;
  selectedId?: string | null;
  selectableIds?: string[];
  onSelect?: (playerId: string) => void;
  emptyLabel?: string;
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const alive = snapshot.players.filter(({ alive: isAlive }) => isAlive);
  const gone = snapshot.players.filter(({ alive: isAlive }) => !isAlive);
  // Teammates are marked with a dot rather than a word, and only at night, when heads are down.
  const allyIds = snapshot.phase === "night" ? (snapshot.player?.allyIds ?? []) : [];

  const row = (player: LiarsPlayerSummary) => {
    const selectable = selectableIds?.includes(player.id) ?? false;
    const selected = selectedId === player.id;
    const expanded = expandedId === player.id;
    const history = snapshot.history.filter((entry) => entry.text.includes(player.name));

    return (
      <li key={player.id} className="border-t border-white/10 first:border-t-0">
        <div className="flex items-stretch">
          <button
            type="button"
            disabled={!selectable}
            aria-pressed={selectable ? selected : undefined}
            onClick={() => selectable && onSelect?.(player.id)}
            className={`flex min-h-14 flex-1 items-center gap-3 pr-2 text-left transition-opacity disabled:cursor-default ${
              player.alive ? "" : "opacity-35"
            } ${selectable ? "hover:opacity-80" : ""}`}
          >
            <span
              aria-hidden="true"
              className={`h-9 w-0.5 shrink-0 rounded-full transition-colors ${
                selected ? "bg-[var(--things-amber)]" : "bg-transparent"
              }`}
            />
            <span
              className={`font-serif text-lg ${player.alive ? "" : "line-through decoration-white/40"}`}
            >
              {player.name}
            </span>
            {showRole(snapshot, player) ? (
              <span className="font-mono text-micro uppercase tracking-[0.14em] text-[var(--things-amber)]">
                {LIARS_ROLES[player.role!].name}
              </span>
            ) : null}
            {allyIds.includes(player.id) ? (
              <span
                className="size-1.5 shrink-0 rounded-full bg-[var(--liars-dead)]"
                title="with you"
                aria-label="with you"
              />
            ) : null}
            {snapshot.phase === "lobby" && !player.ready ? (
              <span className="font-mono text-micro uppercase tracking-[0.14em] text-[var(--things-amber)]">
                not ready
              </span>
            ) : null}
            {!player.connected && player.alive ? (
              <span
                className="size-1.5 rounded-full border border-white/40"
                title="not connected"
                aria-label="not connected"
              />
            ) : null}
            <span className="ml-auto flex items-center gap-2">
              {player.votes !== undefined && player.votes > 0 ? (
                <span className="font-mono text-xs text-white/55">{player.votes}</span>
              ) : null}
              {player.savedCount > 0 ? (
                <span className="font-mono text-xs text-white/50" title="saved">
                  <span aria-hidden="true">✚</span>
                  <sup>{player.savedCount}</sup>
                  <span className="sr-only">saved {player.savedCount} times</span>
                </span>
              ) : null}
              <MarkRow marks={player.marks} />
              {!player.alive ? (
                <span className="font-mono text-xs text-[var(--liars-dead)]">
                  <span aria-hidden="true">✕</span>
                  <span className="sr-only">out</span>
                </span>
              ) : null}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setExpandedId(expanded ? null : player.id)}
            aria-expanded={expanded}
            className="min-h-14 px-3 font-mono text-xs text-white/35 hover:text-white/70"
          >
            <span aria-hidden="true">{expanded ? "−" : "+"}</span>
            <span className="sr-only">history for {player.name}</span>
          </button>
        </div>
        {expanded ? (
          <ul className="border-t border-white/10 pb-3 pl-3.5 pt-2 font-mono text-xs text-white/50">
            {history.length === 0 ? (
              <li className="py-1">nothing on the record</li>
            ) : (
              history.map((entry, index) => (
                <li key={index} className="py-1">
                  <span className="text-white/30">
                    {entry.phase} {entry.round}
                  </span>{" "}
                  {entry.text}
                </li>
              ))
            )}
          </ul>
        ) : null}
      </li>
    );
  };

  return (
    <div>
      {alive.length === 0 ? (
        <p className="py-6 font-mono text-xs text-white/40">{emptyLabel ?? "nobody left"}</p>
      ) : (
        <ul>{alive.map(row)}</ul>
      )}
      {gone.length > 0 ? (
        <>
          <p className="mt-6 border-t border-white/10 pt-3 font-mono text-micro uppercase tracking-[0.18em] text-white/30">
            gone
          </p>
          <ul>{gone.map(row)}</ul>
        </>
      ) : null}
    </div>
  );
}

/** Public from the moment the room opens. Nobody can deduce without knowing what is possible. */
export function LineupBoard({
  mode,
  lineup,
  playerCount,
}: {
  mode: LiarsMode;
  lineup: LiarsLineup;
  /** The real roster size. Below the mode's minimum the board says so rather than implying a deal. */
  playerCount: number;
}) {
  const shortBy = LIARS_PLAYER_LIMITS[mode].min - playerCount;
  const [openRole, setOpenRole] = useState<LiarsRole | null>(null);
  const sides = liarsSideCounts(lineup);
  const budget = liarsWrongVoteBudget(lineup);
  const entries = liarsLineupEntries(lineup).toSorted(
    (left, right) =>
      Number(LIARS_ROLES[right[0]].side === "mafia") - Number(LIARS_ROLES[left[0]].side === "mafia"),
  );

  return (
    <section aria-label="roles in this game">
      <ul>
        {entries.map(([role, count]) => {
          const definition = LIARS_ROLES[role];
          const open = openRole === role;
          return (
            <li key={role} className="border-t border-white/10">
              <button
                type="button"
                onClick={() => setOpenRole(open ? null : role)}
                aria-expanded={open}
                className="flex min-h-12 w-full items-center gap-3 text-left"
              >
                <span
                  aria-hidden="true"
                  className={`size-1.5 shrink-0 rounded-full ${
                    definition.side === "mafia"
                      ? "bg-[var(--liars-dead)]"
                      : definition.side === "third"
                        ? "bg-[var(--things-amber)]"
                        : "bg-white/30"
                  }`}
                />
                <span className="font-serif text-base">{definition.name}</span>
                {count > 1 ? (
                  <span className="font-mono text-xs text-white/45">×{count}</span>
                ) : null}
                <span className="ml-auto font-mono text-xs text-white/30">{open ? "−" : "+"}</span>
              </button>
              {open ? (
                <div className="pb-4 pl-5 pr-2">
                  <p className="font-serif text-sm text-white/70">{definition.summary}</p>
                  <ul className="mt-2 space-y-1.5 font-mono text-xs leading-relaxed text-white/45">
                    {definition.rules.map((rule, index) => (
                      <li key={index}>{rule}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="mt-4 border-t border-white/10 pt-3 font-mono text-xs text-white/50">
        {sides.mafia} {liarsSideLabel(mode, "mafia", sides.mafia)} · {sides.town}{" "}
        {liarsSideLabel(mode, "town", sides.town)}
        {sides.third > 0 ? ` · ${sides.third} ${liarsSideLabel(mode, "third", sides.third)}` : ""} ·{" "}
        {playerCount === 1 ? "1 player" : `${playerCount} players`}
      </p>
      {shortBy > 0 ? (
        <p className="mt-1 font-mono text-xs text-[var(--things-amber)]">
          this is the lineup at {LIARS_PLAYER_LIMITS[mode].min} · {shortBy} more to go
        </p>
      ) : mode === "mafia" ? (
        <p className="mt-1 font-mono text-xs text-[var(--things-amber)]">
          the town can afford {budget} wrong {budget === 1 ? "vote" : "votes"}
        </p>
      ) : null}
    </section>
  );
}

/** The rules sheet, deep-linked to your own role. Reads from the same table the engine enforces. */
export function RulesSheet({ mode, yourRole }: { mode: LiarsMode; yourRole?: LiarsRole }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const roles = liarsRolesForMode(mode);

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={panelId}
        className="min-h-11 font-mono text-xs text-white/45 hover:text-white/80"
      >
        rules
      </button>
      {open ? (
        <div id={panelId} className="mt-3 border-t border-white/10 pt-4">
          <p className="font-serif text-sm text-white/70">{LIARS_MODE_COPY[mode].tagline}</p>
          <ul className="mt-4">
            {roles.map((role) => (
              <li key={role.id} className="border-t border-white/10 py-3">
                <p className="font-serif text-base">
                  {role.name}
                  {role.id === yourRole ? (
                    <span className="ml-2 font-mono text-micro uppercase tracking-[0.14em] text-[var(--things-amber)]">
                      you
                    </span>
                  ) : null}
                </p>
                <p className="mt-1 font-mono text-xs text-white/45">{role.summary}</p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The T−10s card. Identical shape for every role — a name and one line — so that from across a
 * room a detective's card and a villager's card are the same object.
 */
export function NightReportCard({ report }: { report: LiarsNightReport }) {
  return (
    <div className="mt-8 border-y border-white/15 py-6" aria-live="assertive">
      <p className="font-mono text-micro uppercase tracking-[0.2em] text-white/35">
        {report.subjectName ?? "—"}
      </p>
      <p className="mt-2 flex items-center gap-2 font-serif text-2xl">
        {report.glyph ? (
          <span
            aria-hidden="true"
            className="animate-pulse font-mono text-[var(--things-amber)]"
          >
            {report.glyph === "moved" ? "→" : "·"}
          </span>
        ) : null}
        {report.line}
      </p>
    </div>
  );
}

/** Your private record, so nobody is straining to recall night one on night four. */
export function KnowledgeList({ snapshot }: { snapshot: LiarsSnapshot }) {
  const [open, setOpen] = useState(false);
  const entries = snapshot.player?.knowledge ?? [];

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="min-h-11 font-mono text-xs text-white/45 hover:text-white/80"
      >
        what you know{entries.length > 0 ? ` · ${entries.length}` : ""}
      </button>
      {open ? (
        <ul className="mt-2 border-t border-white/10 pt-2 font-mono text-xs text-white/55">
          {entries.length === 0 ? (
            <li className="py-1.5 text-white/35">nothing yet</li>
          ) : (
            entries.map((entry, index) => (
              <li key={index} className="flex gap-3 py-1.5">
                <span className="w-14 shrink-0 text-white/30">night {entry.round}</span>
                <span className="w-24 shrink-0 uppercase tracking-[0.1em]">
                  {entry.subjectName ?? "—"}
                </span>
                <span>{entry.text}</span>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}

export function ActionButton({
  children,
  onClick,
  disabled,
  tone = "amber",
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  tone?: "amber" | "ghost";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`min-h-14 w-full rounded-full px-6 font-mono text-sm font-bold transition-transform hover:scale-[1.01] disabled:scale-100 disabled:opacity-35 ${
        tone === "amber"
          ? "bg-[var(--things-amber)] text-black"
          : "border border-white/20 text-white/80"
      }`}
    >
      {children}
    </button>
  );
}


/**
 * The notepad. Deliberately separate from "what you know": that list is what your role was told,
 * this one is what you reckon. Capped at forty lines because a phone is not a case file, and
 * because the cap is what makes the last line worth choosing carefully — it becomes your epitaph.
 */
export function NotesPad({
  notes,
  round,
  full,
  onAdd,
  onRemove,
}: {
  notes: LiarsNote[];
  round: number;
  full: boolean;
  onAdd: (text: string, round: number) => void;
  onRemove: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="min-h-11 font-mono text-xs text-white/45 hover:text-white/80"
      >
        notes{notes.length > 0 ? ` · ${notes.length}` : ""}
      </button>
      {open ? (
        <div className="mt-2 border-t border-white/10 pt-2">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              onAdd(draft, round);
              setDraft("");
            }}
          >
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              maxLength={LIARS_NOTE_LENGTH}
              placeholder={full ? "notebook full — delete a line first" : "maya went quiet…"}
              disabled={full}
              autoComplete="off"
              className="min-h-11 w-full border-b border-white/20 bg-transparent font-serif text-base text-white outline-none placeholder:text-white/25 focus-visible:border-[var(--things-amber)] disabled:opacity-40"
            />
          </form>
          <p className="mt-1 font-mono text-micro text-white/25">
            only on this phone · {notes.length} of {LIARS_NOTE_LIMIT}
          </p>
          <ul className="mt-2 font-mono text-xs text-white/55">
            {notes.toReversed().map((note) => (
              <li key={note.id} className="flex items-baseline gap-2 py-1">
                <span className="w-12 shrink-0 text-white/25">n{note.round}</span>
                <span className="flex-1">{note.text}</span>
                <button
                  type="button"
                  onClick={() => onRemove(note.id)}
                  className="min-h-8 px-1 text-white/25 hover:text-white/60"
                  aria-label={`delete note: ${note.text}`}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}


/**
 * The lobby's whole job: get everyone else into this room.
 *
 * A code you have to read out letter by letter across a noisy room is the slowest possible way to
 * do that, so the QR comes first and is big enough to hold up, the code sits under it at a size you
 * can read from across a table, and the share sheet handles anybody who is not in the room at all.
 */
export function InvitePanel({ roomId, inviteUrl }: { roomId: string; inviteUrl: string }) {
  const { dataUrl: qr, failed } = useQrCode(inviteUrl || null, 320);
  const [shareMessage, setShareMessage] = useState<string | null>(null);

  const share = async () => {
    const result = await shareOrCopy(
      { title: "Liars", text: `Join room ${roomId}.`, url: inviteUrl },
      { copyValue: inviteUrl },
    );
    setShareMessage(
      result === "copied"
        ? "invite copied"
        : result === "shared"
          ? "invite shared"
          : result === "failed"
            ? "read the code out instead"
            : null,
    );
  };

  return (
    <section className="flex flex-col items-center text-center" aria-label="invite">
      {qr ? (
        <img
          src={qr}
          alt={`QR code to join room ${roomId}`}
          className="w-56 rounded-3xl bg-white p-3"
        />
      ) : null}
      {failed ? (
        <p className="font-mono text-xs text-white/45">QR unavailable — use the code.</p>
      ) : null}
      <p className="mt-5 font-mono text-micro uppercase tracking-[0.18em] text-white/40">
        room code
      </p>
      <p className="mt-1 font-mono text-4xl font-bold tracking-[0.22em] text-[var(--things-amber)]">
        {roomId}
      </p>
      <button
        type="button"
        onClick={() => void share()}
        className="mt-5 min-h-11 rounded-full border border-white/25 px-6 font-mono text-xs text-white/80 hover:border-[var(--things-amber)] hover:text-[var(--things-amber)]"
      >
        share the link
      </button>
      <p aria-live="polite" className="mt-2 min-h-5 font-mono text-xs text-[var(--things-amber)]">
        {shareMessage ?? ""}
      </p>
    </section>
  );
}
