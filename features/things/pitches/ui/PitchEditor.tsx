import { Link } from "@tanstack/react-router";

import { GuidedTour } from "@/components/GuidedTour";
import { activateSiteUpdate } from "@/features/offline/client";
import { pitchDocumentContentCount } from "../document-content";
import { PITCH_VIDEO_DEFAULT_PLACEMENT, type PitchOperationalStatus } from "../types";
import { ExcalidrawSurface } from "./ExcalidrawSurface";
import { DrawesomeInk } from "./DrawesomeInk";
import { PitchMediaTimeline } from "./PitchMediaTimeline";
import { PitchVideoLayer, PitchVideoStageControls } from "./PitchMediaPlayback";
import { PitchMediaTrimDialog } from "./PitchMediaTrimDialog";
import { PitchOperationalNotice } from "./PitchOperationalNotice";
import { PitchDeviceSwitcher } from "./PitchDeviceSwitcher";
import { PitchImportDialog } from "./PitchImportDialog";
import { PitchPreview } from "./PitchPreview";
import { PitchRecovery } from "./PitchRecovery";
import { PitchSlideThumbnail } from "./PitchSlideThumbnail";
import { PitchVersionHistory } from "./PitchVersionHistory";

import {
  usePitchEditorController,
  TOUR_STEPS,
  DEMO_TOUR_STEPS,
  rememberPitchStudioTour,
  updateSlide,
  dropFileKind,
  type PitchEditorSession,
} from "./usePitchEditorController";
export function PitchEditor({
  session,
  maximumSlides,
  operationalStatus,
}: {
  session: PitchEditorSession;
  maximumSlides: number;
  operationalStatus: PitchOperationalStatus;
}) {
  const {
    isDemo,
    deckId,
    operational,
    serverSavingPaused,
    deck,
    documentState,
    setDocumentState,
    files,
    title,
    setTitle,
    setActiveSlideId,
    selectedMediaClipId,
    setSelectedMediaClipId,
    phase,
    syncState,
    message,
    setMessage,
    undoEntry,
    inkOpen,
    setInkOpen,
    previewOpen,
    setPreviewOpen,
    tourOpen,
    setTourOpen,
    historyOpen,
    setHistoryOpen,
    historyLoading,
    historyItems,
    selectedHistoryId,
    setSelectedHistoryId,
    historyPreview,
    setHistoryPreview,
    historyPreviewLoading,
    setHistoryPreviewLoading,
    historyPreviewError,
    setHistoryPreviewError,
    restoringHistoryId,
    railOpen,
    setRailOpen,
    railPinned,
    setRailPinned,
    importOpen,
    setImportOpen,
    exportOpen,
    setExportOpen,
    importing,
    pendingImport,
    setPendingImport,
    dragKind,
    mediaProgress,
    pendingMediaTrim,
    setPendingMediaTrim,
    sceneEpoch,
    localSaveFailed,
    setLocalSaveWake,
    setSyncWake,
    updateState,
    apiRef,
    historyPreviewRequest,
    documentRef,
    titleRef,
    toolbarRef,
    presentationInputRef,
    backupInputRef,
    reloadSafe,
    markChanged,
    currentSlide,
    visibleSlides,
    assets,
    mediaClock,
    hasUnsecuredMedia,
    unsecuredImageFileIds,
    missingLocalImageFileIds,
    activeImageUploadId,
    imageUploadFailure,
    retryImageUploads,
    onCanvasChange,
    addSlide,
    rememberUndo,
    undoLastAction,
    deleteSlide,
    attachMedia,
    placeInk,
    confirmImport,
    handleImportInput,
    handleDroppedFiles,
    publish,
    loadVersionHistory,
    selectVersionHistoryItem,
    restoreVersion,
    exportDeck,
    exportCurrentPng,
    exportCurrentSvg,
    exportDeckZip,
    runExport,
    actionDialog,
  } = usePitchEditorController({ session, maximumSlides, operationalStatus });

  if (phase === "loading") {
    return (
      <main id="main" className="p-8 font-mono text-sm theme-muted">
        opening your studio…
      </main>
    );
  }
  if (!operational.canRead) return <PitchOperationalNotice status={operational} />;
  if (phase === "missing") {
    return (
      <main id="main" className="mx-auto max-w-xl px-6 py-20">
        <Link to="/things/pitches" className="font-mono text-xs theme-muted">
          ← pitch wall
        </Link>
        <h1 className="mt-14 font-serif text-4xl text-foreground">This studio needs its key.</h1>
        <p className="mt-4 font-serif text-lg theme-muted">
          Open the private link on this device, or have it sent back to the original email.
        </p>
        <div className="mt-10">
          <PitchRecovery compact />
        </div>
      </main>
    );
  }
  if (phase === "error" || !documentState || !currentSlide) {
    return (
      <main id="main" className="mx-auto max-w-xl px-6 py-20">
        <Link to="/things/pitches" className="font-mono text-xs theme-muted hover:opacity-60">
          ← pitch wall
        </Link>
        <h1 className="mt-14 font-serif text-4xl text-foreground">We could not open this pitch.</h1>
        <p className="mt-4 font-serif text-lg leading-relaxed theme-muted">
          {message ||
            "Try again, or open the private link again on the device where you created it."}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-8 min-h-11 border-b theme-border-strong px-1 font-mono text-sm text-foreground hover:opacity-60"
        >
          try again →
        </button>
      </main>
    );
  }

  return (
    <main
      id="main"
      className="relative flex min-h-screen flex-col bg-background"
      onDragOver={(event) => event.preventDefault()}
      onPaste={(event) => {
        const pastedFiles = event.clipboardData.files;
        const file = pastedFiles[0];
        if (!file) return;
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest(".pitch-excalidraw") && dropFileKind(file) === "image") return;
        event.preventDefault();
        void handleDroppedFiles(
          pastedFiles,
          target?.closest("[data-pitch-drop-target='timeline']") ? "timeline" : "stage",
        );
      }}
      onDrop={(event) => {
        event.preventDefault();
        if (event.dataTransfer.files.length > 0) {
          void handleDroppedFiles(event.dataTransfer.files, "page");
        }
      }}
    >
      {dragKind ? (
        <div
          className="pointer-events-none fixed inset-0 z-[80] flex items-start justify-center p-8"
          aria-live="polite"
        >
          <div className="border-2 border-[var(--things-amber)] bg-background px-5 py-3 text-center shadow-lg">
            <p className="font-serif text-lg text-foreground">
              {dragKind === "image"
                ? "Drop the image on the slide"
                : dragKind === "audio"
                  ? "Drop sound on the media timeline"
                  : dragKind === "video"
                    ? "Drop video on the media timeline"
                    : "Drop to bring this file into the studio"}
            </p>
            <p className="mt-1 font-mono text-micro theme-muted">
              {dragKind === "presentation" || dragKind === "backup"
                ? "You will choose whether to add or replace before anything changes."
                : "Nothing changes until the file reaches the matching area."}
            </p>
          </div>
        </div>
      ) : null}
      <header className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b theme-border px-4 py-3">
        <Link to="/things/pitches" className="font-mono text-xs theme-muted hover:opacity-60">
          ← wall
        </Link>
        <input
          value={title}
          maxLength={120}
          aria-label="Pitch title"
          onChange={(event) => {
            setTitle(event.target.value);
            titleRef.current = event.target.value;
            markChanged("deck.rename", {});
          }}
          className="order-last min-w-0 basis-full bg-transparent font-serif text-xl text-foreground outline-none sm:order-none sm:flex-1 sm:basis-auto"
        />
        {!isDemo ? <PitchDeviceSwitcher deckId={deckId} /> : null}
        <span className="font-mono text-micro uppercase tracking-[0.12em] theme-muted">
          {isDemo
            ? "demo · not saved"
            : serverSavingPaused
              ? "server saving paused · safe here"
              : localSaveFailed
                ? "local backup needs attention"
                : syncState === "saved"
                  ? "saved"
                  : syncState === "syncing"
                    ? "syncing…"
                    : syncState === "merged"
                      ? "recovered + merged"
                      : syncState === "error"
                        ? "needs attention"
                        : navigator.onLine
                          ? "saved on this device"
                          : "offline · safe here"}
        </span>
        <button
          type="button"
          data-tour="publish"
          onClick={() => void publish()}
          disabled={isDemo || serverSavingPaused || syncState === "syncing" || hasUnsecuredMedia}
          className="min-h-10 bg-foreground px-5 font-mono text-xs text-background hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {isDemo
            ? "create to publish"
            : missingLocalImageFileIds.length > 0
              ? "images need recovery"
              : imageUploadFailure
                ? "image save needs retry"
                : hasUnsecuredMedia
                  ? `securing ${unsecuredImageFileIds.length} image${unsecuredImageFileIds.length === 1 ? "" : "s"}…`
                  : deck?.publishedAt
                    ? "publish new edition"
                    : "publish + seal"}
        </button>
      </header>

      {isDemo ? (
        <div
          className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 border-b border-[var(--things-amber)] bg-[var(--things-amber)] px-4 py-2 text-center font-mono text-xs text-foreground dark:text-background"
          role="status"
        >
          <span>
            Rehearsal mode · this tab is the only copy. Media uploads, saving and publishing are
            off.
          </span>
          <Link
            to="/things/pitches/new"
            className="text-foreground underline decoration-foreground underline-offset-4 hover:opacity-60 dark:text-background dark:decoration-background"
          >
            start one for real
          </Link>
        </div>
      ) : null}

      {serverSavingPaused ? (
        <div
          className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 border-b border-[var(--things-amber)] bg-[var(--selection-bg)] px-4 py-2 text-center font-mono text-xs text-[var(--selection-fg)]"
          role="status"
        >
          <span>{operational.message} This browser still keeps a local safety copy.</span>
          <button
            type="button"
            onClick={() => setExportOpen(true)}
            className="min-h-11 underline decoration-current underline-offset-4 hover:opacity-60"
          >
            download a copy
          </button>
        </div>
      ) : null}

      {!isDemo && hasUnsecuredMedia ? (
        <div
          className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 border-b theme-border px-4 py-2 text-center font-mono text-xs theme-muted"
          role="status"
        >
          <span>
            {missingLocalImageFileIds.length > 0
              ? `${missingLocalImageFileIds.length} image${missingLocalImageFileIds.length === 1 ? " is" : "s are"} referenced by this draft but not stored on this device. Open the pitch on the device that still shows them, or restore a .mahdeck backup from that device.`
              : imageUploadFailure
                ? `${imageUploadFailure.message} The original is still safe in this browser.`
                : activeImageUploadId
                  ? `Saving the original images to this pitch · ${unsecuredImageFileIds.length} remaining.`
                  : navigator.onLine
                    ? "Preparing the remaining images for safe storage."
                    : "The remaining images are safe in this browser and will save after reconnecting."}
          </span>
          {imageUploadFailure && missingLocalImageFileIds.length === 0 ? (
            <button
              type="button"
              onClick={retryImageUploads}
              className="min-h-11 underline decoration-current underline-offset-4 hover:opacity-60"
            >
              try image save again
            </button>
          ) : null}
          {missingLocalImageFileIds.length === 0 ? (
            <button
              type="button"
              onClick={() => setExportOpen(true)}
              className="min-h-11 underline decoration-current underline-offset-4 hover:opacity-60"
            >
              download safety copy
            </button>
          ) : null}
        </div>
      ) : null}

      {message ? (
        <div
          className="border-b theme-border px-4 py-2 text-center font-mono text-xs theme-muted"
          role="status"
        >
          {message}
          {undoEntry ? (
            <button
              type="button"
              onClick={undoLastAction}
              className="ml-3 font-semibold text-foreground underline underline-offset-4"
            >
              undo {undoEntry.label}
            </button>
          ) : null}
          {updateState === "ready" ? (
            <button
              type="button"
              disabled={!reloadSafe}
              onClick={() => void activateSiteUpdate()}
              className="ml-3 underline underline-offset-4 disabled:opacity-35"
            >
              {reloadSafe ? "finish update" : "saving locally…"}
            </button>
          ) : null}
          {!isDemo && syncState === "error" && updateState !== "ready" ? (
            <button
              type="button"
              onClick={() => {
                retryImageUploads();
                setSyncWake((value) => value + 1);
              }}
              className="ml-3 underline underline-offset-4"
            >
              try again
            </button>
          ) : null}
          {!isDemo && localSaveFailed ? (
            <button
              type="button"
              onClick={() => {
                setLocalSaveWake((value) => value + 1);
              }}
              className="ml-3 underline underline-offset-4"
            >
              retry safety copy
            </button>
          ) : null}
        </div>
      ) : null}

      <div
        className={`grid min-h-0 min-w-0 w-full flex-1 grid-rows-[auto_minmax(28rem,1fr)] transition-[grid-template-columns] duration-300 ease-out motion-reduce:transition-none ${
          railOpen ? "lg:grid-cols-[14rem_minmax(0,1fr)]" : "lg:grid-cols-[3.5rem_minmax(0,1fr)]"
        } lg:grid-rows-1`}
      >
        <aside
          data-tour="slides"
          className={`min-w-0 overflow-hidden border-b theme-border lg:border-b-0 lg:border-r ${
            railOpen ? "p-3" : "p-2"
          }`}
        >
          <div className="mb-2 flex items-center justify-between gap-1">
            <button
              type="button"
              onClick={() => setRailOpen((open) => !open)}
              className="min-h-10 min-w-10 font-mono text-xs theme-muted"
              aria-label={railOpen ? "Collapse slide rail" : "Open slide rail"}
            >
              {railOpen ? "←" : "→"}
            </button>
            {railOpen ? (
              <button
                type="button"
                onClick={() => setRailPinned((pinned) => !pinned)}
                className="min-h-10 px-2 font-mono text-micro theme-muted"
                aria-pressed={railPinned}
              >
                {railPinned ? "pinned" : "auto-hide"}
              </button>
            ) : null}
          </div>
          <div className={`flex gap-2 overflow-x-auto lg:flex-col ${railOpen ? "" : "hidden"}`}>
            {visibleSlides.map((slide, index) => (
              <button
                key={slide.id}
                type="button"
                onClick={() => {
                  setActiveSlideId(slide.id);
                  if (!railPinned) setRailOpen(false);
                }}
                className={`min-w-36 overflow-hidden border text-left font-mono text-xs lg:min-w-0 ${
                  slide.id === currentSlide.id
                    ? "theme-border-strong bg-surface text-foreground"
                    : "theme-border theme-muted hover:opacity-60"
                }`}
              >
                <span className="block aspect-video overflow-hidden border-b theme-border-faint bg-surface">
                  <PitchSlideThumbnail
                    slide={slide}
                    files={files}
                    className="h-full w-full object-cover"
                  />
                </span>
                <span className="flex items-center gap-2 px-2 py-2">
                  <span className="text-micro theme-faint">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="truncate">{slide.name}</span>
                </span>
              </button>
            ))}
            <button
              type="button"
              disabled={visibleSlides.length >= maximumSlides}
              onClick={addSlide}
              className="min-h-12 min-w-36 border border-dashed theme-border px-3 font-mono text-xs theme-muted hover:opacity-60 disabled:opacity-30 lg:min-w-0"
            >
              + slide
            </button>
          </div>
        </aside>

        <section className="flex min-h-0 min-w-0 w-full flex-col">
          <div
            ref={toolbarRef}
            className="z-10 shrink-0 border-b theme-border bg-background/90 backdrop-blur"
          >
            <div className="flex items-center gap-2 overflow-x-auto px-3 py-2">
              <button
                type="button"
                data-tour="preview"
                onClick={() => setPreviewOpen(true)}
                className="min-h-10 shrink-0 bg-foreground px-4 font-mono text-xs text-background hover:opacity-80"
              >
                preview
              </button>
              <input
                value={currentSlide.name}
                maxLength={80}
                aria-label="Current slide name"
                onChange={(event) => {
                  const name = event.target.value;
                  setDocumentState((current) =>
                    current
                      ? updateSlide(current, currentSlide.id, (slide) => ({
                          ...slide,
                          name,
                          version: slide.version + 1,
                          updatedAt: Date.now(),
                        }))
                      : current,
                  );
                  markChanged("slide.rename", { slideId: currentSlide.id });
                }}
                className="min-h-10 min-w-32 max-w-52 shrink bg-transparent px-2 font-mono text-xs text-foreground outline-none focus:border-b theme-border-strong"
              />
              <button
                type="button"
                onClick={() => setInkOpen(true)}
                className="min-h-10 shrink-0 border-b theme-border-strong px-2 font-mono text-xs hover:opacity-60"
              >
                draw on slide
              </button>
              <button
                type="button"
                aria-expanded={exportOpen}
                aria-controls="pitch-export-options"
                onClick={() => {
                  setExportOpen((open) => !open);
                  setImportOpen(false);
                }}
                className="min-h-10 shrink-0 border-b theme-border-strong px-2 font-mono text-xs hover:opacity-60"
              >
                export {exportOpen ? "↑" : "↓"}
              </button>
              {!isDemo ? (
                <button
                  type="button"
                  onClick={() => {
                    setHistoryOpen(true);
                    void loadVersionHistory();
                  }}
                  className="min-h-10 shrink-0 border-b theme-border-strong px-2 font-mono text-xs hover:opacity-60"
                >
                  history
                </button>
              ) : null}
              <button
                type="button"
                disabled={importing}
                aria-expanded={importOpen}
                aria-controls="pitch-import-options"
                onClick={() => {
                  setImportOpen((open) => !open);
                  setExportOpen(false);
                }}
                className="min-h-10 shrink-0 border-b theme-border-strong px-2 font-mono text-xs hover:opacity-60 disabled:opacity-40"
              >
                {importing ? "bringing slides in…" : `import ${importOpen ? "↑" : "↓"}`}
              </button>
              <button
                type="button"
                disabled={visibleSlides.length <= 1}
                onClick={deleteSlide}
                className="min-h-10 shrink-0 border-b theme-border px-2 font-mono text-xs theme-muted hover:opacity-60 disabled:opacity-30"
              >
                remove slide
              </button>
              <button
                type="button"
                onClick={() => setTourOpen(true)}
                className="ml-auto min-h-10 min-w-10 shrink-0 rounded-full border theme-border font-mono text-xs"
                aria-label="Open studio tutorial"
              >
                ?
              </button>
            </div>
            {importOpen ? (
              <div
                id="pitch-import-options"
                className="border-t theme-border px-4 py-4"
                role="dialog"
                aria-labelledby="pitch-import-title"
              >
                <div className="mx-auto flex max-w-3xl flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="max-w-xl">
                    <h2 id="pitch-import-title" className="font-serif text-xl text-foreground">
                      bring in slides
                    </h2>
                    <p className="mt-1 font-mono text-xs leading-relaxed theme-muted">
                      We will show the number of slides first. You can add them after the slides
                      already here or replace the current slides. Text and pictures keep their
                      positions and can be moved.
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={importing}
                      onClick={() => presentationInputRef.current?.click()}
                      className="min-h-11 border theme-border-strong px-3 font-mono text-xs text-foreground hover:opacity-60 disabled:opacity-40"
                    >
                      PowerPoint or PDF
                    </button>
                    <button
                      type="button"
                      disabled={importing}
                      onClick={() => backupInputRef.current?.click()}
                      className="min-h-11 border theme-border px-3 font-mono text-xs text-foreground hover:opacity-60 disabled:opacity-40"
                    >
                      studio backup
                    </button>
                  </div>
                </div>
                <p className="mx-auto mt-3 max-w-3xl font-mono text-micro leading-relaxed theme-muted">
                  Google Slides: choose{" "}
                  <span className="text-foreground">
                    File → Download → Microsoft PowerPoint (.pptx)
                  </span>
                  , then choose that file here. PDF imports are placed as slide images.
                </p>
                <input
                  ref={presentationInputRef}
                  type="file"
                  accept=".pdf,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation"
                  className="sr-only"
                  onChange={handleImportInput}
                />
                <input
                  ref={backupInputRef}
                  type="file"
                  accept=".mahdeck"
                  className="sr-only"
                  onChange={handleImportInput}
                />
              </div>
            ) : null}
            {exportOpen ? (
              <div
                id="pitch-export-options"
                className="border-t theme-border px-4 py-4"
                role="dialog"
                aria-labelledby="pitch-export-title"
              >
                <div className="mx-auto max-w-3xl">
                  <h2 id="pitch-export-title" className="font-serif text-xl text-foreground">
                    save a copy
                  </h2>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void runExport(exportCurrentPng)}
                      className="min-h-11 border theme-border-strong px-3 font-mono text-xs text-foreground hover:opacity-60"
                    >
                      current slide · PNG
                    </button>
                    <button
                      type="button"
                      onClick={() => void runExport(exportCurrentSvg)}
                      className="min-h-11 border theme-border px-3 font-mono text-xs text-foreground hover:opacity-60"
                    >
                      current slide · SVG
                    </button>
                    <button
                      type="button"
                      onClick={() => void runExport(exportDeckZip)}
                      className="min-h-11 border theme-border px-3 font-mono text-xs text-foreground hover:opacity-60"
                    >
                      all slides · ZIP
                    </button>
                    <button
                      type="button"
                      onClick={() => void runExport(exportDeck)}
                      className="min-h-11 border theme-border px-3 font-mono text-xs text-foreground hover:opacity-60"
                    >
                      editable studio backup
                    </button>
                  </div>
                  <p className="mt-3 font-mono text-micro leading-relaxed theme-muted">
                    PNG and SVG are static single-slide images and do not include playing media. ZIP
                    contains every slide as a PNG plus a self-contained .mahdeck studio backup with
                    its video and sound. The backup opens here; it is not an editable PowerPoint
                    file.
                  </p>
                </div>
              </div>
            ) : null}
          </div>
          <div
            data-tour="stage"
            className={`relative min-h-[24rem] flex-1 ${dragKind === "image" ? "ring-2 ring-inset ring-[var(--things-amber)]" : ""}`}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (event.dataTransfer.files.length > 0) {
                void handleDroppedFiles(event.dataTransfer.files, "stage");
              }
            }}
          >
            {currentSlide.elements.length === 0 ? (
              <div className="pointer-events-none absolute inset-x-0 top-20 z-20 flex justify-center px-6">
                <div className="max-w-sm bg-background/90 px-5 py-4 text-center">
                  <p className="font-serif text-lg text-foreground">start with a tool above</p>
                  <p className="mt-1 font-mono text-xs leading-relaxed theme-muted">
                    Choose text, image or shape, then click inside the 16:9 frame. You can also
                    import a whole presentation. Copy and paste canvas items as usual.
                  </p>
                </div>
              </div>
            ) : null}
            <div className="relative z-20 h-full">
              <ExcalidrawSurface
                key={`${currentSlide.id}:${sceneEpoch}`}
                slideId={currentSlide.id}
                elements={currentSlide.elements}
                files={files}
                transparentBackground={currentSlide.mediaClips.some(
                  (clip) => clip.kind === "video",
                )}
                stageUnderlay={
                  <PitchVideoLayer
                    slide={currentSlide}
                    assets={assets}
                    playheadMs={mediaClock.playheadMs}
                    playing={mediaClock.playing}
                  />
                }
                stageOverlay={
                  <PitchVideoStageControls
                    slide={currentSlide}
                    playheadMs={mediaClock.playheadMs}
                    selectedClipId={selectedMediaClipId}
                    onSelectClip={setSelectedMediaClipId}
                    onChange={(clipId, update) => {
                      const nextSlide = {
                        ...currentSlide,
                        mediaClips: currentSlide.mediaClips.map((clip) =>
                          clip.id === clipId && clip.kind === "video" ? update(clip) : clip,
                        ),
                        version: currentSlide.version + 1,
                        updatedAt: Date.now(),
                      };
                      setDocumentState((current) =>
                        current ? updateSlide(current, nextSlide.id, () => nextSlide) : current,
                      );
                      documentRef.current = documentRef.current
                        ? updateSlide(documentRef.current, nextSlide.id, () => nextSlide)
                        : documentRef.current;
                      markChanged("media.change", { slideId: nextSlide.id, clipId });
                    }}
                    onReorder={(clipId, direction) => {
                      const ordered = currentSlide.mediaClips
                        .filter((clip) => clip.kind === "video")
                        .toSorted(
                          (left, right) =>
                            (left.videoPlacement?.layer ?? 0) - (right.videoPlacement?.layer ?? 0),
                        );
                      const sourceIndex = ordered.findIndex((clip) => clip.id === clipId);
                      const targetIndex =
                        direction === "backward" ? sourceIndex - 1 : sourceIndex + 1;
                      if (sourceIndex < 0 || targetIndex < 0 || targetIndex >= ordered.length)
                        return;
                      [ordered[sourceIndex], ordered[targetIndex]] = [
                        ordered[targetIndex],
                        ordered[sourceIndex],
                      ];
                      const layerById = new Map(
                        ordered.map((clip, layer) => [clip.id, layer] as const),
                      );
                      const nextSlide = {
                        ...currentSlide,
                        mediaClips: currentSlide.mediaClips.map((clip) =>
                          clip.kind === "video"
                            ? {
                                ...clip,
                                videoPlacement: {
                                  ...(clip.videoPlacement ?? PITCH_VIDEO_DEFAULT_PLACEMENT),
                                  layer: layerById.get(clip.id) ?? 0,
                                },
                              }
                            : clip,
                        ),
                        version: currentSlide.version + 1,
                        updatedAt: Date.now(),
                      };
                      setDocumentState((current) =>
                        current ? updateSlide(current, nextSlide.id, () => nextSlide) : current,
                      );
                      documentRef.current = documentRef.current
                        ? updateSlide(documentRef.current, nextSlide.id, () => nextSlide)
                        : documentRef.current;
                      markChanged("media.change", { slideId: nextSlide.id, clipId });
                    }}
                  />
                }
                onApi={(api) => {
                  apiRef.current = api;
                }}
                onChange={onCanvasChange}
              />
            </div>
          </div>
          <PitchMediaTimeline
            slide={currentSlide}
            assets={assets}
            playheadMs={mediaClock.playheadMs}
            playing={mediaClock.playing}
            selectedClipId={selectedMediaClipId}
            onSelectClip={(clipId) => {
              setSelectedMediaClipId(clipId);
              const clip = currentSlide.mediaClips.find((candidate) => candidate.id === clipId);
              if (clip) mediaClock.setPlayheadMs(clip.timelineStartMs);
            }}
            disabledReason={
              isDemo
                ? "Media uploads are available once you start a saved pitch."
                : serverSavingPaused
                  ? "Media uploads are paused."
                  : undefined
            }
            processingLabel={
              mediaProgress
                ? mediaProgress.name.startsWith("uploading ")
                  ? mediaProgress.name
                  : `${mediaProgress.name} · ${Math.round(mediaProgress.progress * 100)}%`
                : undefined
            }
            onAddMedia={(file) => void attachMedia(file)}
            onDropFiles={(droppedFiles) => void handleDroppedFiles(droppedFiles, "timeline")}
            onScrub={mediaClock.setPlayheadMs}
            onTogglePlayback={mediaClock.toggle}
            onChange={(nextSlide, kind = "media.change") => {
              if (kind === "media.remove") rememberUndo("removing media");
              setDocumentState((current) =>
                current ? updateSlide(current, nextSlide.id, () => nextSlide) : current,
              );
              documentRef.current = documentRef.current
                ? updateSlide(documentRef.current, nextSlide.id, () => nextSlide)
                : documentRef.current;
              markChanged(kind, { slideId: nextSlide.id });
              if (kind === "media.remove") {
                setMessage("Media removed. You can undo this action.");
              }
            }}
          />
        </section>
      </div>
      {inkOpen ? <DrawesomeInk onCancel={() => setInkOpen(false)} onPlace={placeInk} /> : null}
      {previewOpen ? (
        <PitchPreview
          title={title}
          document={documentState}
          files={files}
          assets={assets}
          initialSlideId={currentSlide.id}
          onClose={() => setPreviewOpen(false)}
        />
      ) : null}
      {pendingMediaTrim ? (
        <PitchMediaTrimDialog
          file={pendingMediaTrim.file}
          sourceDurationMs={pendingMediaTrim.sourceDurationMs}
          kind={pendingMediaTrim.kind}
          onCancel={() => setPendingMediaTrim(undefined)}
          onConfirm={(selection) => {
            const file = pendingMediaTrim.file;
            setPendingMediaTrim(undefined);
            void attachMedia(file, selection);
          }}
        />
      ) : null}
      {historyOpen ? (
        <PitchVersionHistory
          items={historyItems}
          loading={historyLoading}
          current={{
            id: "current",
            version: deck?.version ?? 1,
            reason: "autosave",
            createdAt: deck?.updatedAt ?? new Date().toISOString(),
            slideCount: visibleSlides.length,
            contentCount: pitchDocumentContentCount(documentState),
            title,
            metadata: {},
            document: documentState,
          }}
          selectedId={selectedHistoryId}
          preview={historyPreview}
          previewLoading={historyPreviewLoading}
          previewError={historyPreviewError}
          files={files}
          deckId={deckId}
          restoringId={restoringHistoryId}
          onClose={() => {
            historyPreviewRequest.current += 1;
            setHistoryOpen(false);
            setSelectedHistoryId(undefined);
            setHistoryPreview(undefined);
            setHistoryPreviewLoading(false);
            setHistoryPreviewError("");
          }}
          onSelect={(item) => void selectVersionHistoryItem(item)}
          onRestore={(item) => void restoreVersion(item)}
        />
      ) : null}
      {pendingImport ? (
        <PitchImportDialog
          summary={pendingImport.summary}
          onCancel={() => setPendingImport(undefined)}
          onConfirm={(mode) => void confirmImport(mode)}
        />
      ) : null}
      {actionDialog}
      <GuidedTour
        open={tourOpen}
        steps={isDemo ? DEMO_TOUR_STEPS : TOUR_STEPS}
        onClose={() => {
          rememberPitchStudioTour();
          setTourOpen(false);
        }}
      />
    </main>
  );
}
