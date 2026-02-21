"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type NoteVisibility = "public" | "unlisted" | "private";
type WordType = "blog" | "note" | "recipe" | "review";

type NoteMeta = {
  slug: string;
  title: string;
  subtitle?: string;
  image?: string;
  type: WordType;
  visibility: NoteVisibility;
  tags: string[];
  featured?: boolean;
  updatedAt: string;
};

type NoteRecord = {
  meta: NoteMeta;
  markdown: string;
};

type ShareLink = {
  id: string;
  slug: string;
  expiresAt: string;
  pinRequired: boolean;
  revokedAt?: string;
  updatedAt: string;
};

type SharePatchResponse = {
  link?: ShareLink;
  token?: string;
  error?: string;
};

type ShareStateFilter = "all" | "active" | "expired" | "revoked";

type SharedWordSummary = {
  slug: string;
  activeShareCount: number;
};

type WordMediaItem = {
  key: string;
  filename: string;
  kind: "image" | "video" | "gif" | "audio" | "file";
  size: number;
  lastModified?: string;
  url: string;
  markdown: string;
  shortMarkdown?: string;
  assetId?: string;
};

type WordMediaResponse = {
  slug: string;
  assetsIncluded?: boolean;
  pageMedia?: WordMediaItem[];
  assets?: WordMediaItem[];
  error?: string;
};

function buildShareUrl(slug: string, token: string): string {
  return `${window.location.origin}/words/${slug}?share=${encodeURIComponent(token)}`;
}

