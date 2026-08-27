"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { BinaryFiles } from "@excalidraw/excalidraw/types";
import { Link } from "@tanstack/react-router";

import type {
  PitchAsset,
  PitchDeckAdminSummary,
  PitchDocument,
  PitchOperationalMode,
  PitchOperationalStatus,
} from "@/features/things/pitches/types";
import { isPitchOperationalMode } from "@/features/things/pitches/types";
import { loadPitchFiles } from "@/features/things/pitches/ui/files.client";
import { PitchSlideThumbnail } from "@/features/things/pitches/ui/PitchSlideThumbnail";
import { useActionDialog } from "@/hooks/useActionDialog";
import { PitchRemindersPanel } from "./PitchRemindersPanel";
import { AppSelect } from "@/components/AppSelect";

type AuthFetch = (url: string, options?: RequestInit) => Promise<Response>;

type PitchDetail = {
  pitch: {
    id: string;
    title: string;
    ownerName: string;
    ownerEmail: string;
    lifecycle: "active" | "archived" | "trashed" | "deleting";
    draftDocument: PitchDocument;
    draftVersion: number;
    draftExpiresAt: string;
    publishedAt?: string;
    updatedAt: string;
    trashedAt?: string;
    purgeAfter?: string;
  };
  assets: PitchAsset[];
  backups: Array<{
    id: string;
    version: number;
    reason: "autosave" | "safety" | "conflict" | "publish" | "restore";
    createdAt: string;
    title: string;
  }>;
  editions: Array<{
    editionNumber: number;
    draftVersion: number;
    title: string;
    publishedAt: string;
  }>;
  audit: Array<{
    id: string;
    action: string;
    actor: string;
    metadata: Record<string, unknown>;
    createdAt: string;
  }>;
};

function bytes(value: number): string {
  if (value < 1_024) return `${value} B`;
  if (value < 1_024 * 1_024) return `${Math.round(value / 1_024)} KB`;
  return `${(value / (1_024 * 1_024)).toFixed(1)} MB`;
}

