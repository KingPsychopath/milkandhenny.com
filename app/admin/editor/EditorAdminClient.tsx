"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
const AUTOSAVE_DEBOUNCE_MS = 1200;
const EDITOR_DRAFT_KEY_PREFIX = "mah-admin-editor-draft:";

type WordSavePayload = {
  title: string;
  subtitle?: string;
  image?: string;
  type: NoteMeta["type"];
  visibility: NoteVisibility;
  tags: string[];
  featured: boolean;
  markdown: string;
};

type LocalEditorDraft = {
  version: 1;
  slug: string;
  savedAt: string;
  payload: WordSavePayload;
};

type MobileEditorPanel = "create" | "edit" | "share";

function editorDraftKey(slug: string): string {
  return `${EDITOR_DRAFT_KEY_PREFIX}${slug}`;
}

function readEditorDraft(slug: string): LocalEditorDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(editorDraftKey(slug));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LocalEditorDraft>;
    if (
      parsed.version !== 1 ||
      parsed.slug !== slug ||
      typeof parsed.savedAt !== "string" ||
      !parsed.payload ||
      typeof parsed.payload !== "object" ||
      typeof parsed.payload.title !== "string" ||
      typeof parsed.payload.type !== "string" ||
      typeof parsed.payload.visibility !== "string" ||
      !Array.isArray(parsed.payload.tags) ||
      typeof parsed.payload.featured !== "boolean" ||
      typeof parsed.payload.markdown !== "string"
    ) {
      return null;
    }
    return {
      version: 1,
      slug,
      savedAt: parsed.savedAt,
      payload: {
        title: parsed.payload.title,
        subtitle: typeof parsed.payload.subtitle === "string" ? parsed.payload.subtitle : undefined,
        image: typeof parsed.payload.image === "string" ? parsed.payload.image : undefined,
        type: parsed.payload.type as NoteMeta["type"],
        visibility: parsed.payload.visibility as NoteVisibility,
        tags: parsed.payload.tags.filter((tag): tag is string => typeof tag === "string"),
        featured: parsed.payload.featured,
        markdown: parsed.payload.markdown,
      },
    };
  } catch {
    return null;
  }
}

function writeEditorDraft(slug: string, payload: WordSavePayload): void {
  if (typeof window === "undefined") return;
  try {
    const draft: LocalEditorDraft = {
      version: 1,
      slug,
      savedAt: new Date().toISOString(),
      payload,
    };
    window.localStorage.setItem(editorDraftKey(slug), JSON.stringify(draft));
  } catch {
    // Best-effort fallback only.
  }
}

function deleteEditorDraft(slug: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(editorDraftKey(slug));
  } catch {
    // Ignore storage failures.
  }
}

function sameWordSavePayload(a: WordSavePayload, b: WordSavePayload): boolean {
  return (
    a.title === b.title &&
    (a.subtitle ?? "") === (b.subtitle ?? "") &&
    (a.image ?? "") === (b.image ?? "") &&
    a.type === b.type &&
    a.visibility === b.visibility &&
    a.featured === b.featured &&
    a.markdown === b.markdown &&
    a.tags.length === b.tags.length &&
    a.tags.every((tag, index) => tag === b.tags[index])
  );
}

function payloadFromNote(record: NoteRecord): WordSavePayload {
  return {
    title: record.meta.title,
    subtitle: record.meta.subtitle || undefined,
    image: record.meta.image || undefined,
    type: record.meta.type,
    visibility: record.meta.visibility,
    tags: [...record.meta.tags],
    featured: !!record.meta.featured,
    markdown: record.markdown,
  };
}

