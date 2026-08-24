import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Album, Photo } from "@/features/media/albums";
import { useActionDialog } from "@/hooks/useActionDialog";
import { copyText } from "@/lib/client/share";
import { AlbumPhotoGrid, type PhotoDraft } from "./AlbumPhotoGrid";

type StepUpResult =
  | { ok: true; token: string }
  | { ok: false; cancelled: true }
  | { ok: false; error: string };

interface AlbumManagerPanelProps {
  authFetch: (url: string, options?: RequestInit) => Promise<Response>;
  ensureStepUpToken: () => Promise<StepUpResult>;
  withStepUpHeaders: (token: string, extra?: Record<string, string>) => Record<string, string>;
  onChanged?: () => void;
}

interface PreparedUpload {
  original: string;
  photoId: string;
  uploadKey: string;
  url: string;
  contentType: string;
}

const EMPTY_PHOTO_DRAFT: PhotoDraft = { title: "", alt: "", caption: "", focalPoint: "" };
const fieldClass =
  "w-full border-b theme-border bg-transparent py-2 font-mono text-xs outline-none focus:border-[var(--foreground)]";

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function readError(data: unknown, fallback: string): string {
  return data && typeof data === "object" && "error" in data && typeof data.error === "string"
    ? data.error
    : fallback;
}

function reorder(photos: Photo[], sourceId: string, targetId: string): Photo[] {
  const from = photos.findIndex((photo) => photo.id === sourceId);
  const to = photos.findIndex((photo) => photo.id === targetId);
  if (from < 0 || to < 0 || from === to) return photos;
  const next = [...photos];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

async function putWithRetry(file: File, upload: PreparedUpload): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(upload.url, {
        method: "PUT",
        headers: { "Content-Type": upload.contentType },
        body: file,
      });
      if (response.ok) return;
      if (response.status < 500 || attempt === 2) {
        throw new Error(`Storage rejected ${file.name} (${response.status})`);
      }
    } catch (error) {
      lastError = error;
      if (attempt === 2) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt));
  }
  throw lastError instanceof Error ? lastError : new Error(`Failed to upload ${file.name}`);
}

