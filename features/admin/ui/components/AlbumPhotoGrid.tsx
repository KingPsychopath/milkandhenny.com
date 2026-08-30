import { AppImage } from "@/components/AppImage";
import { AppSelect } from "@/components/AppSelect";
import type { Album, Photo } from "@/features/media/albums";
import { FOCAL_PRESETS, focalPresetToObjectPosition } from "@/features/media/focal";
import { imagePlaceholderStyle } from "@/features/media/image";
import { AdminStatus } from "./AdminStatus";

interface PhotoDraft {
  title: string;
  alt: string;
  caption: string;
  focalPoint: string;
}

interface AlbumPhotoGridProps {
  album: Album;
  photos: Photo[];
  selectedIds: Set<string>;
  editingId: string | null;
  photoDraft: PhotoDraft;
  busy: string | null;
  onToggle: (photoId: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onSetCover: (photoId: string) => void;
  onEdit: (photo: Photo) => void;
  onDraftChange: (draft: PhotoDraft) => void;
  onSavePhoto: (photoId: string) => void;
  onCancelEdit: () => void;
  onMove: (photoId: string, offset: -1 | 1) => void;
  onDropBefore: (draggedId: string, targetId: string) => void;
  onDelete: (photoId: string) => void;
  onCopy: (value: string, label: string) => void;
}

function focalPosition(photo: Photo): string | undefined {
  if (photo.focalPoint) return focalPresetToObjectPosition(photo.focalPoint);
  if (photo.autoFocal) return `${photo.autoFocal.x}% ${photo.autoFocal.y}%`;
  return undefined;
}

function PhotoDetailsEditor({
  photoId,
  draft,
  busy,
  onChange,
  onSave,
  onCancel,
}: {
  photoId: string;
  draft: PhotoDraft;
  busy: boolean;
  onChange: (draft: PhotoDraft) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const fieldClass =
    "w-full border-b theme-border bg-transparent py-2 font-mono text-xs outline-none focus:border-[var(--foreground)]";
  return (
    <div className="col-span-full border-t theme-border pt-3 space-y-3">
      <p className="font-mono text-xs theme-subtle">edit {photoId}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 font-mono text-micro theme-subtle">
          display title
          <input
            name={`photo-title-${photoId}`}
            value={draft.title}
            onChange={(event) => onChange({ ...draft, title: event.target.value })}
            className={fieldClass}
          />
        </label>
        <label className="space-y-1 font-mono text-micro theme-subtle">
          focal point
          <AppSelect
            name={`photo-focal-point-${photoId}`}
            value={draft.focalPoint}
            onValueChange={(value) => onChange({ ...draft, focalPoint: value })}
            options={[
              { value: "", label: "automatic / centre" },
              ...FOCAL_PRESETS.map((preset) => ({ value: preset, label: preset })),
            ]}
            tone="theme"
            variant="field"
            ariaLabel="Focal point"
            className="mt-1"
          />
        </label>
      </div>
      <label className="block space-y-1 font-mono text-micro theme-subtle">
        accessible description
        <input
          name={`photo-alt-${photoId}`}
          value={draft.alt}
          onChange={(event) => onChange({ ...draft, alt: event.target.value })}
          className={fieldClass}
          placeholder="Describe the photo for people who cannot see it"
        />
      </label>
      <label className="block space-y-1 font-mono text-micro theme-subtle">
        caption
        <textarea
          name={`photo-caption-${photoId}`}
          value={draft.caption}
          onChange={(event) => onChange({ ...draft, caption: event.target.value })}
          className={`${fieldClass} min-h-20 resize-y`}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onSave}
          disabled={busy}
          className="min-h-11 rounded-md border theme-border px-4 py-2 font-mono text-xs hover:opacity-70 disabled:opacity-50"
        >
          {busy ? "saving..." : "save photo details"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="min-h-11 px-3 py-2 font-mono text-xs theme-subtle hover:opacity-70"
        >
          cancel
        </button>
      </div>
    </div>
  );
}

export function AlbumPhotoGrid({
  album,
  photos,
  selectedIds,
  editingId,
  photoDraft,
  busy,
  onToggle,
  onSelectAll,
  onClearSelection,
  onSetCover,
  onEdit,
  onDraftChange,
  onSavePhoto,
  onCancelEdit,
  onMove,
  onDropBefore,
  onDelete,
  onCopy,
}: AlbumPhotoGridProps) {
  let draggedId = "";
  return (
    <section aria-labelledby="album-photo-heading" className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2 border-t theme-border pt-6">
        <div>
          <h3 id="album-photo-heading" className="font-mono text-sm font-bold">
            photos · {photos.length}
          </h3>
          <p className="mt-1 font-mono text-micro theme-subtle">
            drag cards to reorder, or use the arrow buttons
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onSelectAll}
            className="min-h-11 px-2 font-mono text-xs underline"
          >
            select all
          </button>
          {selectedIds.size > 0 ? (
            <button
              type="button"
              onClick={onClearSelection}
              className="min-h-11 px-2 font-mono text-xs underline"
            >
              clear ({selectedIds.size})
            </button>
          ) : null}
        </div>
      </div>

      <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
        {photos.map((photo, index) => {
          const imageUrl = `/api/admin/albums/${encodeURIComponent(album.slug)}/photos/${encodeURIComponent(photo.id)}/media`;
          const selected = selectedIds.has(photo.id);
          const isCover = album.cover === photo.id;
          return (
            <li
              key={photo.id}
              draggable
              onDragStart={(event) => {
                draggedId = photo.id;
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", photo.id);
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
              }}
              onDrop={(event) => {
                event.preventDefault();
                const source = event.dataTransfer.getData("text/plain") || draggedId;
                if (source && source !== photo.id) onDropBefore(source, photo.id);
              }}
              className={`group relative overflow-hidden rounded-md border p-3 ${selected ? "theme-border-strong" : "theme-border"}`}
            >
              <div
                className="media-image-placeholder relative aspect-[3/2] overflow-hidden rounded-sm"
                style={imagePlaceholderStyle(photo.placeholder)}
              >
                <AppImage
                  src={imageUrl}
                  sizes="(min-width: 1280px) 28vw, (min-width: 640px) 42vw, 100vw"
                  alt={photo.alt ?? ""}
                  width={photo.width}
                  height={photo.height}
                  reveal
                  className="h-full w-full object-cover"
                  style={{ objectPosition: focalPosition(photo) }}
                />
                <label className="absolute left-2 top-2 flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded bg-background/90">
                  <span className="sr-only">Select {photo.id}</span>
                  <input
                    name={`select-photo-${photo.id}`}
                    type="checkbox"
                    checked={selected}
                    onChange={() => onToggle(photo.id)}
                    className="h-5 w-5"
                  />
                </label>
                {isCover ? (
                  <span className="absolute right-2 top-2 rounded bg-background/90 px-2 py-1 font-mono text-micro">
                    <AdminStatus tone="positive">cover</AdminStatus>
                  </span>
                ) : null}
                <span className="absolute bottom-2 left-2 rounded bg-background/90 px-2 py-1 font-mono text-micro">
                  {index + 1}
                </span>
              </div>
              <div className="mt-2 min-w-0">
                <p className="truncate font-mono text-xs">{photo.title ?? photo.id}</p>
                <p className="truncate font-mono text-micro theme-subtle">{photo.id}</p>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1">
                <button
                  type="button"
                  disabled={index === 0 || busy === "order"}
                  onClick={() => onMove(photo.id, -1)}
                  className="min-h-11 rounded border theme-border font-mono text-xs disabled:opacity-30"
                  aria-label={`Move ${photo.id} earlier`}
                >
                  ← earlier
                </button>
                <button
                  type="button"
                  disabled={index === photos.length - 1 || busy === "order"}
                  onClick={() => onMove(photo.id, 1)}
                  className="min-h-11 rounded border theme-border font-mono text-xs disabled:opacity-30"
                  aria-label={`Move ${photo.id} later`}
                >
                  later →
                </button>
                <button
                  type="button"
                  disabled={isCover || busy === `cover:${photo.id}`}
                  onClick={() => onSetCover(photo.id)}
                  className="min-h-11 rounded border theme-border font-mono text-xs disabled:opacity-40"
                >
                  {isCover ? "primary" : "make primary"}
                </button>
                <button
                  type="button"
                  onClick={() => onEdit(photo)}
                  className="min-h-11 rounded border theme-border font-mono text-xs"
                >
                  edit details
                </button>
                <button
                  type="button"
                  onClick={() => onCopy(imageUrl, "admin preview URL")}
                  className="min-h-11 rounded border theme-border font-mono text-xs"
                >
                  copy URL
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onCopy(
                      `![${photo.alt ?? photo.title ?? photo.id}](/pics/${album.slug}/${photo.id})`,
                      "markdown",
                    )
                  }
                  className="min-h-11 rounded border theme-border font-mono text-xs"
                >
                  copy markdown
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(photo.id)}
                  className="col-span-2 min-h-11 rounded border theme-border px-2 font-mono text-xs text-[var(--prose-hashtag)]"
                >
                  delete photo
                </button>
              </div>
              {editingId === photo.id ? (
                <PhotoDetailsEditor
                  photoId={photo.id}
                  draft={photoDraft}
                  busy={busy === `photo:${photo.id}`}
                  onChange={onDraftChange}
                  onSave={() => onSavePhoto(photo.id)}
                  onCancel={onCancelEdit}
                />
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export type { PhotoDraft };
