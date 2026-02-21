"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { MediaPreviewModal } from "./_components/MediaPreviewModal";
import { EditorFiltersPanel } from "./_components/EditorFiltersPanel";
import { EditorResultsList } from "./_components/EditorResultsList";
import { WordCreateForm } from "./_components/WordCreateForm";
import { WordEditSection } from "./_components/WordEditSection";
import { WordShareSection } from "./_components/WordShareSection";
import { useEditorFilters } from "./_hooks/useEditorFilters";
import { useWordFormState } from "./_hooks/useWordFormState";
import { useMediaPreviewState } from "./_hooks/useMediaPreviewState";
import { buildWordShareUrl } from "@/features/words/routes";
import type {
  NoteMeta,
  NoteVisibility,
  NoteRecord,
  ShareLink,
  SharePatchResponse,
  ShareStateFilter,
  SharedWordSummary,
  WordMediaItem,
  WordMediaResponse,
} from "./types";

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
  const [activeShareCountBySlug, setActiveShareCountBySlug] = useState<Record<string, number>>({});
  const [pageMedia, setPageMedia] = useState<WordMediaItem[]>([]);
  const [sharedAssets, setSharedAssets] = useState<WordMediaItem[]>([]);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [mediaError, setMediaError] = useState("");
  const [mediaCopied, setMediaCopied] = useState<string | null>(null);
  const [assetsHydrated, setAssetsHydrated] = useState(false);
  const {
    showPreview,
    setShowPreview,
    newShareExpiryDays,
    setNewShareExpiryDays,
    shareStateFilter,
    setShareStateFilter,
    searchQuery,
    setSearchQuery,
    filterType,
    setFilterType,
    filterVisibility,
    setFilterVisibility,
    filterTag,
    setFilterTag,
    mediaSearchQuery,
    setMediaSearchQuery,
    clearFilters,
  } = useEditorFilters();
  const {
    createSlug,
    setCreateSlug,
    createTitle,
    setCreateTitle,
    createSubtitle,
    setCreateSubtitle,
    createImage,
    setCreateImage,
    createType,
    setCreateType,
    createVisibility,
    setCreateVisibility,
    createTags,
    setCreateTags,
    createFeatured,
    setCreateFeatured,
    createMarkdown,
    setCreateMarkdown,
    editTitle,
    setEditTitle,
    editSubtitle,
    setEditSubtitle,
    editImage,
    setEditImage,
    editType,
    setEditType,
    editVisibility,
    setEditVisibility,
    editTags,
    setEditTags,
    editFeatured,
    setEditFeatured,
    editMarkdown,
    setEditMarkdown,
    parseTags,
    resetCreateForm,
    setEditFromRecord,
    appendSnippet,
  } = useWordFormState();
  const {
    previewItems,
    previewIndex,
    setPreviewIndex,
    closePreview,
    openPreview,
    hasPreview,
  } = useMediaPreviewState();

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

      const res = await fetch(`/api/words?${params.toString()}`);
      const data = (await res.json().catch(() => ({}))) as { words?: NoteMeta[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to load words");
      setNotes(data.words ?? []);
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

  const handleAppendSnippet = useCallback((snippet: string) => {
    appendSnippet(snippet);
    setStatus("snippet appended");
  }, [appendSnippet]);

  const loadWord = useCallback(async (slug: string) => {
    if (!slug) return;
    setBusy(true);
    setError("");
    try {
      const [noteRes, sharesRes] = await Promise.all([
        fetch(`/api/words/${encodeURIComponent(slug)}`),
        fetch(`/api/words/${encodeURIComponent(slug)}/shares`),
      ]);
      const noteData = (await noteRes.json().catch(() => ({}))) as NoteRecord & { error?: string };
      const shareData = (await sharesRes.json().catch(() => ({}))) as { links?: ShareLink[]; error?: string };

      if (!noteRes.ok) throw new Error(noteData.error ?? "Failed to load word");
      if (!sharesRes.ok) throw new Error(shareData.error ?? "Failed to load share links");

      setCurrent(noteData);
      setEditFromRecord(noteData);
      setShares(shareData.links ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load word");
    } finally {
      setBusy(false);
    }
  }, [setEditFromRecord]);

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
  const visibilityBySlug = useMemo(() => {
    const next: Record<string, NoteVisibility> = {};
    for (const note of notes) {
      next[note.slug] = note.visibility;
    }
    if (current?.meta?.slug) {
      next[current.meta.slug] = current.meta.visibility;
    }
    return next;
  }, [current?.meta?.slug, current?.meta?.visibility, notes]);

  const buildShareUrl = useCallback(
    (slug: string, token: string) => {
      const visibility = visibilityBySlug[slug] ?? "private";
      return buildWordShareUrl(window.location.origin, slug, token, visibility);
    },
    [visibilityBySlug]
  );

  async function createWord() {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const res = await fetch("/api/words", {
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
      resetCreateForm();

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
      const res = await fetch(`/api/words/${encodeURIComponent(selectedSlug)}`, {
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
      const res = await fetch(`/api/words/${encodeURIComponent(selectedSlug)}`, {
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
      const res = await fetch(`/api/words/${encodeURIComponent(selectedSlug)}/shares`, {
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
        `/api/words/${encodeURIComponent(link.slug)}/shares/${encodeURIComponent(link.id)}`,
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
        `/api/words/${encodeURIComponent(link.slug)}/shares/${encodeURIComponent(link.id)}`,
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
        `/api/words/${encodeURIComponent(link.slug)}/shares/${encodeURIComponent(link.id)}`,
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
        `/api/words/${encodeURIComponent(link.slug)}/shares/${encodeURIComponent(link.id)}`,
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

      <EditorFiltersPanel
        searchQuery={searchQuery}
        filterType={filterType}
        filterVisibility={filterVisibility}
        filterTag={filterTag}
        onSearchQueryChange={setSearchQuery}
        onFilterTypeChange={setFilterType}
        onFilterVisibilityChange={setFilterVisibility}
        onFilterTagChange={setFilterTag}
        onApply={() => void loadNotes()}
        onClear={clearFilters}
      />

      <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
        <EditorResultsList
          notes={notes}
          selectedSlug={selectedSlug}
          activeShareCountBySlug={activeShareCountBySlug}
          onSelectSlug={setSelectedSlug}
          onRefresh={() => void loadNotes()}
        />

        <section className="space-y-6">
          <WordCreateForm
            createSlug={createSlug}
            createTitle={createTitle}
            createSubtitle={createSubtitle}
            createImage={createImage}
            createType={createType}
            createVisibility={createVisibility}
            createTags={createTags}
            createFeatured={createFeatured}
            createMarkdown={createMarkdown}
            busy={busy}
            onCreateSlugChange={setCreateSlug}
            onCreateTitleChange={setCreateTitle}
            onCreateSubtitleChange={setCreateSubtitle}
            onCreateImageChange={setCreateImage}
            onCreateTypeChange={setCreateType}
            onCreateVisibilityChange={setCreateVisibility}
            onCreateTagsChange={setCreateTags}
            onToggleCreateFeatured={() => setCreateFeatured((value) => !value)}
            onCreateMarkdownChange={setCreateMarkdown}
            onCreate={() => void createWord()}
          />

          {selected ? (
            <WordEditSection
              selected={selected}
              selectedSlug={selectedSlug}
              showPreview={showPreview}
              editTitle={editTitle}
              editSubtitle={editSubtitle}
              editImage={editImage}
              editType={editType}
              editVisibility={editVisibility}
              editTags={editTags}
              editFeatured={editFeatured}
              editMarkdown={editMarkdown}
              busy={busy}
              mediaSearchQuery={mediaSearchQuery}
              mediaLoading={mediaLoading}
              mediaError={mediaError}
              mediaCopied={mediaCopied}
              filteredPageMedia={filteredPageMedia}
              filteredSharedAssets={filteredSharedAssets}
              onTogglePreview={() => setShowPreview((value) => !value)}
              onDelete={() => void deleteCurrentWord()}
              onEditTitleChange={setEditTitle}
              onEditSubtitleChange={setEditSubtitle}
              onEditImageChange={setEditImage}
              onEditTypeChange={setEditType}
              onEditVisibilityChange={setEditVisibility}
              onEditTagsChange={setEditTags}
              onToggleEditFeatured={() => setEditFeatured((value) => !value)}
              onEditMarkdownChange={setEditMarkdown}
              onSave={() => void saveWord()}
              onMediaSearchQueryChange={setMediaSearchQuery}
              onRefreshMedia={(slug) => void loadWordMedia(slug, true)}
              onPreviewMedia={openPreview}
              onCopySnippet={(snippet, copyId) => void copySnippet(snippet, copyId)}
              onAppendSnippet={handleAppendSnippet}
            />
          ) : null}

          {selected ? (
            <WordShareSection
              shares={shares}
              filteredShares={filteredShares}
              shareStateFilter={shareStateFilter}
              newShareExpiryDays={newShareExpiryDays}
              shareExpiryOptions={SHARE_EXPIRY_OPTIONS}
              onShareStateFilterChange={setShareStateFilter}
              onNewShareExpiryDaysChange={setNewShareExpiryDays}
              onCreateShare={() => void createShare()}
              onCopyShareLink={(link) => void copyShareLink(link)}
              onRotateShare={(link) => void rotateShare(link, "rotate")}
              onExtendShare={(link) => void extendShare(link)}
              onToggleSharePin={(link) => void toggleSharePin(link)}
              onRevokeShare={(link) => void revokeShare(link)}
            />
          ) : null}
        </section>
      </div>

      {hasPreview && previewIndex !== null ? (
        <MediaPreviewModal
          items={previewItems}
          index={previewIndex}
          onClose={closePreview}
          onIndexChange={setPreviewIndex}
        />
      ) : null}
    </div>
  );
}
