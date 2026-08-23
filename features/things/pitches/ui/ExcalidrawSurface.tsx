import {
  Component,
  type ErrorInfo,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { BinaryFiles, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import "@excalidraw/excalidraw/index.css";

import { fromPitchStageScene, toPitchStageScene } from "./pitch-stage.client";

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

// React error boundaries still require a class component. Keeping it inside
// the adapter prevents a canvas failure from reaching the surrounding studio.
class PitchCanvasBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("The pitch canvas stopped and was contained", error, info);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div
        className="flex h-full min-h-80 flex-col items-center justify-center gap-4 bg-surface px-6 text-center"
        role="alert"
      >
        <p className="max-w-md font-serif text-lg text-foreground">
          The canvas caught itself before it could disturb your saved slide.
        </p>
        <button
          type="button"
          onClick={() => this.setState({ failed: false })}
          className="min-h-11 border-b theme-border px-4 font-mono text-xs text-foreground hover:opacity-60"
        >
          reopen this slide
        </button>
      </div>
    );
  }
}

function ExcalidrawSurfaceCanvas({
  slideId,
  elements,
  files,
  readOnly = false,
  transparentBackground = false,
  stageUnderlay,
  stageOverlay,
  onChange,
  onApi,
}: {
  slideId: string;
  elements: readonly ExcalidrawElement[];
  files: BinaryFiles;
  readOnly?: boolean;
  transparentBackground?: boolean;
  stageUnderlay?: ReactNode;
  stageOverlay?: ReactNode;
  onChange?: (slideId: string, elements: readonly ExcalidrawElement[], files: BinaryFiles) => void;
  onApi?: (api: ExcalidrawImperativeAPI) => void;
}) {
  const initialised = useRef(false);
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const [viewport, setViewport] = useState<{
    scrollX: number;
    scrollY: number;
    zoom: number;
  }>();
  const [Canvas, setCanvas] = useState<(typeof import("@excalidraw/excalidraw"))["Excalidraw"]>();
  const onApiRef = useRef(onApi);
  const onChangeRef = useRef(onChange);
  const elementsRef = useRef(elements);
  const filesRef = useRef(files);
  const [initialStage] = useState(() => toPitchStageScene(slideId, elements));
  const initialDataRef = useRef({
    elements: initialStage.elements,
    files,
    appState: {
      ...(transparentBackground ? { viewBackgroundColor: "transparent" } : {}),
      currentItemFontFamily: 3 as const,
      frameRendering: {
        enabled: true,
        clip: true,
        name: false,
        outline: !readOnly,
      },
    },
  });

  onApiRef.current = onApi;
  onChangeRef.current = onChange;

  const handleApi = useCallback((nextApi: ExcalidrawImperativeAPI) => {
    apiRef.current = nextApi;
    setApi(nextApi);
    onApiRef.current?.(nextApi);
  }, []);

  const handleChange = useCallback(
    (nextElements: readonly ExcalidrawElement[], nextFiles: BinaryFiles) => {
      const content = fromPitchStageScene(slideId, nextElements);
      if (elementsMatch(elementsRef.current, content) && filesMatch(filesRef.current, nextFiles)) {
        return;
      }
      elementsRef.current = content;
      filesRef.current = nextFiles;
      onChangeRef.current?.(slideId, content, nextFiles);
    },
    [slideId],
  );

  const handleScrollChange = useCallback(
    (scrollX: number, scrollY: number, zoom: { value: number }) => {
      setViewport({ scrollX, scrollY, zoom: zoom.value });
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
    if (!api || initialised.current) return;
    initialised.current = true;
    const timer = window.setTimeout(() => {
      api.scrollToContent([initialStage.frame], {
        fitToViewport: true,
        viewportZoomFactor: readOnly ? 0.94 : 0.84,
      });
      const appState = api.getAppState();
      setViewport({
        scrollX: appState.scrollX,
        scrollY: appState.scrollY,
        zoom: appState.zoom.value,
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [api, initialStage.frame, readOnly]);

  useEffect(() => {
    if (!api) return;

    const scene = toPitchStageScene(slideId, elements);
    if (!elementsMatch(elementsRef.current, elements)) {
      elementsRef.current = elements;
      api.updateScene({ elements: scene.elements });
    }

    if (!filesMatch(filesRef.current, files)) {
      const changedFiles = Object.values(files).filter(
        (file) => filesRef.current[file.id]?.dataURL !== file.dataURL,
      );
      filesRef.current = files;
      if (changedFiles.length > 0) api.addFiles(changedFiles);
    }
  }, [api, elements, files, slideId]);

  if (!Canvas) {
    return (
      <div className="flex h-full min-h-80 items-center justify-center bg-surface font-mono text-xs theme-muted">
        opening canvas…
      </div>
    );
  }

  return (
    <div
      className={`pitch-excalidraw relative h-full ${readOnly ? "pitch-excalidraw--readonly" : ""}`}
    >
      {!readOnly ? (
        <span className="pointer-events-none absolute left-14 top-3 z-20 bg-background/90 px-2 py-1 font-mono text-micro theme-muted">
          screen boundary · 16:9
        </span>
      ) : null}
      {stageUnderlay && viewport ? (
        <div
          className="pointer-events-none absolute z-0 overflow-hidden"
          style={{
            left: viewport.scrollX * viewport.zoom,
            top: viewport.scrollY * viewport.zoom,
            width: 960 * viewport.zoom,
            height: 540 * viewport.zoom,
          }}
        >
          {stageUnderlay}
        </div>
      ) : null}
      <div className="relative z-10 h-full">
        <Canvas
          excalidrawAPI={handleApi}
          initialData={initialDataRef.current}
          viewModeEnabled={readOnly}
          zenModeEnabled={readOnly}
          validateEmbeddable={false}
          onScrollChange={handleScrollChange}
          onChange={
            onChange
              ? (nextElements, _appState, nextFiles) => handleChange(nextElements, nextFiles)
              : undefined
          }
          UIOptions={UI_OPTIONS}
        />
      </div>
      {stageOverlay && viewport ? (
        <div
          className="pointer-events-none absolute z-20 overflow-visible"
          style={{
            left: viewport.scrollX * viewport.zoom,
            top: viewport.scrollY * viewport.zoom,
            width: 960 * viewport.zoom,
            height: 540 * viewport.zoom,
          }}
        >
          {stageOverlay}
        </div>
      ) : null}
    </div>
  );
}

export function ExcalidrawSurface(props: Parameters<typeof ExcalidrawSurfaceCanvas>[0]) {
  return (
    <PitchCanvasBoundary>
      <ExcalidrawSurfaceCanvas {...props} />
    </PitchCanvasBoundary>
  );
}