export function EditorAdminClient() {
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [selectedSlug, setSelectedSlug] = useState("");
  const [current, setCurrent] = useState<NoteRecord | null>(null);
  const [shares, setShares] = useState<ShareLink[]>([]);
  const [shareTokensById, setShareTokensById] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [mobileEditorPanel, setMobileEditorPanel] = useState<MobileEditorPanel>("create");
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
  const [autosavePhase, setAutosavePhase] = useState<
    "idle" | "dirty" | "saving" | "saved" | "error" | "restored"
  >("idle");
  const [autosaveError, setAutosaveError] = useState("");
  const [autosaveSavedAt, setAutosaveSavedAt] = useState<string | null>(null);
  const autosaveTimerRef = useRef<number | null>(null);
  const autosaveSavingRef = useRef(false);
  const restoredDraftKeyRef = useRef<string>("");

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
  const hasLoadedSelected = !!current && current.meta.slug === selectedSlug;

  const editPayload = useMemo<WordSavePayload | null>(() => {
    if (!selectedSlug || !hasLoadedSelected) return null;
    return {
      title: editTitle,
      subtitle: editSubtitle.trim() ? editSubtitle : undefined,
      image: editImage.trim() ? editImage : undefined,
      type: editType,
      visibility: editVisibility,
      tags: parseTags(editTags),
      featured: editFeatured,
      markdown: editMarkdown,
    };
  }, [
    editFeatured,
    editImage,
    editMarkdown,
    editSubtitle,
    editTags,
    editTitle,
    editType,
    editVisibility,
    hasLoadedSelected,
    parseTags,
    selectedSlug,
  ]);

  const currentPayload = useMemo(
    () => (current && current.meta.slug === selectedSlug ? payloadFromNote(current) : null),
    [current, selectedSlug]
  );

  const isEditDirty = useMemo(() => {
    if (!editPayload || !currentPayload) return false;
    return !sameWordSavePayload(editPayload, currentPayload);
  }, [currentPayload, editPayload]);

  const autosaveStatusText = useMemo(() => {
    if (!selectedSlug) return "select a word to edit";
    if (autosavePhase === "saving") return "saving local draft...";
    if (autosavePhase === "error") return autosaveError || "draft save issue (stored locally)";
    if (autosavePhase === "restored") return "restored local draft";
    if (autosavePhase === "saved" && autosaveSavedAt) {
      const time = new Date(autosaveSavedAt).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      return `draft autosaved locally at ${time}`;
    }
    if (isEditDirty) return "local draft pending";
    return "live version saved";
  }, [autosaveError, autosavePhase, autosaveSavedAt, isEditDirty, selectedSlug]);

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

  const clearAutosaveTimer = useCallback(() => {
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
  }, []);

  const applySavedWord = useCallback(
    (updated: NoteRecord, syncForm: boolean) => {
      setCurrent(updated);
      setNotes((prev) =>
        prev.map((note) => (note.slug === updated.meta.slug ? updated.meta : note))
      );
      if (syncForm && selectedSlug === updated.meta.slug) {
        setEditFromRecord(updated);
      }
    },
    [selectedSlug, setEditFromRecord]
  );

  const saveWordToApi = useCallback(
    async () => {
      const slug = selectedSlug;
      if (!slug || !editPayload) return false;
      setBusy(true);
      setError("");
      setStatus("");
      setAutosaveError("");

      try {
        const expectedUpdatedAt =
          current && current.meta.slug === slug ? current.meta.updatedAt : undefined;
        const res = await fetch(`/api/words/${encodeURIComponent(slug)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...editPayload,
            ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
          }),
        });
        const data = (await res.json().catch(() => ({}))) as
          (NoteRecord & { error?: string; conflict?: boolean; currentUpdatedAt?: string });
        if (!res.ok) {
          if (res.status === 409 || data.conflict) {
            const conflictMessage =
              data.error ??
              "Save blocked: this word changed in another tab/session. Reload to review latest changes before publishing.";
            setAutosaveError(conflictMessage);
            setAutosavePhase("error");
            throw new Error(conflictMessage);
          }
          throw new Error(data.error ?? "Failed to save word");
        }

        applySavedWord(data, true);
        deleteEditorDraft(slug);
        restoredDraftKeyRef.current = "";
        setStatus("changes published");
        setAutosaveSavedAt(new Date().toISOString());
        setAutosavePhase("saved");
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to save word";
        setError(message);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [applySavedWord, current, editPayload, selectedSlug]
  );

  const requestAutosave = useCallback(
    (kind: "debounced" | "immediate" = "debounced") => {
      if (!hasLoadedSelected || !isEditDirty || !selectedSlug || !editPayload) return;
      clearAutosaveTimer();

      const run = () => {
        setAutosavePhase("saving");
        writeEditorDraft(selectedSlug, editPayload);
        setAutosaveSavedAt(new Date().toISOString());
        setAutosaveError("");
        setAutosavePhase("saved");
      };

      if (kind === "immediate") {
        run();
        return;
      }

      setAutosavePhase((prev) => (prev === "error" ? prev : "dirty"));
      autosaveTimerRef.current = window.setTimeout(run, AUTOSAVE_DEBOUNCE_MS);
    },
    [
      clearAutosaveTimer,
      editPayload,
      hasLoadedSelected,
      isEditDirty,
      selectedSlug,
    ]
  );

  async function saveWord() {
    clearAutosaveTimer();
    await saveWordToApi();
  }

  useEffect(() => {
    if (!selectedSlug || !hasLoadedSelected || !currentPayload) return;
    const draft = readEditorDraft(selectedSlug);
    if (!draft) return;
    const draftKey = `${draft.slug}:${draft.savedAt}`;
    if (restoredDraftKeyRef.current === draftKey) return;
    if (!sameWordSavePayload(draft.payload, currentPayload)) {
      setEditTitle(draft.payload.title);
      setEditSubtitle(draft.payload.subtitle ?? "");
      setEditImage(draft.payload.image ?? "");
      setEditType(draft.payload.type);
      setEditVisibility(draft.payload.visibility);
      setEditTags(draft.payload.tags.join(", "));
      setEditFeatured(draft.payload.featured);
      setEditMarkdown(draft.payload.markdown);
      setAutosavePhase("restored");
    }
    restoredDraftKeyRef.current = draftKey;
  }, [
    currentPayload,
    hasLoadedSelected,
    selectedSlug,
    setEditFeatured,
    setEditImage,
    setEditMarkdown,
    setEditSubtitle,
    setEditTags,
    setEditTitle,
    setEditType,
    setEditVisibility,
  ]);

  useEffect(() => {
    if (!selectedSlug || !hasLoadedSelected || !editPayload) return;
    if (isEditDirty) {
      writeEditorDraft(selectedSlug, editPayload);
    } else {
      deleteEditorDraft(selectedSlug);
      if (autosavePhase !== "saved" && autosavePhase !== "restored") {
        setAutosavePhase("idle");
      }
      setAutosaveError("");
    }
  }, [autosavePhase, editPayload, hasLoadedSelected, isEditDirty, selectedSlug]);

  useEffect(() => {
    if (!selectedSlug || !hasLoadedSelected) return;
    if (!isEditDirty || busy) {
      if (!isEditDirty) clearAutosaveTimer();
      return;
    }
    requestAutosave("debounced");
    return () => {
      clearAutosaveTimer();
    };
  }, [busy, clearAutosaveTimer, hasLoadedSelected, isEditDirty, requestAutosave, selectedSlug]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") return;
      if (!selectedSlug) return;
      event.preventDefault();
      void saveWord();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [saveWord, selectedSlug]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden" && isEditDirty) {
        requestAutosave("immediate");
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [isEditDirty, requestAutosave]);

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isEditDirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isEditDirty]);

  const handleSelectSlug = useCallback(
    (slug: string) => {
      if (slug === selectedSlug) return;
      if (isEditDirty) requestAutosave("immediate");
      setMobileEditorPanel("edit");
      setSelectedSlug(slug);
    },
    [isEditDirty, requestAutosave, selectedSlug]
  );

  useEffect(() => {
    if (!selectedSlug) {
      setMobileEditorPanel("create");
    }
  }, [selectedSlug]);

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
          onSelectSlug={handleSelectSlug}
          onRefresh={() => void loadNotes()}
        />

        <section className="space-y-6">
          <div className="sm:hidden">
            <div className="rounded-md border theme-border p-1 flex gap-1">
              <button
                type="button"
                onClick={() => setMobileEditorPanel("create")}
                className={`flex-1 min-h-10 rounded font-mono text-xs transition-colors ${
                  mobileEditorPanel === "create"
                    ? "border border-[var(--foreground)] text-[var(--foreground)]"
                    : "theme-muted hover:text-[var(--foreground)]"
                }`}
                aria-pressed={mobileEditorPanel === "create"}
              >
                create
              </button>
              <button
                type="button"
                onClick={() => selected && setMobileEditorPanel("edit")}
                disabled={!selected}
                className={`flex-1 min-h-10 rounded font-mono text-xs transition-colors disabled:opacity-40 ${
                  mobileEditorPanel === "edit"
                    ? "border border-[var(--foreground)] text-[var(--foreground)]"
                    : "theme-muted hover:text-[var(--foreground)]"
                }`}
                aria-pressed={mobileEditorPanel === "edit"}
              >
                edit
              </button>
              <button
                type="button"
                onClick={() => selected && setMobileEditorPanel("share")}
                disabled={!selected}
                className={`flex-1 min-h-10 rounded font-mono text-xs transition-colors disabled:opacity-40 ${
                  mobileEditorPanel === "share"
                    ? "border border-[var(--foreground)] text-[var(--foreground)]"
                    : "theme-muted hover:text-[var(--foreground)]"
                }`}
                aria-pressed={mobileEditorPanel === "share"}
              >
                share
              </button>
            </div>
          </div>

          <div className={mobileEditorPanel === "create" ? "block" : "hidden sm:block"}>
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
          </div>

          {selected ? (
            <div className={mobileEditorPanel === "edit" ? "block" : "hidden sm:block"}>
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
                hasUnsavedChanges={isEditDirty}
                autosaveStatusText={autosaveStatusText}
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
                onFieldBlur={() => requestAutosave("immediate")}
                onMediaSearchQueryChange={setMediaSearchQuery}
                onRefreshMedia={(slug) => void loadWordMedia(slug, true)}
                onPreviewMedia={openPreview}
                onCopySnippet={(snippet, copyId) => void copySnippet(snippet, copyId)}
                onAppendSnippet={handleAppendSnippet}
              />
            </div>
          ) : null}

          {selected ? (
            <div className={mobileEditorPanel === "share" ? "block" : "hidden sm:block"}>
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
            </div>
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