function when(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function describeTrash(
  pitch: PitchDetail["pitch"],
  audit: PitchDetail["audit"],
): {
  summary: string;
  movedBy: string;
  movedAt?: string;
} {
  const event = audit.find(
    (entry) => entry.action === "deck.trashed" || entry.action === "deck.expired",
  );
  if (event?.action === "deck.expired") {
    return {
      summary: "The draft expired, so the studio moved it to Trash automatically.",
      movedBy: "studio automation",
      movedAt: event.createdAt,
    };
  }
  if (event?.action === "deck.trashed") {
    return {
      summary:
        event.actor === "admin"
          ? "An admin moved this pitch to Trash. Owners cannot move pitches to Trash themselves."
          : `This pitch was moved to Trash by ${event.actor}.`,
      movedBy: event.actor,
      movedAt: event.createdAt,
    };
  }
  return {
    summary: "This pitch is in Trash, but the original reason is not recorded.",
    movedBy: "not recorded",
    movedAt: pitch.trashedAt,
  };
}

export function PitchesPanel({
  authFetch,
  onError,
  onStatus,
  ensureStepUpToken,
  withStepUpHeaders,
}: {
  authFetch: AuthFetch;
  onError: (message: string) => void;
  onStatus: (message: string) => void;
  ensureStepUpToken: () => Promise<
    { ok: true; token: string } | { ok: false; cancelled?: true; error?: string }
  >;
  withStepUpHeaders: (token: string, headers?: Record<string, string>) => Record<string, string>;
}) {
  const [pitches, setPitches] = useState<PitchDeckAdminSummary[]>([]);
  const [detail, setDetail] = useState<PitchDetail>();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "draft" | "published" | "archived" | "trash">("all");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [detailFiles, setDetailFiles] = useState<BinaryFiles>({});
  const [form, setForm] = useState({ title: "", ownerName: "", ownerEmail: "" });
  const [lifecycleDraft, setLifecycleDraft] = useState<"active" | "archived" | "trashed">("active");
  const [publicationDraft, setPublicationDraft] = useState<"draft" | "published">("draft");
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [operationalStatus, setOperationalStatus] = useState<PitchOperationalStatus>();
  const [modeDraft, setModeDraft] = useState<PitchOperationalMode>("enabled");
  const { confirm, dialog } = useActionDialog();

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await authFetch("/api/admin/pitches");
      if (!response.ok) throw new Error("Could not load pitches");
      const body = (await response.json()) as {
        pitches?: PitchDeckAdminSummary[];
        operationalStatus?: PitchOperationalStatus;
      };
      setPitches(body.pitches ?? []);
      if (body.operationalStatus) {
        setOperationalStatus(body.operationalStatus);
        setModeDraft(body.operationalStatus.adminMode);
      }
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not load pitches");
    } finally {
      setLoading(false);
    }
  }, [authFetch, onError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return pitches.filter((pitch) => {
      if (filter === "draft" && pitch.publishedAt) return false;
      if (filter === "published" && !pitch.publishedAt) return false;
      if (filter === "archived" && pitch.lifecycle !== "archived") return false;
      if (filter === "trash" && pitch.lifecycle !== "trashed") return false;
      if (filter !== "trash" && pitch.lifecycle === "trashed") return false;
      if (filter !== "archived" && filter !== "all" && pitch.lifecycle === "archived") return false;
      return (
        !term ||
        pitch.title.toLowerCase().includes(term) ||
        pitch.ownerName.toLowerCase().includes(term) ||
        pitch.ownerEmail.toLowerCase().includes(term)
      );
    });
  }, [filter, pitches, query]);

  async function open(pitch: PitchDeckAdminSummary) {
    setBusy(pitch.id);
    try {
      const response = await authFetch(`/api/admin/pitches?deckId=${encodeURIComponent(pitch.id)}`);
      if (!response.ok) throw new Error("Could not open pitch");
      const next = (await response.json()) as PitchDetail;
      setDetail(next);
      setForm({
        title: next.pitch.title,
        ownerName: next.pitch.ownerName,
        ownerEmail: next.pitch.ownerEmail,
      });
      if (next.pitch.lifecycle !== "deleting") setLifecycleDraft(next.pitch.lifecycle);
      setPublicationDraft(next.pitch.publishedAt ? "published" : "draft");
      setDeleteConfirmation("");
      setDetailFiles({});
      void loadPitchFiles(next.assets)
        .then(setDetailFiles)
        .catch(() => setDetailFiles({}));
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not open pitch");
    } finally {
      setBusy("");
    }
  }

  async function archive(pitch: PitchDeckAdminSummary) {
    const archived = pitch.lifecycle !== "archived";
    setBusy(pitch.id);
    try {
      const response = await authFetch("/api/admin/pitches", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "archive", deckId: pitch.id, archived }),
      });
      if (!response.ok) throw new Error("Could not update pitch");
      onStatus(archived ? "Pitch hidden from the wall." : "Pitch restored.");
      setDetail(undefined);
      await refresh();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not update pitch");
    } finally {
      setBusy("");
    }
  }

  async function restoreTrash(deckId: string) {
    setBusy(deckId);
    try {
      const response = await authFetch("/api/admin/pitches", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore-trash", deckId }),
      });
      if (!response.ok) throw new Error("Could not restore pitch from Trash");
      onStatus("Pitch restored from Trash.");
      setDetail(undefined);
      await refresh();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not restore pitch from Trash");
    } finally {
      setBusy("");
    }
  }

  async function updateDetail(action: string, extra: Record<string, unknown> = {}) {
    if (!detail) return false;
    const ownerChanged =
      action === "update" &&
      form.ownerEmail.trim().toLowerCase() !== detail.pitch.ownerEmail.trim().toLowerCase();
    setBusy(action);
    try {
      const response = await authFetch("/api/admin/pitches", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, deckId: detail.pitch.id, ...extra }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not update pitch");
      onStatus(
        action === "resend-access"
          ? "A fresh private editing link was sent."
          : action === "restore-backup"
            ? "Backup restored as a new working version."
            : ownerChanged
              ? "Owner changed. Earlier private links were revoked; send the new owner a fresh one."
              : "Pitch details updated.",
      );
      const summary = pitches.find((pitch) => pitch.id === detail.pitch.id);
      if (summary) await open(summary);
      await refresh();
      return true;
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not update pitch");
      return false;
    } finally {
      setBusy("");
    }
  }

  async function updateLifecycle() {
    if (!detail || detail.pitch.lifecycle === "deleting") return;
    const changed = await updateDetail("set-lifecycle", { lifecycle: lifecycleDraft });
    if (changed) {
      onStatus(
        lifecycleDraft === "active"
          ? "Pitch moved to active."
          : lifecycleDraft === "archived"
            ? "Pitch moved to archive."
            : "Pitch moved to Trash and will remain recoverable for 30 days.",
      );
    }
  }

  async function updatePublication() {
    if (!detail) return;
    const changed = await updateDetail("set-publication", { publication: publicationDraft });
    if (changed) {
      onStatus(
        publicationDraft === "published"
          ? "The current working copy was sealed as a new public edition."
          : "Pitch returned to draft. Earlier sealed editions remain in its history.",
      );
    }
  }

  async function deletePitch() {
    if (!detail || deleteConfirmation !== detail.pitch.title) return;
    setBusy("delete");
    try {
      const stepUp = await ensureStepUpToken();
      if (!stepUp.ok) {
        if (!stepUp.cancelled) onError(stepUp.error ?? "Step-up verification failed");
        return;
      }
      const response = await authFetch("/api/admin/pitches", {
        method: "DELETE",
        headers: withStepUpHeaders(stepUp.token, { "Content-Type": "application/json" }),
        body: JSON.stringify({
          deckId: detail.pitch.id,
          confirmation: deleteConfirmation,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Could not delete pitch");
      setDetail(undefined);
      setDeleteConfirmation("");
      onStatus("Pitch moved to Trash. It can be restored for 30 days.");
      await refresh();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not delete pitch");
    } finally {
      setBusy("");
    }
  }

  async function updateOperationalMode() {
    if (modeDraft === "off" && operationalStatus?.effectiveMode !== "off") {
      const confirmed = await confirm({
        eyebrow: "pitch night studio",
        title: "Turn the studio off?",
        description:
          "Public decks and live presentation controls will stop until you enable it again.",
        confirmLabel: "turn it off",
        intent: "danger",
      });
      if (!confirmed) return;
    }
    setBusy("operational-mode");
    try {
      const response = await authFetch("/api/admin/pitches", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set-operational-mode", mode: modeDraft }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        operationalStatus?: PitchOperationalStatus;
      };
      if (!response.ok || !body.operationalStatus) {
        throw new Error(body.error ?? "Could not change the studio mode");
      }
      setOperationalStatus(body.operationalStatus);
      setModeDraft(body.operationalStatus.adminMode);
      onStatus(
        body.operationalStatus.effectiveMode === "enabled"
          ? "Pitch Night Studio is fully enabled."
          : body.operationalStatus.effectiveMode === "read-only"
            ? "Pitch Night Studio is read-only. Server saving and uploads are paused."
            : "Pitch Night Studio is off. Public and live access are paused.",
      );
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not change the studio mode");
    } finally {
      setBusy("");
    }
  }

  const totals = pitches.reduce(
    (summary, pitch) => ({
      drafts: summary.drafts + (pitch.publishedAt ? 0 : 1),
      published: summary.published + (pitch.publishedAt ? 1 : 0),
      bytes: summary.bytes + pitch.assetBytes,
    }),
    { drafts: 0, published: 0, bytes: 0 },
  );
  const isTrashed = detail?.pitch.lifecycle === "trashed";
  const unavailableAssetCount =
    detail?.assets.filter((asset) => asset.availability === "unavailable").length ?? 0;
  const trashStatus = detail && isTrashed ? describeTrash(detail.pitch, detail.audit) : undefined;

  return (
    <section id="pitch-manager" className="scroll-mt-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs theme-muted">pitch night studio</p>
          <h2 className="mt-1 font-serif text-2xl text-foreground">
            {pitches.length} working {pitches.length === 1 ? "pitch" : "pitches"}
          </h2>
          <p className="mt-1 font-mono text-micro theme-muted">
            {totals.drafts} draft · {totals.published} published · {bytes(totals.bytes)} media
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="font-mono text-xs theme-muted hover:text-foreground disabled:opacity-40"
        >
          {loading ? "refreshing…" : "refresh"}
        </button>
      </div>

      <div className="mt-6 border-y border-[var(--things-amber)] py-5">
        <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
          <div>
            <label
              htmlFor="pitch-operational-mode"
              className="font-mono text-micro uppercase tracking-[0.14em] theme-muted"
            >
              studio operating mode
            </label>
            <AppSelect
              id="pitch-operational-mode"
              value={modeDraft}
              onValueChange={(value) => {
                if (isPitchOperationalMode(value)) setModeDraft(value);
              }}
              disabled={!operationalStatus || busy === "operational-mode"}
              ariaLabel="Studio operating mode"
              variant="field"
              className="mt-3 md:max-w-xs"
              options={[
                { value: "enabled", label: "enabled · all features" },
                { value: "read-only", label: "read-only · no server saves" },
                { value: "off", label: "off · stop public and live access" },
              ]}
            />
            <p className="mt-2 max-w-2xl font-mono text-micro leading-relaxed theme-muted">
              {operationalStatus?.message ?? "Loading the current mode…"}
              {operationalStatus && operationalStatus.environmentMode !== "enabled"
                ? ` The PITCHES_MODE environment value is ${operationalStatus.environmentMode} and is the hard ceiling.`
                : " Local editor safety copies and downloads still work in read-only mode."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void updateOperationalMode()}
            disabled={
              !operationalStatus ||
              busy === "operational-mode" ||
              modeDraft === operationalStatus.adminMode
            }
            className="min-h-11 bg-foreground px-5 font-mono text-xs text-background hover:opacity-80 disabled:opacity-40"
          >
            {busy === "operational-mode" ? "applying…" : "apply mode"}
          </button>
        </div>
      </div>

      <div className="mt-6">
        <PitchRemindersPanel authFetch={authFetch} onError={onError} onStatus={onStatus} />
      </div>

      <div className="mt-6 flex flex-wrap gap-3">
        {(["all", "draft", "published", "archived", "trash"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className={`min-h-11 border px-3 font-mono text-xs ${
              filter === value ? "theme-border-strong text-foreground" : "theme-border theme-muted"
            }`}
          >
            {value}
          </button>
        ))}
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="name, email or title"
          aria-label="Search pitches"
          className="min-h-11 min-w-56 flex-1 border-b theme-border bg-transparent px-2 font-mono text-xs text-foreground outline-none focus:border-foreground"
        />
      </div>

      <div className="mt-5 divide-y theme-border border-y">
        {visible.map((pitch) => (
          <article key={pitch.id} className="py-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
              <button
                type="button"
                onClick={() => void open(pitch)}
                className="min-w-0 text-left hover:opacity-60"
              >
                <span className="block truncate font-serif text-xl text-foreground">
                  {pitch.title}
                </span>
                <span className="mt-1 block font-mono text-micro theme-muted">
                  {pitch.ownerName} · {pitch.ownerEmail} · {pitch.slideCount} slides ·{" "}
                  {when(pitch.updatedAt)}
                </span>
              </button>
              <div className="flex items-center gap-2 font-mono text-xs">
                <span className={pitch.publishedAt ? "text-foreground" : "theme-muted"}>
                  {pitch.lifecycle === "trashed"
                    ? `trash · purges ${pitch.purgeAfter ? when(pitch.purgeAfter) : "later"}`
                    : pitch.lifecycle === "archived"
                      ? "archived"
                      : pitch.publishedAt
                        ? "published"
                        : "draft"}
                </span>
                <button
                  type="button"
                  disabled={busy === pitch.id}
                  onClick={() => void open(pitch)}
                  aria-label={`Edit ${pitch.title}`}
                  title="Edit title, owner and state"
                  className="grid min-h-11 min-w-11 place-items-center theme-muted hover:text-foreground disabled:opacity-40"
                >
                  <svg
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                    className="h-4 w-4 fill-none stroke-current"
                    strokeWidth="1.5"
                  >
                    <path d="M4 20h4l11-11a2.8 2.8 0 0 0-4-4L4 16v4Z" />
                    <path d="m13.5 6.5 4 4" />
                  </svg>
                </button>
                {pitch.lifecycle === "trashed" ? (
                  <button
                    type="button"
                    disabled={busy === pitch.id}
                    onClick={() => void restoreTrash(pitch.id)}
                    className="theme-muted underline underline-offset-4 hover:text-foreground disabled:opacity-40"
                  >
                    restore
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy === pitch.id}
                    onClick={() => void archive(pitch)}
                    className="theme-muted underline underline-offset-4 hover:text-foreground disabled:opacity-40"
                  >
                    {pitch.lifecycle === "archived" ? "restore" : "archive"}
                  </button>
                )}
              </div>
            </div>
          </article>
        ))}
        {!loading && visible.length === 0 ? (
          <p className="py-10 text-center font-mono text-xs theme-muted">No pitches here.</p>
        ) : null}
      </div>

      {detail ? (
        <div className="mt-8 border-y theme-border py-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-mono text-micro uppercase tracking-[0.14em] theme-muted">
                pitch control room · version {detail.pitch.draftVersion}
              </p>
              <h3 className="mt-1 font-serif text-2xl text-foreground">{detail.pitch.title}</h3>
              <p className="mt-1 font-mono text-micro theme-muted">
                {isTrashed
                  ? `in Trash · purges ${detail.pitch.purgeAfter ? when(detail.pitch.purgeAfter) : "after the recovery window"}`
                  : detail.pitch.publishedAt
                    ? `sealed ${when(detail.pitch.publishedAt)} · working copy ${when(detail.pitch.updatedAt)}`
                    : `private draft · expires ${when(detail.pitch.draftExpiresAt)}`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDetail(undefined)}
              className="font-mono text-xs theme-muted"
            >
              close
            </button>
          </div>

          {unavailableAssetCount > 0 ? (
            <div
              className="mt-5 border-y border-[var(--things-amber)] bg-[var(--selection-bg)] px-4 py-3 font-mono text-xs text-[var(--selection-fg)]"
              role="alert"
            >
              {unavailableAssetCount} stored media file
              {unavailableAssetCount === 1 ? " is" : "s are"} missing. Publishing is blocked until
              the owner restores a .mahdeck backup or removes and adds the affected media again.
            </div>
          ) : null}

          <form
            className="mt-6 grid gap-4 border-t theme-border pt-5 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              void updateDetail("update", form);
            }}
          >
            <label className="font-mono text-micro theme-muted sm:col-span-2">
              pitch title
              <input
                value={form.title}
                onChange={(event) =>
                  setForm((current) => ({ ...current, title: event.target.value }))
                }
                className="mt-1 min-h-11 w-full border-b theme-border-strong bg-transparent font-serif text-xl text-foreground outline-none"
              />
            </label>
            <label className="font-mono text-micro theme-muted">
              owner name
              <input
                value={form.ownerName}
                onChange={(event) =>
                  setForm((current) => ({ ...current, ownerName: event.target.value }))
                }
                className="mt-1 min-h-11 w-full border-b theme-border-strong bg-transparent font-mono text-sm text-foreground outline-none"
              />
            </label>
            <label className="font-mono text-micro theme-muted">
              owner email
              <input
                type="email"
                value={form.ownerEmail}
                onChange={(event) =>
                  setForm((current) => ({ ...current, ownerEmail: event.target.value }))
                }
                className="mt-1 min-h-11 w-full border-b theme-border-strong bg-transparent font-mono text-sm text-foreground outline-none"
              />
              <span className="mt-2 block leading-relaxed">
                Changing this transfers the deck. Existing private links are revoked; send the new
                owner a fresh link.
              </span>
            </label>
            <div className="sm:col-span-2">
              <label htmlFor="pitch-lifecycle" className="font-mono text-micro theme-muted">
                deck state
              </label>
              <div className="mt-2 flex flex-wrap items-end gap-3">
                <AppSelect
                  id="pitch-lifecycle"
                  value={lifecycleDraft}
                  onValueChange={(value) => {
                    if (value === "active" || value === "archived" || value === "trashed") {
                      setLifecycleDraft(value);
                    }
                  }}
                  ariaLabel="Deck state"
                  variant="field"
                  className="min-w-56"
                  options={[
                    { value: "active", label: "active · owner can edit" },
                    { value: "archived", label: "archived · hidden from wall" },
                    { value: "trashed", label: "Trash · recoverable for 30 days" },
                  ]}
                />
                <button
                  type="button"
                  disabled={Boolean(busy) || lifecycleDraft === detail.pitch.lifecycle}
                  onClick={() => void updateLifecycle()}
                  className="min-h-11 border theme-border-strong px-4 font-mono text-xs text-foreground hover:opacity-70 disabled:opacity-40"
                >
                  move pitch
                </button>
              </div>
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="pitch-publication" className="font-mono text-micro theme-muted">
                publication
              </label>
              <div className="mt-2 flex flex-wrap items-end gap-3">
                <AppSelect
                  id="pitch-publication"
                  value={publicationDraft}
                  onValueChange={(value) => {
                    if (value === "draft" || value === "published") setPublicationDraft(value);
                  }}
                  ariaLabel="Pitch publication"
                  variant="field"
                  className="min-w-56"
                  options={[
                    { value: "draft", label: "draft · not on the public wall" },
                    { value: "published", label: "published · seal current copy" },
                  ]}
                />
                <button
                  type="button"
                  disabled={
                    Boolean(busy) ||
                    (publicationDraft === "published" && unavailableAssetCount > 0) ||
                    publicationDraft === (detail.pitch.publishedAt ? "published" : "draft")
                  }
                  onClick={() => void updatePublication()}
                  className="min-h-11 border theme-border-strong px-4 font-mono text-xs text-foreground hover:opacity-70 disabled:opacity-40"
                >
                  apply publication
                </button>
              </div>
              <p className="mt-2 max-w-2xl font-mono text-micro leading-relaxed theme-muted">
                Publishing seals the current working copy as a new edition. Returning to draft hides
                it from the wall without deleting earlier editions.
              </p>
            </div>
            <div className="flex flex-wrap gap-4 sm:col-span-2">
              <button
                type="submit"
                disabled={Boolean(busy)}
                className="min-h-10 bg-foreground px-4 font-mono text-xs text-background disabled:opacity-40"
              >
                save details
              </button>
              <button
                type="button"
                disabled={isTrashed || Boolean(busy)}
                onClick={() => void updateDetail("resend-access")}
                className="min-h-10 border-b theme-border-strong px-2 font-mono text-xs text-foreground disabled:opacity-40"
              >
                resend private link
              </button>
            </div>
          </form>

          {isTrashed && trashStatus ? (
            <section
              className="mt-6 border-y theme-border py-5"
              aria-labelledby="pitch-trash-status-heading"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="font-mono text-micro uppercase tracking-[0.14em] theme-muted">
                    trash status
                  </p>
                  <h4
                    id="pitch-trash-status-heading"
                    className="mt-1 font-serif text-xl text-foreground"
                  >
                    recoverable until{" "}
                    {detail.pitch.purgeAfter ? when(detail.pitch.purgeAfter) : "the purge date"}
                  </h4>
                  <p className="mt-2 max-w-2xl font-serif text-base leading-relaxed theme-muted">
                    {trashStatus.summary}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy === detail.pitch.id}
                  onClick={() => void restoreTrash(detail.pitch.id)}
                  className="min-h-11 border theme-border-strong px-4 font-mono text-xs text-foreground hover:opacity-70 disabled:opacity-40"
                >
                  {busy === detail.pitch.id ? "restoring…" : "restore pitch"}
                </button>
              </div>
              <dl className="mt-5 grid gap-4 border-t theme-border pt-4 font-mono text-micro sm:grid-cols-3">
                <div>
                  <dt className="theme-muted">moved by</dt>
                  <dd className="mt-1 text-foreground">{trashStatus.movedBy}</dd>
                </div>
                <div>
                  <dt className="theme-muted">moved at</dt>
                  <dd className="mt-1 text-foreground">
                    {trashStatus.movedAt ? when(trashStatus.movedAt) : "not recorded"}
                  </dd>
                </div>
                <div>
                  <dt className="theme-muted">owner access</dt>
                  <dd className="mt-1 text-foreground">paused while in Trash</dd>
                </div>
              </dl>
              <p className="mt-4 max-w-2xl font-mono text-micro leading-relaxed theme-muted">
                An admin must restore this pitch before the purge date. Restoring keeps the working
                copy and makes the owner&apos;s existing private link usable again. Restore it
                first, then send a fresh link if they need one.
              </p>
            </section>
          ) : null}

          <p className="mt-8 font-mono text-micro uppercase tracking-[0.14em] theme-muted">
            current working slides
          </p>
          <ol className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {detail.pitch.draftDocument.slides
              .filter((slide) => !slide.deletedAt)
              .map((slide, index) => (
                <li key={slide.id} className="border theme-border">
                  <PitchSlideThumbnail
                    slide={slide}
                    files={detailFiles}
                    alt={`Preview of ${slide.name}`}
                    className="aspect-video w-full object-contain bg-surface"
                  />
                  <div className="p-3">
                    <p className="font-mono text-micro theme-muted">slide {index + 1}</p>
                    <p className="mt-1 font-serif text-lg text-foreground">{slide.name}</p>
                    <p className="mt-2 font-mono text-micro theme-muted">
                      {slide.elements.filter((element) => !element.isDeleted).length} objects
                      {slide.mediaClips.length
                        ? ` · ${slide.mediaClips.length} media clip${slide.mediaClips.length === 1 ? "" : "s"}`
                        : ""}
                      {slide.inkLayers?.length ? ` · ${slide.inkLayers.length} ink` : ""}
                    </p>
                  </div>
                </li>
              ))}
          </ol>

          <details className="group mt-7 border-t theme-border pt-4">
            <summary className="cursor-pointer list-none font-mono text-xs text-foreground">
              media &amp; storage · {detail.assets.length} files ·{" "}
              {bytes(detail.assets.reduce((total, asset) => total + asset.bytes, 0))}
              <span className="float-right theme-muted group-open:hidden">open</span>
              <span className="float-right hidden theme-muted group-open:inline">close</span>
            </summary>
            <ul className="mt-4 divide-y theme-border border-y">
              {detail.assets.map((asset) => (
                <li
                  key={asset.id}
                  className="flex flex-wrap justify-between gap-2 py-3 font-mono text-micro"
                >
                  <span className="min-w-0 truncate text-foreground">{asset.fileName}</span>
                  <span className="theme-muted">
                    {asset.kind} · {asset.state} · {asset.availability} · {bytes(asset.bytes)}
                  </span>
                </li>
              ))}
              {detail.assets.length === 0 ? (
                <li className="py-4 font-mono text-micro theme-muted">No stored media.</li>
              ) : null}
            </ul>
          </details>

          <details className="group mt-4 border-t theme-border pt-4">
            <summary className="cursor-pointer list-none font-mono text-xs text-foreground">
              backups &amp; activity · {detail.backups.length} restore points
              <span className="float-right theme-muted group-open:hidden">open</span>
              <span className="float-right hidden theme-muted group-open:inline">close</span>
            </summary>
            <div className="mt-4 grid gap-6 md:grid-cols-2">
              <div>
                <p className="font-mono text-micro uppercase tracking-[0.12em] theme-muted">
                  restore points
                </p>
                <ul className="mt-2 divide-y theme-border">
                  {detail.backups.map((backup) => (
                    <li key={backup.id} className="flex items-center justify-between gap-3 py-3">
                      <span className="font-mono text-micro theme-muted">
                        v{backup.version} · {backup.reason} · {when(backup.createdAt)}
                      </span>
                      <button
                        type="button"
                        disabled={Boolean(busy)}
                        onClick={() => void updateDetail("restore-backup", { backupId: backup.id })}
                        className="font-mono text-xs text-foreground underline underline-offset-4 disabled:opacity-40"
                      >
                        restore
                      </button>
                    </li>
                  ))}
                  {detail.backups.length === 0 ? (
                    <li className="py-3 font-mono text-micro theme-muted">
                      The first restore point appears during normal saving or publishing.
                    </li>
                  ) : null}
                </ul>
              </div>
              <div>
                <p className="font-mono text-micro uppercase tracking-[0.12em] theme-muted">
                  sealed editions
                </p>
                <ul className="mt-2 divide-y theme-border">
                  {detail.editions.map((edition) => (
                    <li key={edition.editionNumber} className="flex gap-3 py-3">
                      <Link
                        to="/things/pitches/$deckId"
                        params={{ deckId: detail.pitch.id }}
                        search={{ edition: edition.editionNumber }}
                        className="font-mono text-xs text-foreground underline underline-offset-4"
                      >
                        edition {edition.editionNumber}
                      </Link>
                      <span className="font-mono text-micro theme-muted">
                        v{edition.draftVersion} · {edition.title} · {when(edition.publishedAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="font-mono text-micro uppercase tracking-[0.12em] theme-muted">
                  recent activity
                </p>
                <ul className="mt-2 max-h-72 divide-y theme-border overflow-y-auto">
                  {detail.audit.map((event) => (
                    <li key={event.id} className="py-3">
                      <p className="font-mono text-xs text-foreground">{event.action}</p>
                      <p className="font-mono text-micro theme-muted">
                        {event.actor} · {when(event.createdAt)}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </details>

          <details className="group mt-4 border-t theme-border pt-4">
            <summary className="cursor-pointer list-none font-mono text-xs text-foreground">
              move this pitch to Trash
              <span className="float-right theme-muted group-open:hidden">open</span>
              <span className="float-right hidden theme-muted group-open:inline">close</span>
            </summary>
            <div className="mt-4 max-w-xl">
              <p className="font-serif text-base theme-muted">
                This hides the pitch and blocks editing now. The working copy, sealed editions,
                backups and media remain recoverable for 30 days. Type the exact title to continue.
              </p>
              <input
                value={deleteConfirmation}
                onChange={(event) => setDeleteConfirmation(event.target.value)}
                placeholder={detail.pitch.title}
                aria-label="Type the pitch title to confirm deletion"
                className="mt-3 min-h-11 w-full border-b theme-border-strong bg-transparent font-mono text-sm text-foreground outline-none"
              />
              <button
                type="button"
                disabled={busy === "delete" || deleteConfirmation !== detail.pitch.title}
                onClick={() => void deletePitch()}
                className="mt-4 min-h-10 border px-4 font-mono text-xs text-foreground theme-border-strong disabled:opacity-30"
              >
                move pitch to Trash
              </button>
            </div>
          </details>
        </div>
      ) : null}
      {dialog}
    </section>
  );
}
