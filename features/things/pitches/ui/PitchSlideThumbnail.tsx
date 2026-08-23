import { useEffect, useState } from "react";
import type { BinaryFiles } from "@excalidraw/excalidraw/types";

import { AppImage } from "@/components/AppImage";
import type { PitchSlide } from "../types";

export function PitchSlideThumbnail({
  slide,
  files,
  alt = "",
  className = "",
}: {
  slide: PitchSlide;
  files: BinaryFiles;
  alt?: string;
  className?: string;
}) {
  const [url, setUrl] = useState("");

  useEffect(() => {
    let cancelled = false;
    let objectUrl = "";
    const timer = window.setTimeout(() => {
      const background = getComputedStyle(document.documentElement)
        .getPropertyValue("--background")
        .trim();
      void Promise.all([import("@excalidraw/excalidraw"), import("./pitch-stage.client")])
        .then(([{ exportToBlob }, { pitchStageExport }]) =>
          exportToBlob({
            ...pitchStageExport(slide.id, slide.elements),
            files,
            appState: {
              exportBackground: true,
              viewBackgroundColor: background,
              frameRendering: { enabled: true, clip: true, name: false, outline: false },
            },
            mimeType: "image/png",
            maxWidthOrHeight: 480,
            exportPadding: 0,
          }),
        )
        .then((blob: Blob) => {
          if (cancelled) return;
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
        })
        .catch(() => undefined);
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [files, slide.elements, slide.id, slide.version]);

  return url ? (
    <AppImage src={url} alt={alt} width={480} height={270} className={className} />
  ) : (
    <span
      aria-hidden="true"
      className={`block animate-pulse bg-surface motion-reduce:animate-none ${className}`}
    />
  );
}
