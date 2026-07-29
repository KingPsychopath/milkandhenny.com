"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  PitchAsset,
  PitchDeckAdminSummary,
  PitchDocument,
} from "@/features/things/pitches/types";

type AuthFetch = (url: string, options?: RequestInit) => Promise<Response>;

type PitchDetail = {
  pitch: {
    title: string;
    draftDocument: PitchDocument;
    draftExpiresAt: string;
    publishedAt?: string;
    updatedAt: string;
  };
  assets: PitchAsset[];
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
  const [filter, setFilter] = useState<"all" | "draft" | "published" | "archived">("all");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await authFetch("/api/admin/pitches");
      if (!response.ok) throw new Error("Could not load pitches");
      const body = (await response.json()) as { pitches?: PitchDeckAdminSummary[] };
      setPitches(body.pitches ?? []);
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
      setDetail((await response.json()) as PitchDetail);
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
        body: JSON.stringify({ deckId: pitch.id, archived }),
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

      <div className="mt-6 flex flex-wrap gap-2">
        {(["all", "draft", "published", "archived"] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className={`min-h-9 border px-3 font-mono text-xs ${
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
          className="min-h-9 min-w-56 flex-1 border-b theme-border bg-transparent px-2 font-mono text-xs text-foreground outline-none focus:border-foreground"
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
                  {pitch.lifecycle === "archived"
                    ? "archived"
                    : pitch.publishedAt
                      ? "published"
                      : "draft"}
                </span>
                <button
                  type="button"
                  disabled={busy === pitch.id}
                  onClick={() => void archive(pitch)}
                  className="theme-muted underline underline-offset-4 hover:text-foreground disabled:opacity-40"
                >
                  {pitch.lifecycle === "archived" ? "restore" : "archive"}
                </button>
              </div>
            </div>
          </article>
        ))}
        {!loading && visible.length === 0 ? (
          <p className="py-10 text-center font-mono text-xs theme-muted">No pitches here.</p>
        ) : null}
      </div>

      {detail ? (
        <div className="mt-6 border-y theme-border py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="font-mono text-micro uppercase tracking-[0.14em] theme-muted">
                working-copy inspection
              </p>
              <h3 className="mt-1 font-serif text-2xl text-foreground">{detail.pitch.title}</h3>
            </div>
            <button
              type="button"
              onClick={() => setDetail(undefined)}
              className="font-mono text-xs theme-muted"
            >
              close
            </button>
          </div>
          <ol className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {detail.pitch.draftDocument.slides
              .filter((slide) => !slide.deletedAt)
              .map((slide, index) => (
                <li key={slide.id} className="border theme-border p-3">
                  <p className="font-mono text-micro theme-muted">slide {index + 1}</p>
                  <p className="mt-1 font-serif text-lg text-foreground">{slide.name}</p>
                  <p className="mt-2 font-mono text-micro theme-muted">
                    {slide.elements.filter((element) => !element.isDeleted).length} objects
                    {slide.audioAssetId ? " · sound" : ""}
                    {slide.inkLayers?.length ? ` · ${slide.inkLayers.length} ink` : ""}
                  </p>
                </li>
              ))}
          </ol>
          <p className="mt-4 font-mono text-micro theme-muted">
            {detail.assets.length} media files ·{" "}
            {detail.pitch.publishedAt
              ? `public edition sealed · working copy saved ${when(detail.pitch.updatedAt)}`
              : `private draft expires ${when(detail.pitch.draftExpiresAt)}`}
          </p>
        </div>
      ) : null}
    </section>
  );
}
