import { getAlbumBySlug } from "@/features/media/albums";
import { focalPresetToObjectPosition } from "@/features/media/focal";
import type { EmbeddedAlbum } from "./AlbumEmbed";

const STOP_WORDS = new Set([
  "a","an","the","in","on","at","to","for","of","and","or","but",
  "is","it","its","my","i","we","so","no","do","if","by","as","up",
  "be","am","are","was","were","not","this","that","with","from",
]);

function highlightWordTitle(title: string) {
  const words = title.split(/\s+/);
  if (words.length <= 2) return title;

  const count = Math.max(1, Math.round(words.length * 0.35));
  const scored = words.map((word, i) => {
    const clean = word.toLowerCase().replace(/[^a-z]/g, "");
    return { i, score: STOP_WORDS.has(clean) ? 0 : word.length };
  });

  const highlighted = new Set(
    [...scored]
      .sort((a, b) => b.score - a.score || a.i - b.i)
      .slice(0, count)
      .map((s) => s.i),
  );

  const runs: { text: string; lit: boolean }[] = [];
  for (let i = 0; i < words.length; i++) {
    const lit = highlighted.has(i);
    const prev = runs[runs.length - 1];
    if (prev && prev.lit === lit) {
      prev.text += ` ${words[i]}`;
    } else {
      runs.push({ text: words[i], lit });
    }
  }

  return runs.map((run, i) => (
    <span key={`${run.text}-${i}`}>
      {i > 0 && " "}
      {run.lit ? <span className="highlight-selection">{run.text}</span> : run.text}
    </span>
  ));
}

function formatWordDate(dateStr: string): string {
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? `${dateStr}T00:00:00` : dateStr;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function resolveAlbumsFromWordContent(content: string): Record<string, EmbeddedAlbum> {
  try {
    const albumLinkPattern = /\[.*?\]\(\/pics\/([a-z0-9-]+)(?:#[a-z]+)?\)/g;
    const albums: Record<string, EmbeddedAlbum> = {};
    let match: RegExpExecArray | null;

    while ((match = albumLinkPattern.exec(content)) !== null) {
      const albumSlug = match[1];
      const href = `/pics/${albumSlug}`;
      if (albums[href]) continue;

      const album = getAlbumBySlug(albumSlug);
      if (!album?.photos?.length) continue;

      const previewIds = [album.cover];
      for (const photo of album.photos) {
        if (previewIds.length >= 6) break;
        if (photo.id !== album.cover) previewIds.push(photo.id);
      }

      const focalPoints: Record<string, string> = {};
      for (const p of album.photos) {
        if (p.focalPoint) {
          focalPoints[p.id] = focalPresetToObjectPosition(p.focalPoint);
        } else if (p.autoFocal) {
          focalPoints[p.id] = `${p.autoFocal.x}% ${p.autoFocal.y}%`;
        }
      }

      albums[href] = {
        slug: album.slug,
        title: album.title,
        date: album.date,
        cover: album.cover,
        photoCount: album.photos.length,
        previewIds,
        focalPoints: Object.keys(focalPoints).length > 0 ? focalPoints : undefined,
      };
    }

    return albums;
  } catch {
    return {};
  }
}

export {
  highlightWordTitle,
  formatWordDate,
  resolveAlbumsFromWordContent,
};