function featuredButtonClass(isFeatured: boolean): string {
  return `h-full min-h-10 px-3 rounded border font-mono text-xs transition-colors ${
    isFeatured
      ? "border-[var(--foreground)] text-[var(--foreground)]"
      : "theme-border theme-muted hover:text-[var(--foreground)]"
  }`;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 b";
  const units = ["b", "kb", "mb", "gb"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const size = bytes / 1024 ** index;
  return `${size.toFixed(size >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function isExpiredShare(link: ShareLink): boolean {
  return new Date(link.expiresAt).getTime() <= Date.now();
}

function getShareState(link: ShareLink): Exclude<ShareStateFilter, "all"> {
  if (link.revokedAt) return "revoked";
  if (isExpiredShare(link)) return "expired";
  return "active";
}

const SHARE_EXPIRY_OPTIONS = [1, 3, 7, 14, 30] as const;

export function EditorAdminClient() {
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [selectedSlug, setSelectedSlug] = useState("");
  const [current, setCurrent] = useState<NoteRecord | null>(null);
  const [shares, setShares] = useState<ShareLink[]>([]);
  const [shareTokensById, setShareTokensById] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [activeShareCountBySlug, setActiveShareCountBySlug] = useState<Record<string, number>>({});
  const [newShareExpiryDays, setNewShareExpiryDays] = useState<number>(7);
  const [shareStateFilter, setShareStateFilter] = useState<ShareStateFilter>("all");

  const [createSlug, setCreateSlug] = useState("");
  const [createTitle, setCreateTitle] = useState("");
  const [createSubtitle, setCreateSubtitle] = useState("");
  const [createImage, setCreateImage] = useState("");
  const [createType, setCreateType] = useState<WordType>("note");
  const [createVisibility, setCreateVisibility] = useState<NoteVisibility>("private");
  const [createTags, setCreateTags] = useState("");
  const [createFeatured, setCreateFeatured] = useState(false);
  const [createMarkdown, setCreateMarkdown] = useState("");

  const [editTitle, setEditTitle] = useState("");
  const [editSubtitle, setEditSubtitle] = useState("");
  const [editImage, setEditImage] = useState("");
  const [editType, setEditType] = useState<WordType>("note");
  const [editVisibility, setEditVisibility] = useState<NoteVisibility>("private");
  const [editTags, setEditTags] = useState("");
  const [editFeatured, setEditFeatured] = useState(false);
  const [editMarkdown, setEditMarkdown] = useState("");

  const [searchQuery, setSearchQuery] = useState("");
  const [filterType, setFilterType] = useState<WordType | "all">("all");
  const [filterVisibility, setFilterVisibility] = useState<NoteVisibility | "all">("all");
  const [filterTag, setFilterTag] = useState("");
  const [mediaSearchQuery, setMediaSearchQuery] = useState("");
  const [pageMedia, setPageMedia] = useState<WordMediaItem[]>([]);
  const [sharedAssets, setSharedAssets] = useState<WordMediaItem[]>([]);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [mediaError, setMediaError] = useState("");
  const [mediaCopied, setMediaCopied] = useState<string | null>(null);
  const [assetsHydrated, setAssetsHydrated] = useState(false);

  const parseTags = useCallback((raw: string): string[] => {
    return [...new Set(raw.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean))];
  }, []);

  const storeShareToken = useCallback((shareId: string, token: string) => {
    setShareTokensById((prev) => ({ ...prev, [shareId]: token }));
  }, []);

  const loadNotes = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const params = new URLSearchParams();
      params.set("limit", "200");
      if (searchQuery.trim()) params.set("q", searchQuery.trim());
      if (filterType !== "all") params.set("type", filterType);
      if (filterVisibility !== "all") params.set("visibility", filterVisibility);
      if (filterTag.trim()) params.set("tag", filterTag.trim().toLowerCase());

      const res = await fetch(`/api/notes?${params.toString()}`);
      const data = (await res.json().catch(() => ({}))) as { notes?: NoteMeta[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to load words");
      setNotes(data.notes ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load words");
    } finally {
      setBusy(false);
    }
  }, [filterTag, filterType, filterVisibility, searchQuery]);

  const loadSharedStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/word-shares");
      const data = (await res.json().catch(() => ({}))) as { items?: SharedWordSummary[] };
      if (!res.ok) return;
      const next: Record<string, number> = {};
      for (const item of data.items ?? []) {
        next[item.slug] = item.activeShareCount;
      }
      setActiveShareCountBySlug(next);
    } catch {
      // Non-fatal for editor UX.
    }
  }, []);

  const loadWordMedia = useCallback(
    async (slug: string, forceAssets = false) => {
      if (!slug) return;

      setMediaLoading(true);
      setMediaError("");
      try {
        const params = new URLSearchParams();
        params.set("slug", slug);
        if (!forceAssets && assetsHydrated) {
          params.set("includeAssets", "false");
        }

        const res = await fetch(`/api/admin/word-media?${params.toString()}`);
        const data = (await res.json().catch(() => ({}))) as WordMediaResponse;
        if (!res.ok) throw new Error(data.error ?? "Failed to load media library");

        setPageMedia(data.pageMedia ?? []);
        if (data.assetsIncluded) {
          setSharedAssets(data.assets ?? []);
          setAssetsHydrated(true);
        }
      } catch (err) {
        setMediaError(err instanceof Error ? err.message : "Failed to load media library");
      } finally {
        setMediaLoading(false);
      }
    },
    [assetsHydrated]
  );

  const copySnippet = useCallback(async (snippet: string, copyId: string) => {
    try {
      await navigator.clipboard.writeText(snippet);
      setMediaCopied(copyId);
      setStatus("snippet copied");
      setTimeout(() => setMediaCopied((current) => (current === copyId ? null : current)), 1200);
    } catch {
      setError("Unable to copy snippet");
    }
  }, []);

  const appendSnippet = useCallback((snippet: string) => {
    setEditMarkdown((prev) => {
      const base = prev.trimEnd();
      return base ? `${base}\n\n${snippet}` : snippet;
    });
    setStatus("snippet appended");
  }, []);

  const loadWord = useCallback(async (slug: string) => {
    if (!slug) return;
    setBusy(true);
    setError("");
    try {
      const [noteRes, sharesRes] = await Promise.all([
        fetch(`/api/notes/${encodeURIComponent(slug)}`),
        fetch(`/api/notes/${encodeURIComponent(slug)}/shares`),
      ]);
      const noteData = (await noteRes.json().catch(() => ({}))) as NoteRecord & { error?: string };
      const shareData = (await sharesRes.json().catch(() => ({}))) as { links?: ShareLink[]; error?: string };

      if (!noteRes.ok) throw new Error(noteData.error ?? "Failed to load word");
      if (!sharesRes.ok) throw new Error(shareData.error ?? "Failed to load share links");

      setCurrent(noteData);
      setEditTitle(noteData.meta.title);
      setEditSubtitle(noteData.meta.subtitle ?? "");
      setEditImage(noteData.meta.image ?? "");
      setEditType(noteData.meta.type);
      setEditVisibility(noteData.meta.visibility);
      setEditTags(noteData.meta.tags.join(", "));
      setEditFeatured(!!noteData.meta.featured);
      setEditMarkdown(noteData.markdown);
      setShares(shareData.links ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load word");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void loadNotes();
  }, [loadNotes]);

  useEffect(() => {
    void loadSharedStatus();
  }, [loadSharedStatus]);

  useEffect(() => {
    const fromQuery = new URLSearchParams(window.location.search).get("slug");
    if (fromQuery && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(fromQuery)) {
      setSelectedSlug(fromQuery);
    }
  }, []);

  useEffect(() => {
    if (!selectedSlug && notes[0]) setSelectedSlug(notes[0].slug);
  }, [notes, selectedSlug]);

  useEffect(() => {
    if (selectedSlug) void loadWord(selectedSlug);
  }, [selectedSlug, loadWord]);

  useEffect(() => {
    if (selectedSlug) void loadWordMedia(selectedSlug);
  }, [selectedSlug, loadWordMedia]);

  useEffect(() => {
    if (!selectedSlug) {
      setPageMedia([]);
      setMediaSearchQuery("");
    }
  }, [selectedSlug]);

  const selected = useMemo(
    () => notes.find((n) => n.slug === selectedSlug) ?? null,
    [notes, selectedSlug]
  );

  const mediaQuery = mediaSearchQuery.trim().toLowerCase();
  const filteredPageMedia = useMemo(
    () =>
      pageMedia.filter((item) => {
        if (!mediaQuery) return true;
        const haystack = `${item.filename} ${item.key}`.toLowerCase();
        return haystack.includes(mediaQuery);
      }),
    [mediaQuery, pageMedia]
  );
  const filteredSharedAssets = useMemo(
    () =>
      sharedAssets.filter((item) => {
        if (!mediaQuery) return true;
        const haystack = `${item.assetId ?? ""} ${item.filename} ${item.key}`.toLowerCase();
        return haystack.includes(mediaQuery);
      }),
    [mediaQuery, sharedAssets]
  );
  const filteredShares = useMemo(() => {
    if (shareStateFilter === "all") return shares;
    return shares.filter((link) => getShareState(link) === shareStateFilter);
  }, [shareStateFilter, shares]);

  async function createWord() {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const res = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: createSlug,
          title: createTitle,
          subtitle: createSubtitle || undefined,
          image: createImage || undefined,
          type: createType,
          visibility: createVisibility,
          tags: parseTags(createTags),
          featured: createFeatured,
          markdown: createMarkdown,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { meta?: NoteMeta; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to create word");

      setStatus("word created");
      setCreateSlug("");
      setCreateTitle("");
      setCreateSubtitle("");
      setCreateImage("");
      setCreateType("note");
      setCreateVisibility("private");
      setCreateTags("");
      setCreateFeatured(false);
      setCreateMarkdown("");

      await Promise.all([loadNotes(), loadSharedStatus()]);
      if (data.meta?.slug) setSelectedSlug(data.meta.slug);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create word");
    } finally {
      setBusy(false);
    }
  }

  async function saveWord() {
    if (!selectedSlug) return;

    setBusy(true);
    setError("");
    setStatus("");
    try {
      const res = await fetch(`/api/notes/${encodeURIComponent(selectedSlug)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editTitle,
          subtitle: editSubtitle,
          image: editImage,
          type: editType,
          visibility: editVisibility,
          tags: parseTags(editTags),
          featured: editFeatured,
          markdown: editMarkdown,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to save word");

      setStatus("word saved");
      await loadNotes();
      await loadWord(selectedSlug);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save word");
    } finally {
      setBusy(false);
    }
  }

  async function deleteCurrentWord() {
    if (!selectedSlug) return;
    if (!window.confirm(`Delete word \"${selectedSlug}\"?`)) return;

    setBusy(true);
    setError("");
    setStatus("");
    try {
      const res = await fetch(`/api/notes/${encodeURIComponent(selectedSlug)}`, {
        method: "DELETE",
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to delete word");

      setStatus("word deleted");
      setCurrent(null);
      setShares([]);
      setSelectedSlug("");
      await Promise.all([loadNotes(), loadSharedStatus()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete word");
    } finally {
      setBusy(false);
    }
  }

  async function createShare() {
    if (!selectedSlug) return;
    const withPin = window.confirm("Protect this new share link with a PIN?");
    const pin = withPin ? window.prompt("Enter share PIN") ?? "" : "";

    setBusy(true);
    setError("");
    setStatus("");
    try {
      const res = await fetch(`/api/notes/${encodeURIComponent(selectedSlug)}/shares`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expiresInDays: newShareExpiryDays,
          pinRequired: withPin,
          pin: withPin ? pin : undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        link?: ShareLink;
        token?: string;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Failed to create share link");
      if (!data.token || !data.link) throw new Error("Share link created but token missing.");

      storeShareToken(data.link.id, data.token);
      await navigator.clipboard.writeText(buildShareUrl(selectedSlug, data.token));
      setStatus("share link created and copied");
      await loadSharedStatus();
      await loadWord(selectedSlug);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create share link");
    } finally {
      setBusy(false);
    }
  }

  async function toggleSharePin(link: ShareLink) {
    if (link.revokedAt || isExpiredShare(link)) {
      setError("Cannot update PIN on an expired or revoked share link.");
      return;
    }
    const enable = !link.pinRequired;
    const pin = enable ? window.prompt("Set PIN for this link") ?? "" : null;
    if (enable && !pin) return;

    setBusy(true);
    setError("");
    setStatus("");
    try {
      const res = await fetch(
        `/api/notes/${encodeURIComponent(link.slug)}/shares/${encodeURIComponent(link.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(enable ? { pinRequired: true, pin } : { pinRequired: false }),
        }
      );
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to update share link");

      setStatus(enable ? "PIN enabled" : "PIN removed");
      await loadSharedStatus();
      await loadWord(link.slug);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update share link");
    } finally {
      setBusy(false);
    }
  }

  async function rotateShare(link: ShareLink, reason: "rotate" | "reissue" = "rotate") {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const isExpired = isExpiredShare(link);
      const res = await fetch(
        `/api/notes/${encodeURIComponent(link.slug)}/shares/${encodeURIComponent(link.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            isExpired ? { rotateToken: true, expiresInDays: newShareExpiryDays } : { rotateToken: true }
          ),
        }
      );
      const data = (await res.json().catch(() => ({}))) as SharePatchResponse;
      if (!res.ok) throw new Error(data.error ?? "Failed to rotate link");
      if (!data.token) throw new Error("Token rotation succeeded but no token was returned.");

      storeShareToken(link.id, data.token);
      await navigator.clipboard.writeText(buildShareUrl(link.slug, data.token));
      if (reason === "reissue" && isExpired) {
        setStatus(`share link reissued for ${newShareExpiryDays} day(s) and copied`);
      } else {
        setStatus(reason === "reissue" ? "share link reissued and copied" : "share link rotated and copied");
      }
      await loadSharedStatus();
      await loadWord(link.slug);
      return data.token;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to rotate share link");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function extendShare(link: ShareLink) {
    if (link.revokedAt) {
      setError("Cannot extend a revoked share link.");
      return;
    }
    const raw = window.prompt("Extend from now by how many days? (1-30)", String(newShareExpiryDays));
    if (!raw) return;
    const days = Number.parseInt(raw, 10);
    if (!Number.isFinite(days) || days < 1 || days > 30) {
      setError("Expiry must be between 1 and 30 days.");
      return;
    }

    setBusy(true);
    setError("");
    setStatus("");
    try {
      const res = await fetch(
        `/api/notes/${encodeURIComponent(link.slug)}/shares/${encodeURIComponent(link.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expiresInDays: days }),
        }
      );
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to extend share link");
      setStatus(`share link extended by ${days} day(s)`);
      await loadSharedStatus();
      await loadWord(link.slug);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to extend share link");
    } finally {
      setBusy(false);
    }
  }

  async function copyShareLink(link: ShareLink) {
    setError("");
    setStatus("");
    try {
      if (link.revokedAt) {
        setError("Cannot copy a revoked link. Reissue from an active link instead.");
        return;
      }

      const knownToken = shareTokensById[link.id];
      if (knownToken) {
        await navigator.clipboard.writeText(buildShareUrl(link.slug, knownToken));
        setStatus("share link copied");
        return;
      }

      const shouldReissue = window.confirm(
        "For security, existing tokens are stored as hashes and cannot be read back. Reissue this link now? (This invalidates the previous URL.)"
      );
      if (!shouldReissue) return;

      await rotateShare(link, "reissue");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to copy share link");
    }
  }

  async function revokeShare(link: ShareLink) {
    if (!window.confirm("Revoke this share link?")) return;

    setBusy(true);
    setError("");
    setStatus("");
    try {
      const res = await fetch(
        `/api/notes/${encodeURIComponent(link.slug)}/shares/${encodeURIComponent(link.id)}`,
        { method: "DELETE" }
      );
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to revoke link");

      setStatus("share link revoked");
      setShareTokensById((prev) => {
        const next = { ...prev };
        delete next[link.id];
        return next;
      });
      await loadSharedStatus();
      await loadWord(link.slug);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke share link");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-6 pt-12 pb-24">
      <header className="flex flex-wrap items-center justify-between gap-3 mb-8">
        <div>
          <h1 className="font-mono text-lg font-bold tracking-tighter">admin · editor</h1>
          <p className="font-mono text-xs theme-muted mt-1">
            write, filter, and share posts
          </p>
        </div>
        <div className="flex items-center gap-4 font-mono text-xs">
          <Link href="/admin" className="theme-muted hover:text-foreground transition-colors">
            admin home
          </Link>
          <Link href="/words" className="theme-muted hover:text-foreground transition-colors">
            open words
          </Link>
        </div>
      </header>

      {(status || error) && (
        <div className="mb-4 font-mono text-xs space-y-1">
          {status ? <p className="text-[var(--prose-hashtag)]">{status}</p> : null}
          {error ? <p className="text-[var(--prose-hashtag)]">{error}</p> : null}
        </div>
      )}

      <section className="mb-6 border theme-border rounded-md p-4 space-y-3">
        <p className="font-mono text-xs theme-muted">search + filters</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="search title, slug, tags"
            className="bg-transparent border-b theme-border outline-none font-mono text-sm py-2"
          />
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as WordType | "all")}
            className="bg-transparent border theme-border rounded px-2 py-2 font-mono text-xs"
          >
            <option value="all">all types</option>
            <option value="blog">blog</option>
            <option value="note">note</option>
            <option value="recipe">recipe</option>
            <option value="review">review</option>
          </select>
          <select
            value={filterVisibility}
            onChange={(e) => setFilterVisibility(e.target.value as NoteVisibility | "all")}
            className="bg-transparent border theme-border rounded px-2 py-2 font-mono text-xs"
          >
            <option value="all">all visibility</option>
            <option value="public">public</option>
            <option value="unlisted">unlisted</option>
            <option value="private">private</option>
          </select>
          <input
            value={filterTag}
            onChange={(e) => setFilterTag(e.target.value)}
            placeholder="filter by tag"
            className="bg-transparent border-b theme-border outline-none font-mono text-sm py-2"
          />
        </div>
        <div className="flex items-center gap-3 font-mono text-xs">
          <button type="button" onClick={() => void loadNotes()} className="underline">
            apply filters
          </button>
          <button
            type="button"
            onClick={() => {
              setSearchQuery("");
              setFilterType("all");
              setFilterVisibility("all");
              setFilterTag("");
            }}
            className="underline"
          >
            clear
          </button>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <aside className="space-y-3 border theme-border rounded-md p-3 h-fit">
          <div className="flex items-center justify-between">
            <p className="font-mono text-xs theme-muted">results ({notes.length})</p>
            <button type="button" onClick={() => void loadNotes()} className="font-mono text-xs underline">
              refresh
            </button>
          </div>
          <div className="space-y-1 max-h-[420px] overflow-auto">
            {notes.map((note) => (
              <button
                type="button"
                key={note.slug}
                onClick={() => setSelectedSlug(note.slug)}
                className={`w-full text-left rounded px-2 py-2 border transition-colors ${
                  selectedSlug === note.slug ? "border-[var(--foreground)]" : "theme-border"
                }`}
              >
                <p className="font-mono text-xs">{note.slug}</p>
                <p className="font-serif text-sm leading-tight mt-1">{note.title}</p>
                <p className="font-mono text-micro theme-muted mt-1">
                  {note.type} · {note.visibility}
                  {note.featured ? " · featured" : ""}
                  {(activeShareCountBySlug[note.slug] ?? 0) > 0
                    ? ` · shared (${activeShareCountBySlug[note.slug]})`
                    : ""}
                </p>
                {note.tags.length > 0 && (
                  <p className="font-mono text-micro theme-faint mt-1">#{note.tags.join(" #")}</p>
                )}
              </button>
            ))}
          </div>
        </aside>

        <section className="space-y-6">
          <div className="border theme-border rounded-md p-4 space-y-3">
            <h2 className="font-mono text-xs theme-muted">create word</h2>
            <div className="grid sm:grid-cols-2 gap-3">
              <input
                value={createSlug}
                onChange={(e) => setCreateSlug(e.target.value)}
                placeholder="slug"
                className="bg-transparent border-b theme-border outline-none font-mono text-sm py-2"
              />
              <input
                value={createTitle}
                onChange={(e) => setCreateTitle(e.target.value)}
                placeholder="title"
                className="bg-transparent border-b theme-border outline-none font-mono text-sm py-2"
              />
            </div>
            <input
              value={createSubtitle}
              onChange={(e) => setCreateSubtitle(e.target.value)}
              placeholder="subtitle (optional)"
              className="w-full bg-transparent border-b theme-border outline-none font-mono text-sm py-2"
            />
            <input
              value={createImage}
              onChange={(e) => setCreateImage(e.target.value)}
              placeholder="hero image path (optional: words/media/... or words/assets/...)"
              className="w-full bg-transparent border-b theme-border outline-none font-mono text-sm py-2"
            />
            <div className="grid sm:grid-cols-2 gap-3">
              <input
                value={createTags}
                onChange={(e) => setCreateTags(e.target.value)}
                placeholder="tags (comma-separated)"
                className="bg-transparent border-b theme-border outline-none font-mono text-sm py-2"
              />
              <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2">
                <select
                  value={createType}
                  onChange={(e) => setCreateType(e.target.value as WordType)}
                  className="bg-transparent border theme-border rounded px-2 py-2 font-mono text-xs"
                >
                  <option value="note">note</option>
                  <option value="blog">blog</option>
                  <option value="recipe">recipe</option>
                  <option value="review">review</option>
                </select>
                <select
                  value={createVisibility}
                  onChange={(e) => setCreateVisibility(e.target.value as NoteVisibility)}
                  className="bg-transparent border theme-border rounded px-2 py-2 font-mono text-xs"
                >
                  <option value="private">private</option>
                  <option value="unlisted">unlisted</option>
                  <option value="public">public</option>
                </select>
                <button
                  type="button"
                  onClick={() => setCreateFeatured((v) => !v)}
                  className={featuredButtonClass(createFeatured)}
                  aria-pressed={createFeatured}
                >
                  featured
                </button>
              </div>
            </div>
            <textarea
              value={createMarkdown}
              onChange={(e) => setCreateMarkdown(e.target.value)}
              placeholder="markdown"
              rows={8}
              className="w-full bg-transparent border theme-border rounded px-3 py-2 font-mono text-xs"
            />
            <button
              type="button"
              onClick={() => void createWord()}
              disabled={busy}
              className="font-mono text-xs px-3 py-2 rounded border theme-border"
            >
              {busy ? "working..." : "create word"}
            </button>
          </div>

          {selected ? (
            <div className="border theme-border rounded-md p-4 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-mono text-xs theme-muted">edit · {selected.slug}</h2>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setShowPreview((v) => !v)}
                    className="font-mono text-xs underline"
                  >
                    {showPreview ? "edit mode" : "preview"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteCurrentWord()}
                    className="font-mono text-xs text-[var(--prose-hashtag)]"
                  >
                    delete
                  </button>
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <input
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="bg-transparent border-b theme-border outline-none font-mono text-sm py-2"
                />
                <input
                  value={editSubtitle}
                  onChange={(e) => setEditSubtitle(e.target.value)}
                  placeholder="subtitle"
                  className="bg-transparent border-b theme-border outline-none font-mono text-sm py-2"
                />
                <input
                  value={editImage}
                  onChange={(e) => setEditImage(e.target.value)}
                  placeholder="hero image path (optional: words/media/... or words/assets/...)"
                  className="bg-transparent border-b theme-border outline-none font-mono text-sm py-2"
                />
                <input
                  value={editTags}
                  onChange={(e) => setEditTags(e.target.value)}
                  placeholder="tags (comma-separated)"
                  className="bg-transparent border-b theme-border outline-none font-mono text-sm py-2"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2">
                <select
                  value={editType}
                  onChange={(e) => setEditType(e.target.value as WordType)}
                  className="bg-transparent border theme-border rounded px-2 py-2 font-mono text-xs"
                >
                  <option value="note">note</option>
                  <option value="blog">blog</option>
                  <option value="recipe">recipe</option>
                  <option value="review">review</option>
                </select>
                <select
                  value={editVisibility}
                  onChange={(e) => setEditVisibility(e.target.value as NoteVisibility)}
                  className="bg-transparent border theme-border rounded px-2 py-2 font-mono text-xs"
                >
                  <option value="private">private</option>
                  <option value="unlisted">unlisted</option>
                  <option value="public">public</option>
                </select>
                <button
                  type="button"
                  onClick={() => setEditFeatured((v) => !v)}
                  className={featuredButtonClass(editFeatured)}
                  aria-pressed={editFeatured}
                >
                  featured
                </button>
              </div>

              <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
                <div className="space-y-3">
                  {showPreview ? (
                    <div className="border theme-border rounded p-3 prose-blog font-serif">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{editMarkdown}</ReactMarkdown>
                    </div>
                  ) : (
                    <textarea
                      value={editMarkdown}
                      onChange={(e) => setEditMarkdown(e.target.value)}
                      rows={14}
                      className="w-full bg-transparent border theme-border rounded px-3 py-2 font-mono text-xs"
                    />
                  )}

                  <button
                    type="button"
                    onClick={() => void saveWord()}
                    disabled={busy}
                    className="font-mono text-xs px-3 py-2 rounded border theme-border"
                  >
                    {busy ? "saving..." : "save word"}
                  </button>
                </div>

                <aside className="border theme-border rounded-md p-3 space-y-3 h-fit max-h-[720px] overflow-auto">
                  <div className="flex items-center justify-between">
                    <h3 className="font-mono text-xs theme-muted">media library</h3>
                    <button
                      type="button"
                      className="font-mono text-xs underline"
                      onClick={() => {
                        if (selectedSlug) void loadWordMedia(selectedSlug, true);
                      }}
                    >
                      refresh
                    </button>
                  </div>
                  <input
                    value={mediaSearchQuery}
                    onChange={(e) => setMediaSearchQuery(e.target.value)}
                    placeholder="search files or asset id"
                    className="w-full bg-transparent border-b theme-border outline-none font-mono text-xs py-2"
                  />
                  {mediaLoading ? <p className="font-mono text-xs theme-muted">loading media...</p> : null}
                  {mediaError ? <p className="font-mono text-xs text-[var(--prose-hashtag)]">{mediaError}</p> : null}

                  <div className="space-y-2">
                    <p className="font-mono text-xs theme-muted">
                      this page ({filteredPageMedia.length})
                    </p>
                    {filteredPageMedia.length === 0 ? (
                      <p className="font-mono text-micro theme-faint">no media files for this slug</p>
                    ) : (
                      filteredPageMedia.map((item) => (
                        <div key={item.key} className="border theme-border rounded p-2 space-y-1">
                          <p className="font-mono text-xs truncate">{item.filename}</p>
                          <p className="font-mono text-micro theme-faint">{formatBytes(item.size)}</p>
                          <code className="font-mono text-micro theme-muted block truncate">{item.markdown}</code>
                          <div className="flex items-center gap-3 font-mono text-micro">
                            <button
                              type="button"
                              className="underline"
                              onClick={() => void copySnippet(item.markdown, `media-${item.key}`)}
                            >
                              {mediaCopied === `media-${item.key}` ? "copied" : "copy"}
                            </button>
                            <button
                              type="button"
                              className="underline"
                              onClick={() => appendSnippet(item.markdown)}
                            >
                              append
                            </button>
                            {item.shortMarkdown ? (
                              <button
                                type="button"
                                className="underline"
                                onClick={() =>
                                  void copySnippet(item.shortMarkdown ?? "", `media-short-${item.key}`)
                                }
                              >
                                {mediaCopied === `media-short-${item.key}` ? "copied short" : "copy short"}
                              </button>
                            ) : null}
                            {item.shortMarkdown ? (
                              <button
                                type="button"
                                className="underline"
                                onClick={() => appendSnippet(item.shortMarkdown ?? "")}
                              >
                                append short
                              </button>
                            ) : null}
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="space-y-2">
                    <p className="font-mono text-xs theme-muted">
                      shared assets ({filteredSharedAssets.length})
                    </p>
                    {filteredSharedAssets.length === 0 ? (
                      <p className="font-mono text-micro theme-faint">no shared assets yet</p>
                    ) : (
                      filteredSharedAssets.map((item) => (
                        <div key={item.key} className="border theme-border rounded p-2 space-y-1">
                          <p className="font-mono text-xs truncate">
                            {item.assetId ? `${item.assetId}/` : ""}{item.filename}
                          </p>
                          <p className="font-mono text-micro theme-faint">{formatBytes(item.size)}</p>
                          <code className="font-mono text-micro theme-muted block truncate">{item.markdown}</code>
                          <div className="flex items-center gap-3 font-mono text-micro">
                            <button
                              type="button"
                              className="underline"
                              onClick={() => void copySnippet(item.markdown, `asset-${item.key}`)}
                            >
                              {mediaCopied === `asset-${item.key}` ? "copied" : "copy"}
                            </button>
                            <button
                              type="button"
                              className="underline"
                              onClick={() => appendSnippet(item.markdown)}
                            >
                              append
                            </button>
                            {item.shortMarkdown ? (
                              <button
                                type="button"
                                className="underline"
                                onClick={() =>
                                  void copySnippet(item.shortMarkdown ?? "", `asset-short-${item.key}`)
                                }
                              >
                                {mediaCopied === `asset-short-${item.key}` ? "copied short" : "copy short"}
                              </button>
                            ) : null}
                            {item.shortMarkdown ? (
                              <button
                                type="button"
                                className="underline"
                                onClick={() => appendSnippet(item.shortMarkdown ?? "")}
                              >
                                append short
                              </button>
                            ) : null}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </aside>
              </div>
            </div>
          ) : null}

          {selected ? (
            <div className="border theme-border rounded-md p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="font-mono text-xs theme-muted">share links</h2>
                <div className="flex items-center gap-2">
                  <label className="font-mono text-micro theme-muted" htmlFor="share-expiry-days">
                    expires
                  </label>
                  <select
                    id="share-expiry-days"
                    value={newShareExpiryDays}
                    onChange={(e) => setNewShareExpiryDays(Number(e.target.value))}
                    className="font-mono text-xs bg-transparent border theme-border rounded px-2 py-1"
                  >
                    {SHARE_EXPIRY_OPTIONS.map((days) => (
                      <option key={days} value={days}>
                        {days}d
                      </option>
                    ))}
                  </select>
                  <button type="button" onClick={() => void createShare()} className="font-mono text-xs underline">
                    create share link
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {(["all", "active", "expired", "revoked"] as const).map((state) => (
                  <button
                    key={state}
                    type="button"
                    onClick={() => setShareStateFilter(state)}
                    className={`font-mono text-xs px-2 py-1 rounded border transition-colors ${
                      shareStateFilter === state
                        ? "border-[var(--foreground)] text-[var(--foreground)]"
                        : "theme-border theme-muted hover:text-[var(--foreground)]"
                    }`}
                  >
                    {state}
                  </button>
                ))}
              </div>
              <div className="space-y-2">
                {filteredShares.length === 0 ? (
                  <p className="font-mono text-xs theme-muted">
                    {shares.length === 0 ? "no share links" : "no links match this filter"}
                  </p>
                ) : (
                  filteredShares.map((link) => {
                    const isExpired = isExpiredShare(link);
                    const isRevoked = !!link.revokedAt;
                    const canManagePin = !isExpired && !isRevoked;
                    const statusLabel = isRevoked ? "revoked" : isExpired ? "expired" : "active";
                    return (
                      <div key={link.id} className="border theme-border rounded p-3">
                        <p className="font-mono text-xs">{link.id}</p>
                        <p className="font-mono text-micro theme-muted mt-1">
                          expires {new Date(link.expiresAt).toLocaleString()} · {statusLabel} ·{" "}
                          {link.pinRequired ? "pin on" : "pin off"}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-3 font-mono text-xs">
                          {!isRevoked && (
                            <button type="button" onClick={() => void copyShareLink(link)} className="underline">
                              copy link
                            </button>
                          )}
                          {!isRevoked && (
                            <button type="button" onClick={() => void rotateShare(link, "rotate")} className="underline">
                              reissue url
                            </button>
                          )}
                          {!isRevoked && (
                            <button type="button" onClick={() => void extendShare(link)} className="underline">
                              extend
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => void toggleSharePin(link)}
                            disabled={!canManagePin}
                            className="underline disabled:no-underline disabled:opacity-50"
                            title={
                              canManagePin ? undefined : "PIN can only be changed while the link is active."
                            }
                          >
                            {link.pinRequired ? "remove pin" : "require pin"}
                          </button>
                          {!isRevoked && (
                            <button
                              type="button"
                              onClick={() => void revokeShare(link)}
                              className="text-[var(--prose-hashtag)]"
                            >
                              revoke
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