export function AlbumManagerPanel({
  authFetch,
  ensureStepUpToken,
  withStepUpHeaders,
  onChanged,
}: AlbumManagerPanelProps) {
  const { confirm, dialog } = useActionDialog();
  const [albums, setAlbums] = useState<Album[]>([]);
  const [selectedSlug, setSelectedSlug] = useState("");
  const [query, setQuery] = useState("");
  const [photoQuery, setPhotoQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [photoDraft, setPhotoDraft] = useState<PhotoDraft>(EMPTY_PHOTO_DRAFT);
  const [createOpen, setCreateOpen] = useState(false);
  const [createTitle, setCreateTitle] = useState("");
  const [createSlug, setCreateSlug] = useState("");
  const [createDate, setCreateDate] = useState(new Date().toISOString().slice(0, 10));
  const [createDescription, setCreateDescription] = useState("");
  const [metaTitle, setMetaTitle] = useState("");
  const [metaDate, setMetaDate] = useState("");
  const [metaDescription, setMetaDescription] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const selectedAlbum = albums.find((album) => album.slug === selectedSlug) ?? null;
  const visibleAlbums = useMemo(() => {
    const term = query.trim().toLowerCase();
    return term
      ? albums.filter(
          (album) =>
            album.title.toLowerCase().includes(term) || album.slug.toLowerCase().includes(term),
        )
      : albums;
  }, [albums, query]);
  const visiblePhotos = useMemo(() => {
    if (!selectedAlbum) return [];
    const term = photoQuery.trim().toLowerCase();
    return term
      ? selectedAlbum.photos.filter((photo) =>
          [photo.id, photo.title, photo.alt, photo.caption].some((value) =>
            value?.toLowerCase().includes(term),
          ),
        )
      : selectedAlbum.photos;
  }, [photoQuery, selectedAlbum]);

  const loadAlbums = useCallback(
    async (keepSlug?: string) => {
      setLoading(true);
      setError("");
      try {
        const response = await authFetch("/api/admin/albums");
        const data = (await response.json().catch(() => ({}))) as { albums?: Album[] };
        if (!response.ok) throw new Error(readError(data, "Failed to load albums"));
        const next = Array.isArray(data.albums) ? data.albums : [];
        setAlbums(next);
        const preferred = keepSlug;
        setSelectedSlug(
          preferred && next.some((album) => album.slug === preferred)
            ? preferred
            : (next[0]?.slug ?? ""),
        );
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Failed to load albums");
      } finally {
        setLoading(false);
      }
    },
    [authFetch],
  );

  useEffect(() => {
    void loadAlbums();
  }, [loadAlbums]);

  useEffect(() => {
    if (!selectedAlbum) return;
    setMetaTitle(selectedAlbum.title);
    setMetaDate(selectedAlbum.date);
    setMetaDescription(selectedAlbum.description ?? "");
    setSelectedIds(new Set());
    setEditingId(null);
    setPhotoQuery("");
  }, [selectedAlbum]);

  const replaceAlbum = (album: Album) => {
    setAlbums((current) => current.map((item) => (item.slug === album.slug ? album : item)));
  };

  const mutate = async (url: string, options: RequestInit, fallback: string): Promise<Album> => {
    const response = await authFetch(url, options);
    const data = (await response.json().catch(() => ({}))) as { album?: Album };
    if (!response.ok || !data.album) throw new Error(readError(data, fallback));
    replaceAlbum(data.album);
    onChanged?.();
    return data.album;
  };

  const handleCreate = async () => {
    setBusy("create");
    setError("");
    setStatus("");
    try {
      const response = await authFetch("/api/admin/albums", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: createSlug,
          title: createTitle,
          date: createDate,
          description: createDescription,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { album?: Album };
      if (!response.ok || !data.album) throw new Error(readError(data, "Failed to create album"));
      setAlbums((current) => [data.album!, ...current]);
      setSelectedSlug(data.album.slug);
      setCreateOpen(false);
      setCreateTitle("");
      setCreateSlug("");
      setCreateDescription("");
      setStatus(`Created “${data.album.title}”. Add photos below.`);
      onChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to create album");
    } finally {
      setBusy(null);
    }
  };

  const handleSaveMetadata = async () => {
    if (!selectedAlbum) return;
    setBusy("metadata");
    setError("");
    try {
      await mutate(
        `/api/admin/albums/${encodeURIComponent(selectedAlbum.slug)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: metaTitle,
            date: metaDate,
            description: metaDescription,
          }),
        },
        "Failed to save album",
      );
      setStatus("Album details saved.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to save album");
    } finally {
      setBusy(null);
    }
  };

  const handleStatus = async (nextStatus: "draft" | "published") => {
    if (!selectedAlbum) return;
    setBusy("status");
    setError("");
    try {
      await mutate(
        `/api/admin/albums/${encodeURIComponent(selectedAlbum.slug)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: nextStatus }),
        },
        "Failed to change album status",
      );
      setStatus(nextStatus === "published" ? "Album published." : "Album moved to drafts.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to change album status");
    } finally {
      setBusy(null);
    }
  };

  const saveOrder = async (photos: Photo[]) => {
    if (!selectedAlbum) return;
    const previous = selectedAlbum.photos;
    replaceAlbum({ ...selectedAlbum, photos });
    setBusy("order");
    setError("");
    try {
      await mutate(
        `/api/admin/albums/${encodeURIComponent(selectedAlbum.slug)}/order`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ photoIds: photos.map((photo) => photo.id) }),
        },
        "Failed to save photo order",
      );
      setStatus("Photo order saved.");
    } catch (caught) {
      replaceAlbum({ ...selectedAlbum, photos: previous });
      setError(caught instanceof Error ? caught.message : "Failed to save photo order");
    } finally {
      setBusy(null);
    }
  };

  const handleMove = (photoId: string, offset: -1 | 1) => {
    if (!selectedAlbum) return;
    const index = selectedAlbum.photos.findIndex((photo) => photo.id === photoId);
    const target = selectedAlbum.photos[index + offset];
    if (target) void saveOrder(reorder(selectedAlbum.photos, photoId, target.id));
  };

  const handleSetCover = async (photoId: string) => {
    if (!selectedAlbum) return;
    setBusy(`cover:${photoId}`);
    setError("");
    try {
      await mutate(
        `/api/admin/albums/${encodeURIComponent(selectedAlbum.slug)}/cover`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ photoId }),
        },
        "Failed to set primary photo",
      );
      setStatus("Primary photo updated.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to set primary photo");
    } finally {
      setBusy(null);
    }
  };

  const handleEditPhoto = (photo: Photo) => {
    setEditingId(photo.id);
    setPhotoDraft({
      title: photo.title ?? "",
      alt: photo.alt ?? "",
      caption: photo.caption ?? "",
      focalPoint: photo.focalPoint ?? "",
    });
  };

  const handleSavePhoto = async (photoId: string) => {
    if (!selectedAlbum) return;
    setBusy(`photo:${photoId}`);
    setError("");
    try {
      await mutate(
        `/api/admin/albums/${encodeURIComponent(selectedAlbum.slug)}/photos/${encodeURIComponent(photoId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(photoDraft),
        },
        "Failed to save photo details",
      );
      setEditingId(null);
      setStatus("Photo details saved.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to save photo details");
    } finally {
      setBusy(null);
    }
  };

  const destructiveHeaders = async (): Promise<Record<string, string> | null> => {
    const result = await ensureStepUpToken();
    if (!result.ok) {
      if ("error" in result) setError(result.error);
      return null;
    }
    return withStepUpHeaders(result.token, { "Content-Type": "application/json" });
  };

  const handleDeletePhotos = async (photoIds: string[]) => {
    if (!selectedAlbum || !photoIds.length) return;
    const approved = await confirm({
      eyebrow: "gallery manager",
      title: `Delete ${photoIds.length} photo${photoIds.length === 1 ? "" : "s"}?`,
      description: "This removes the original, every display size, and the social image.",
      confirmLabel: "delete photos",
      intent: "danger",
    });
    if (!approved) return;
    const headers = await destructiveHeaders();
    if (!headers) return;
    setBusy("delete-photos");
    setError("");
    try {
      const response = await authFetch(
        `/api/admin/albums/${encodeURIComponent(selectedAlbum.slug)}/photos`,
        { method: "DELETE", headers, body: JSON.stringify({ photoIds }) },
      );
      const data = (await response.json().catch(() => ({}))) as { album?: Album };
      if (!response.ok || !data.album) throw new Error(readError(data, "Failed to delete photos"));
      replaceAlbum(data.album);
      setSelectedIds(new Set());
      setStatus(`Deleted ${photoIds.length} photo${photoIds.length === 1 ? "" : "s"}.`);
      onChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to delete photos");
    } finally {
      setBusy(null);
    }
  };

  const handleDeleteAlbum = async () => {
    if (!selectedAlbum) return;
    const approved = await confirm({
      eyebrow: "gallery manager",
      title: `Delete “${selectedAlbum.title}”?`,
      description:
        "This removes its durable manifest and every stored photo. This cannot be undone.",
      confirmLabel: "delete album",
      intent: "danger",
    });
    if (!approved) return;
    const headers = await destructiveHeaders();
    if (!headers) return;
    setBusy("delete-album");
    setError("");
    try {
      const response = await authFetch(
        `/api/admin/albums/${encodeURIComponent(selectedAlbum.slug)}`,
        {
          method: "DELETE",
          headers,
        },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(readError(data, "Failed to delete album"));
      const remaining = albums.filter((album) => album.slug !== selectedAlbum.slug);
      setAlbums(remaining);
      setSelectedSlug(remaining[0]?.slug ?? "");
      setStatus("Album deleted.");
      onChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to delete album");
    } finally {
      setBusy(null);
    }
  };

  const handleFiles = async (fileList: File[] | FileList) => {
    if (!selectedAlbum || busy) return;
    const files = Array.from(fileList).filter(
      (file) => file.type.startsWith("image/") || file.name,
    );
    if (!files.length) return;
    setBusy("upload");
    setError("");
    setStatus(`Preparing ${files.length} image${files.length === 1 ? "" : "s"}...`);
    setUploadProgress(0);
    try {
      const presignResponse = await authFetch(
        `/api/admin/albums/${encodeURIComponent(selectedAlbum.slug)}/upload/presign`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            files: files.map((file) => ({ name: file.name, size: file.size, type: file.type })),
          }),
        },
      );
      const presignData = (await presignResponse.json().catch(() => ({}))) as {
        uploads?: PreparedUpload[];
      };
      if (!presignResponse.ok || !Array.isArray(presignData.uploads)) {
        throw new Error(readError(presignData, "Failed to prepare uploads"));
      }

      const fileBuckets = new Map<string, File[]>();
      files.forEach((file) =>
        fileBuckets.set(file.name, [...(fileBuckets.get(file.name) ?? []), file]),
      );
      let completed = 0;
      let cursor = 0;
      const worker = async () => {
        while (cursor < presignData.uploads!.length) {
          const upload = presignData.uploads![cursor++];
          const file = fileBuckets.get(upload.original)?.shift();
          if (!file) throw new Error(`Could not match ${upload.original} to a local file`);
          await putWithRetry(file, upload);
          completed++;
          setUploadProgress(Math.round((completed / presignData.uploads!.length) * 70));
        }
      };
      await Promise.all(Array.from({ length: Math.min(4, presignData.uploads.length) }, worker));
      setStatus("Processing responsive images and placeholders...");
      setUploadProgress(75);

      const finalizeResponse = await authFetch(
        `/api/admin/albums/${encodeURIComponent(selectedAlbum.slug)}/upload/finalize`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ files: presignData.uploads }),
        },
      );
      const finalizeData = (await finalizeResponse.json().catch(() => ({}))) as {
        album?: Album;
        added?: Photo[];
      };
      if (!finalizeResponse.ok || !finalizeData.album) {
        throw new Error(readError(finalizeData, "Failed to process uploads"));
      }
      replaceAlbum(finalizeData.album);
      setUploadProgress(100);
      setStatus(
        `Added ${finalizeData.added?.length ?? files.length} photo${files.length === 1 ? "" : "s"}.`,
      );
      onChanged?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Photo upload failed");
    } finally {
      setBusy(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleCopy = async (value: string, label: string) => {
    try {
      await copyText(value);
      setStatus(`${label} copied.`);
    } catch {
      setError("Clipboard write failed");
    }
  };

  return (
    <section
      id="album-manager"
      aria-labelledby="album-manager-heading"
      className="border-t theme-border pt-6 space-y-5 scroll-mt-6"
      onPaste={(event) => {
        const files = [...event.clipboardData.files];
        if (files.length) {
          event.preventDefault();
          void handleFiles(files);
        }
      }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-micro theme-subtle">content / photos</p>
          <h2 id="album-manager-heading" className="mt-1 font-serif text-2xl">
            gallery control room
          </h2>
          <p className="mt-1 max-w-xl font-mono text-xs theme-subtle">
            Durable albums, responsive images, ordering, details, covers, and publishing in one
            place.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void loadAlbums(selectedSlug)}
            disabled={loading}
            className="min-h-11 rounded-md border theme-border px-3 font-mono text-xs disabled:opacity-50"
          >
            {loading ? "refreshing..." : "refresh"}
          </button>
          <button
            type="button"
            onClick={() => setCreateOpen((open) => !open)}
            className="min-h-11 rounded-md border theme-border px-3 font-mono text-xs"
          >
            {createOpen ? "close creator" : "+ new album"}
          </button>
        </div>
      </div>

      <div aria-live="polite" className="min-h-5 font-mono text-xs">
        {error ? <p className="text-[var(--prose-hashtag)]">{error}</p> : null}
        {!error && status ? <p className="theme-subtle">{status}</p> : null}
      </div>

      {createOpen ? (
        <div className="rounded-md border theme-border p-4 space-y-3">
          <h3 className="font-mono text-xs theme-subtle">create album</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1 font-mono text-micro theme-subtle">
              title
              <input
                name="new-album-title"
                value={createTitle}
                onChange={(event) => {
                  setCreateTitle(event.target.value);
                  if (!createSlug || createSlug === slugify(createTitle))
                    setCreateSlug(slugify(event.target.value));
                }}
                className={fieldClass}
              />
            </label>
            <label className="space-y-1 font-mono text-micro theme-subtle">
              permanent URL slug
              <input
                name="new-album-slug"
                value={createSlug}
                onChange={(event) => setCreateSlug(slugify(event.target.value))}
                className={fieldClass}
              />
            </label>
            <label className="space-y-1 font-mono text-micro theme-subtle">
              date
              <input
                name="new-album-date"
                type="date"
                value={createDate}
                onChange={(event) => setCreateDate(event.target.value)}
                className={fieldClass}
              />
            </label>
          </div>
          <label className="block space-y-1 font-mono text-micro theme-subtle">
            description
            <textarea
              name="new-album-description"
              value={createDescription}
              onChange={(event) => setCreateDescription(event.target.value)}
              className={`${fieldClass} min-h-20 resize-y`}
            />
          </label>
          <button
            type="button"
            onClick={() => void handleCreate()}
            disabled={busy === "create" || !createTitle || !createSlug || !createDate}
            className="min-h-11 rounded-md border theme-border px-4 font-mono text-xs disabled:opacity-50"
          >
            {busy === "create" ? "creating..." : "create draft album"}
          </button>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(220px,0.8fr)_minmax(0,2fr)]">
        <div className="space-y-3">
          <label className="block font-mono text-micro theme-subtle">
            find album
            <input
              name="album-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className={fieldClass}
              placeholder="title or slug"
            />
          </label>
          <div className="max-h-96 space-y-1 overflow-auto pr-1">
            {visibleAlbums.map((album) => (
              <button
                key={album.slug}
                type="button"
                onClick={() => setSelectedSlug(album.slug)}
                className={`min-h-14 w-full rounded-md border px-3 py-2 text-left font-mono text-xs ${selectedSlug === album.slug ? "theme-border-strong" : "theme-border"}`}
              >
                <span className="block truncate">{album.title}</span>
                <span className="mt-1 block truncate theme-subtle">
                  {album.photos.length} photos · {album.status ?? "published"}
                </span>
              </button>
            ))}
            {!loading && visibleAlbums.length === 0 ? (
              <p className="py-4 font-mono text-xs theme-subtle">No albums found.</p>
            ) : null}
          </div>
        </div>

        {selectedAlbum ? (
          <div className="min-w-0 space-y-5">
            <div className="rounded-md border theme-border p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-mono text-micro theme-subtle">/pics/{selectedAlbum.slug}</p>
                  <h3 className="font-serif text-xl">album details</h3>
                </div>
                <div className="flex flex-wrap gap-2">
                  <a
                    href={`/pics/${selectedAlbum.slug}`}
                    target="_blank"
                    rel="noreferrer"
                    className="min-h-11 rounded border theme-border px-3 py-3 font-mono text-xs"
                  >
                    open album ↗
                  </a>
                  <button
                    type="button"
                    onClick={() =>
                      void handleCopy(
                        `${window.location.origin}/pics/${selectedAlbum.slug}`,
                        "album URL",
                      )
                    }
                    className="min-h-11 rounded border theme-border px-3 font-mono text-xs"
                  >
                    copy album URL
                  </button>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 font-mono text-micro theme-subtle">
                  title
                  <input
                    name="album-title"
                    value={metaTitle}
                    onChange={(event) => setMetaTitle(event.target.value)}
                    className={fieldClass}
                  />
                </label>
                <label className="space-y-1 font-mono text-micro theme-subtle">
                  date
                  <input
                    name="album-date"
                    type="date"
                    value={metaDate}
                    onChange={(event) => setMetaDate(event.target.value)}
                    className={fieldClass}
                  />
                </label>
              </div>
              <label className="block space-y-1 font-mono text-micro theme-subtle">
                description
                <textarea
                  name="album-description"
                  value={metaDescription}
                  onChange={(event) => setMetaDescription(event.target.value)}
                  className={`${fieldClass} min-h-20 resize-y`}
                />
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleSaveMetadata()}
                  disabled={busy === "metadata"}
                  className="min-h-11 rounded border theme-border px-4 font-mono text-xs disabled:opacity-50"
                >
                  {busy === "metadata" ? "saving..." : "save details"}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void handleStatus(
                      (selectedAlbum.status ?? "published") === "published" ? "draft" : "published",
                    )
                  }
                  disabled={busy === "status"}
                  className="min-h-11 rounded border theme-border px-4 font-mono text-xs disabled:opacity-50"
                >
                  {(selectedAlbum.status ?? "published") === "published"
                    ? "move to drafts"
                    : "publish album"}
                </button>
                <button
                  type="button"
                  onClick={() => void handleDeleteAlbum()}
                  className="ml-auto min-h-11 px-3 font-mono text-xs text-[var(--prose-hashtag)]"
                >
                  delete album
                </button>
              </div>
            </div>

            <div
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                void handleFiles(event.dataTransfer.files);
              }}
              className="rounded-md border border-dashed theme-border p-6 text-center"
            >
              <p className="font-serif text-lg">drop photos here</p>
              <p className="mt-1 font-mono text-xs theme-subtle">
                or paste images anywhere in this panel
              </p>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy === "upload"}
                className="mt-3 min-h-11 rounded border theme-border px-4 font-mono text-xs disabled:opacity-50"
              >
                {busy === "upload" ? "uploading and processing..." : "choose photos"}
              </button>
              <input
                ref={fileInputRef}
                name="album-photos"
                aria-label="Choose album photos"
                type="file"
                multiple
                accept="image/*,.heic,.heif,.dng,.cr2,.cr3,.nef,.arw,.raf,.orf,.rw2"
                className="sr-only"
                onChange={(event) => void handleFiles(event.target.files ?? [])}
              />
              {busy === "upload" || uploadProgress > 0 ? (
                <div
                  className="mx-auto mt-4 max-w-sm"
                  aria-label={`Upload ${uploadProgress}% complete`}
                >
                  <div className="h-1 overflow-hidden rounded bg-[var(--stone-200)]">
                    <div
                      className="h-full bg-[var(--foreground)] transition-[width]"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                  <p className="mt-2 font-mono text-micro theme-subtle">{uploadProgress}%</p>
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <label className="min-w-56 flex-1 font-mono text-micro theme-subtle">
                find photo
                <input
                  name="photo-search"
                  value={photoQuery}
                  onChange={(event) => setPhotoQuery(event.target.value)}
                  className={fieldClass}
                  placeholder="id, title, alt text, or caption"
                />
              </label>
              {selectedIds.size > 0 ? (
                <button
                  type="button"
                  onClick={() => void handleDeletePhotos([...selectedIds])}
                  disabled={busy === "delete-photos"}
                  className="min-h-11 rounded border theme-border px-4 font-mono text-xs text-[var(--prose-hashtag)] disabled:opacity-50"
                >
                  {busy === "delete-photos"
                    ? "deleting..."
                    : `delete selected (${selectedIds.size})`}
                </button>
              ) : null}
            </div>

            <AlbumPhotoGrid
              album={selectedAlbum}
              photos={visiblePhotos}
              selectedIds={selectedIds}
              editingId={editingId}
              photoDraft={photoDraft}
              busy={busy}
              onToggle={(photoId) =>
                setSelectedIds((current) => {
                  const next = new Set(current);
                  if (next.has(photoId)) next.delete(photoId);
                  else next.add(photoId);
                  return next;
                })
              }
              onSelectAll={() => setSelectedIds(new Set(visiblePhotos.map((photo) => photo.id)))}
              onClearSelection={() => setSelectedIds(new Set())}
              onSetCover={(photoId) => void handleSetCover(photoId)}
              onEdit={handleEditPhoto}
              onDraftChange={setPhotoDraft}
              onSavePhoto={(photoId) => void handleSavePhoto(photoId)}
              onCancelEdit={() => setEditingId(null)}
              onMove={handleMove}
              onDropBefore={(source, target) =>
                selectedAlbum && void saveOrder(reorder(selectedAlbum.photos, source, target))
              }
              onDelete={(photoId) => void handleDeletePhotos([photoId])}
              onCopy={(value, label) => void handleCopy(value, label)}
            />
          </div>
        ) : (
          <p className="py-10 text-center font-mono text-xs theme-subtle">
            Create or select an album to begin.
          </p>
        )}
      </div>
      {dialog}
    </section>
  );
}
