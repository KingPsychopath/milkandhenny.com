import { useCallback, useEffect, useRef, useState } from "react";
import type { BinaryFiles, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import "@excalidraw/excalidraw/index.css";

const UI_OPTIONS = {
  canvasActions: {
    changeViewBackgroundColor: false,
    clearCanvas: false,
    export: false,
    loadScene: false,
    saveAsImage: false,
    toggleTheme: false,
  },
} as const;

function elementsMatch(
  left: readonly ExcalidrawElement[],
  right: readonly ExcalidrawElement[],
): boolean {
  return (
    left.length === right.length &&
    left.every((element, index) => {
      const candidate = right[index];
      return (
        candidate?.id === element.id &&
        candidate.version === element.version &&
        candidate.versionNonce === element.versionNonce &&
        candidate.isDeleted === element.isDeleted
      );
    })
  );
}

function filesMatch(left: BinaryFiles, right: BinaryFiles): boolean {
  const leftIds = Object.keys(left);
  const rightIds = Object.keys(right);
  return (
    leftIds.length === rightIds.length &&
    leftIds.every((id) => left[id]?.dataURL === right[id]?.dataURL)
  );
}

export function ExcalidrawSurface({
  elements,
  files,
  readOnly = false,
  onChange,
  onApi,
}: {
  elements: readonly ExcalidrawElement[];
  files: BinaryFiles;
  readOnly?: boolean;
  onChange?: (elements: readonly ExcalidrawElement[], files: BinaryFiles) => void;
  onApi?: (api: ExcalidrawImperativeAPI) => void;
}) {
  const initialised = useRef(false);
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const [Canvas, setCanvas] = useState<(typeof import("@excalidraw/excalidraw"))["Excalidraw"]>();
  const onApiRef = useRef(onApi);
  const onChangeRef = useRef(onChange);
  const elementsRef = useRef(elements);
  const filesRef = useRef(files);
  const initialDataRef = useRef({
    elements,
    files,
    appState: {
      currentItemFontFamily: 3 as const,
    },
  });

  onApiRef.current = onApi;
  onChangeRef.current = onChange;

  const handleApi = useCallback((api: ExcalidrawImperativeAPI) => {
    apiRef.current = api;
    onApiRef.current?.(api);
  }, []);

  const handleChange = useCallback(
    (nextElements: readonly ExcalidrawElement[], nextFiles: BinaryFiles) => {
      if (
        elementsMatch(elementsRef.current, nextElements) &&
        filesMatch(filesRef.current, nextFiles)
      ) {
        return;
      }
      elementsRef.current = nextElements;
      filesRef.current = nextFiles;
      onChangeRef.current?.(nextElements, nextFiles);
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    void import("@excalidraw/excalidraw").then((module) => {
      if (!cancelled) setCanvas(() => module.Excalidraw);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!apiRef.current || initialised.current) return;
    initialised.current = true;
    requestAnimationFrame(() => apiRef.current?.scrollToContent(elements, { fitToContent: true }));
  }, [elements]);

  if (!Canvas) {
    return (
      <div className="flex h-full min-h-80 items-center justify-center bg-surface font-mono text-xs theme-muted">
        opening canvas…
      </div>
    );
  }

  return (
    <Canvas
      excalidrawAPI={handleApi}
      initialData={initialDataRef.current}
      viewModeEnabled={readOnly}
      zenModeEnabled={readOnly}
      validateEmbeddable={false}
      onChange={
        onChange
          ? (nextElements, _appState, nextFiles) => handleChange(nextElements, nextFiles)
          : undefined
      }
      UIOptions={UI_OPTIONS}
    />
  );
}
