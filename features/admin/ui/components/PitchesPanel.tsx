"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { BinaryFiles } from "@excalidraw/excalidraw/types";

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

export function PitchesPanel({
  authFetch,
  onError,
  onStatus,
}: {
  authFetch: AuthFetch;
  onError: (message: string) => void;
  onStatus: (message: string) => void;
}) {
  const [pitches, setPitches] = useState<PitchDeckAdminSummary[]>([]);
  const [detail, setDetail] = useState<PitchDetail>();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "draft" | "published" | "archived" | "trash">("all");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [detailFiles, setDetailFiles] = useState<BinaryFiles>({});
  const [form, setForm] = useState({ title: "", ownerName: "", ownerEmail: "" });
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

  async function restoreTrash(pitch: PitchDeckAdminSummary) {
    setBusy(pitch.id);
    try {
      const response = await authFetch("/api/admin/pitches", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore-trash", deckId: pitch.id }),
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

  async function deletePitch() {
    if (!detail || deleteConfirmation !== detail.pitch.title) return;
    setBusy("delete");
    try {
      const response = await authFetch("/api/admin/pitches", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
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
              <div className="flex items-center gap-3 font-mono text-xs">
                <span className={pitch.publishedAt ? "text-foreground" : "theme-muted"}>
                  {pitch.lifecycle === "trashed"
                    ? `trash · purges ${pitch.purgeAfter ? when(pitch.purgeAfter) : "later"}`
                    : pitch.lifecycle === "archived"
                      ? "archived"
                      : pitch.publishedAt
                        ? "published"
                        : "draft"}
                </span>
                {pitch.lifecycle === "trashed" ? (
                  <button
                    type="button"
                    disabled={busy === pitch.id}
                    onClick={() => void restoreTrash(pitch)}
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
                {detail.pitch.publishedAt
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
            </label>
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
                disabled={Boolean(busy)}
                onClick={() => void updateDetail("resend-access")}
                className="min-h-10 border-b theme-border-strong px-2 font-mono text-xs text-foreground disabled:opacity-40"
              >
                resend private link
              </button>
            </div>
          </form>

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
                    {asset.kind} · {asset.state} · {bytes(asset.bytes)}
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
                      <a
                        href={`/things/pitches/${detail.pitch.id}?edition=${edition.editionNumber}`}
                        className="font-mono text-xs text-foreground underline underline-offset-4"
                      >
                        edition {edition.editionNumber}
                      </a>
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
