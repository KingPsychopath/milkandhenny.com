import type { PitchAsset, PitchMediaKind, PitchSlide } from "../types";

export interface UnavailablePitchMedia {
  assetId: string;
  kind: "image" | PitchMediaKind;
  fileName: string;
  slideNames: string[];
}

export function unavailablePitchMedia(
  slides: readonly PitchSlide[],
  assets: readonly PitchAsset[],
): UnavailablePitchMedia[] {
  const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
  const unavailable = new Map<string, UnavailablePitchMedia>();

  const include = (assetId: string, kind: UnavailablePitchMedia["kind"], slideName: string) => {
    const asset = assetsById.get(assetId);
    if (asset?.availability === "available" && asset.url) return;
    const current = unavailable.get(assetId);
    if (current) {
      if (!current.slideNames.includes(slideName)) current.slideNames.push(slideName);
      return;
    }
    unavailable.set(assetId, {
      assetId,
      kind,
      fileName: asset?.fileName ?? `${kind} file`,
      slideNames: [slideName],
    });
  };

  for (const slide of slides.filter((candidate) => !candidate.deletedAt)) {
    for (const assetId of Object.values(slide.assetIds)) include(assetId, "image", slide.name);
    for (const clip of slide.mediaClips) include(clip.assetId, clip.kind, slide.name);
  }
  return [...unavailable.values()];
}

export function PitchMediaAvailabilityNotice({
  slides,
  assets,
  audience,
  className = "",
}: {
  slides: readonly PitchSlide[];
  assets: readonly PitchAsset[];
  audience: "owner" | "viewer";
  className?: string;
}) {
  const unavailable = unavailablePitchMedia(slides, assets);
  if (unavailable.length === 0) return null;
  const names = unavailable
    .slice(0, 3)
    .map((media) => media.fileName)
    .join(", ");
  const remaining = unavailable.length - 3;

  return (
    <section
      className={`border-y border-[var(--things-amber)] bg-[var(--selection-bg)] px-4 py-3 text-[var(--selection-fg)] ${className}`}
      role={audience === "owner" ? "alert" : "status"}
      aria-live="polite"
    >
      <p className="font-mono text-xs font-semibold">
        {unavailable.length} media file{unavailable.length === 1 ? " needs" : "s need"} attention
      </p>
      <p className="mt-1 font-mono text-micro leading-relaxed">
        {audience === "owner"
          ? `The stored ${unavailable.length === 1 ? "copy is" : "copies are"} unavailable: ${names}${remaining > 0 ? ` and ${remaining} more` : ""}. Restore a .mahdeck backup, or remove and add the affected media again before publishing.`
          : "Some media on this slide is unavailable. Everything else in the pitch will keep playing."}
      </p>
    </section>
  );
}
