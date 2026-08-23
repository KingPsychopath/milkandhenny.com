import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertToExcalidrawElements, exportToBlob } from "@excalidraw/excalidraw";
import type {
  BinaryFileData,
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement, FileId } from "@excalidraw/excalidraw/element/types";

import { GuidedTour, type GuidedTourStep } from "@/components/GuidedTour";
import { activateSiteUpdate, useSiteUpdateState } from "@/features/offline/client";
import { useUpdateReloadSafety } from "@/features/offline/update-safety.client";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { useOutsideClick } from "@/hooks/useOutsideClick";
import {
  readLocalPitchDraft,
  pitchDeviceId,
  reconcileLocalPitchDraft,
  rememberPitchCredential,
  rememberTokenFromHash,
  saveLocalPitchDraft,
} from "../browser-store.client";
import { pitchDocumentContentCount } from "../document-content";
import { importPresentation, type ImportedPitchSlide } from "../import.client";
import { mergePitchDocuments } from "../merge";
import { createEmptyPitchDocument } from "../new-document.client";
import {
  createPitchAssetUploadFn,
  finalisePitchAssetFn,
  listPitchHistoryFn,
  publishPitchFn,
  readOwnedPitchFn,
  readPitchVersionFn,
  restorePitchVersionFn,
  syncPitchFn,
} from "../pitches.functions";
import {
  type OwnedPitchDeck,
  PITCH_AUDIO_MAX_BYTES,
  PITCH_AUDIO_MAX_SECONDS,
  PITCH_IMAGE_MAX_BYTES,
  PITCH_SLIDE_DEFAULT_DURATION_MS,
  type PitchDocument,
  type PitchCommandKind,
  type PitchCommandOperation,
  type PitchInkLayer,
  type PitchOwnerCredential,
  type PitchSlide,
  type PitchVersionHistoryItem,
  type PitchVersionPreview,
} from "../types";
import { parsePitchDocument } from "../validation";
import { ExcalidrawSurface } from "./ExcalidrawSurface";
import { blobToDataUrl, dataUrlToBlob, loadPitchFiles } from "./files.client";
import { DrawesomeInk } from "./DrawesomeInk";
import { PitchAudioTimeline } from "./PitchAudioTimeline";
import { PitchDeviceSwitcher } from "./PitchDeviceSwitcher";
import { PitchImportDialog, type PitchImportSummary } from "./PitchImportDialog";
import { PitchPreview } from "./PitchPreview";
import { PitchRecovery } from "./PitchRecovery";
import { PitchSlideThumbnail } from "./PitchSlideThumbnail";
import { PitchVersionHistory } from "./PitchVersionHistory";
import { fromPitchStageScene, pitchStageExport, toPitchStageScene } from "./pitch-stage.client";

const PITCH_STUDIO_TOUR_KEY = "milkandhenny:pitch-studio-tour:v1";
const PITCH_RAIL_KEY = "milkandhenny:pitch-studio-rail:v1";
let pitchStudioTourSeenThisSession = false;

const TOUR_STEPS: readonly GuidedTourStep[] = [
  {
    id: "slides",
    selector: "[data-tour='slides']",
    title: "Your six beats",
    body: "Each card is a real slide preview. Collapse this rail when you want the whole desk; pin it if you like seeing the shape of your argument.",
    side: "right",
  },
  {
    id: "stage",
    selector: "[data-tour='stage']",
    title: "Inside the line goes on screen",
    body: "The labelled 16:9 frame is the slide. You can still pan around the desk, but anything outside that frame is deliberately cut from preview, export and presentation.",
    side: "left",
  },
  {
    id: "sound",
    selector: "[data-tour='sound']",
    title: "Give the moment a sound",
    body: "Drop in up to four cues. Choose entry or exit, add a delay, and decide whether the sound stops with the slide or carries into the next one.",
    side: "top",
  },
  {
    id: "preview",
    selector: "[data-tour='preview']",
    title: "Watch it before the room does",
    body: "Preview uses the exact same slide bounds and sound rules as the audience screen. Slides only move when you press next, use an arrow key or hand over the remote.",
    side: "bottom",
  },
  {
    id: "publish",
    selector: "[data-tour='publish']",
    title: "Seal an edition",
    body: "Publishing freezes a public edition on the wall. Your private working copy stays editable, so you can improve it and seal a newer edition later.",
    side: "bottom",
  },
];

const DEMO_TOUR_STEPS: readonly GuidedTourStep[] = TOUR_STEPS.map((step) => {
  if (step.id === "sound") {
    return {
      ...step,
      title: "See how timing works",
      body: "Adjust the sound timeline and see where a cue would land. It never advances the slide. Sound uploads are switched off in this no-save rehearsal.",
    };
  }
  if (step.id === "publish") {
    return {
      ...step,
      title: "Create when it feels right",
      body: "Publishing is switched off here. Download anything you want to keep, then start a real pitch when you want saving, sound and a place on the wall.",
    };
  }
  return step;
});

function hasSeenPitchStudioTour(): boolean {
  if (pitchStudioTourSeenThisSession) return true;
  try {
    return localStorage.getItem(PITCH_STUDIO_TOUR_KEY) === "seen";
  } catch {
    return false;
  }
}

function rememberPitchStudioTour(): void {
  pitchStudioTourSeenThisSession = true;
  try {
    localStorage.setItem(PITCH_STUDIO_TOUR_KEY, "seen");
  } catch {
    // The session flag prevents repeated prompts when preferences are blocked.
  }
}

function randomId(prefix: string): string {
  return `${prefix}${crypto.randomUUID().replaceAll("-", "")}`;
}

function updateSlide(
  document: PitchDocument,
  slideId: string,
  updater: (slide: PitchSlide) => PitchSlide,
): PitchDocument {
  return {
    ...document,
    slides: document.slides.map((slide) => (slide.id === slideId ? updater(slide) : slide)),
  };
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function safeName(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "pitch"
  );
}

function friendlyImportError(error: unknown, fileName: string): string {
  const detail = error instanceof Error ? error.message : "";
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith(".mahdeck")) {
    return detail.startsWith("This deck")
      ? detail
      : "That backup could not be opened. Choose a .mahdeck backup downloaded from this studio.";
  }
  if (
    detail.startsWith("This deck") ||
    detail.startsWith("That PowerPoint") ||
    detail.startsWith("That presentation") ||
    detail.startsWith("Choose a PowerPoint") ||
    detail.includes("too large") ||
    detail.includes("allowance")
  ) {
    return detail;
  }
  if (detail === "Media upload failed") {
    return "We read the presentation, but could not save it to this pitch. Check your connection and try again.";
  }
  return "We could not read that presentation. Choose a .pptx PowerPoint file or PDF export. For Google Slides, download it as a PowerPoint first.";
}

function readBackupFiles(value: unknown): BinaryFiles {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: BinaryFiles = {};
  for (const [id, candidate] of Object.entries(value)) {
    if (
      !/^[A-Za-z0-9_-]{1,120}$/.test(id) ||
      !candidate ||
      typeof candidate !== "object" ||
      Array.isArray(candidate)
    ) {
      continue;
    }
    const file = candidate as Record<string, unknown>;
    if (
      typeof file.dataURL !== "string" ||
      !/^data:image\/(?:png|jpeg|webp|gif);base64,/.test(file.dataURL) ||
      typeof file.mimeType !== "string" ||
      !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.mimeType)
    ) {
      continue;
    }
    result[id] = {
      id: id as FileId,
      dataURL: file.dataURL as BinaryFileData["dataURL"],
      mimeType: file.mimeType as BinaryFileData["mimeType"],
      created: typeof file.created === "number" ? file.created : Date.now(),
    };
  }
  return result;
}

function rekeyBackup(
  source: PitchDocument,
  sourceFiles: BinaryFiles,
): { document: PitchDocument; files: BinaryFiles } {
  const fileIds = new Map<string, FileId>();
  const files: BinaryFiles = {};
  for (const [oldId, file] of Object.entries(sourceFiles)) {
    const newId = randomId("restored_") as FileId;
    fileIds.set(oldId, newId);
    files[newId] = { ...file, id: newId };
  }
  return {
    files,
    document: {
      ...source,
      slides: source.slides.map((slide) => ({
        ...slide,
        elements: slide.elements.map((element) =>
          element.type === "image" && element.fileId && fileIds.has(element.fileId)
            ? { ...element, fileId: fileIds.get(element.fileId)! }
            : element,
        ),
        assetIds: {},
        audioCues: [],
        inkLayers: slide.inkLayers?.map((layer) => ({
          ...layer,
          fileId: fileIds.get(layer.fileId) ?? layer.fileId,
        })),
      })),
    },
  };
}

function audioDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    const url = URL.createObjectURL(file);
    const release = () => URL.revokeObjectURL(url);
    audio.preload = "metadata";
    audio.onloadedmetadata = () => {
      const duration = audio.duration;
      release();
      resolve(duration);
    };
    audio.onerror = () => {
      release();
      reject(new Error("That sound file could not be read"));
    };
    audio.src = url;
  });
}

type DropFileKind = "image" | "audio" | "video" | "presentation" | "backup" | "other";

function dropFileKind(file: File): DropFileKind {
  const name = file.name.toLowerCase();
  if (name.endsWith(".mahdeck")) return "backup";
  if (
    file.type.startsWith("image/") ||
    [".png", ".jpg", ".jpeg", ".webp", ".gif"].some((extension) => name.endsWith(extension))
  ) {
    return "image";
  }
  if (
    file.type.startsWith("audio/") ||
    [".mp3", ".m4a", ".aac", ".ogg", ".wav", ".webm"].some((extension) => name.endsWith(extension))
  ) {
    return "audio";
  }
  if (
    file.type.startsWith("video/") ||
    [".mp4", ".mov", ".m4v", ".webm", ".avi"].some((extension) => name.endsWith(extension))
  ) {
    return "video";
  }
  if (file.type === "application/pdf" || name.endsWith(".pdf") || name.endsWith(".pptx")) {
    return "presentation";
  }
  return "other";
}

function imageSize(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    const release = () => URL.revokeObjectURL(url);
    image.onload = () => {
      const result = { width: image.naturalWidth, height: image.naturalHeight };
      release();
      resolve(result);
    };
    image.onerror = () => {
      release();
      reject(new Error("That image could not be read"));
    };
    image.src = url;
  });
}

export type PitchEditorSession = { kind: "owned"; deckId: string } | { kind: "demo" };

export function PitchEditor({
  session,
  maximumSlides,
}: {
  session: PitchEditorSession;
  maximumSlides: number;
}) {
  const isDemo = session.kind === "demo";
  const deckId = session.kind === "owned" ? session.deckId : "demo";
  const [demoDocument] = useState(() => (isDemo ? createEmptyPitchDocument() : undefined));
  const [credential, setCredential] = useState<PitchOwnerCredential>();
  const [deck, setDeck] = useState<OwnedPitchDeck>();
  const [documentState, setDocumentState] = useState<PitchDocument | undefined>(demoDocument);
  const [files, setFiles] = useState<BinaryFiles>({});
  const [title, setTitle] = useState(isDemo ? "A pitch worth trying" : "");
  const [activeSlideId, setActiveSlideId] = useState(demoDocument?.slides[0]?.id ?? "");
  const [phase, setPhase] = useState<"loading" | "ready" | "missing" | "error">(
    isDemo ? "ready" : "loading",
  );
  const [syncState, setSyncState] = useState<"saved" | "local" | "syncing" | "merged" | "error">(
    "local",
  );
  const [message, setMessage] = useState("");
  const [undoEntry, setUndoEntry] = useState<{
    label: string;
    title: string;
    document: PitchDocument;
    files: BinaryFiles;
    activeSlideId: string;
  }>();
  const [inkOpen, setInkOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyItems, setHistoryItems] = useState<PitchVersionHistoryItem[]>([]);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string>();
  const [historyPreview, setHistoryPreview] = useState<PitchVersionPreview>();
  const [historyPreviewLoading, setHistoryPreviewLoading] = useState(false);
  const [historyPreviewError, setHistoryPreviewError] = useState("");
  const [restoringHistoryId, setRestoringHistoryId] = useState<string>();
  const [railOpen, setRailOpen] = useState(true);
  const [railPinned, setRailPinned] = useState(true);
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [pendingImport, setPendingImport] = useState<{
    summary: PitchImportSummary;
    file: File;
    imported?: ImportedPitchSlide[];
    restored?: { document: PitchDocument; files: BinaryFiles };
    restoredTitle?: string;
  }>();
  const [dragKind, setDragKind] = useState<DropFileKind>();
  const [sceneEpoch, setSceneEpoch] = useState(0);
  const [revision, setRevision] = useState(0);
  const [localSavedRevision, setLocalSavedRevision] = useState(0);
  const [localSaveFailed, setLocalSaveFailed] = useState(false);
  const [localSaveWake, setLocalSaveWake] = useState(0);
  const [syncWake, setSyncWake] = useState(0);
  const [uploadWake, setUploadWake] = useState(0);
  const updateState = useSiteUpdateState();
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const uploading = useRef(new Set<string>());
  const revisionRef = useRef(0);
  const lastSyncedRevision = useRef(0);
  const syncing = useRef(false);
  const deviceIdRef = useRef("");
  const nextCommandSequence = useRef(1);
  const pendingOperations = useRef<PitchCommandOperation[]>([]);
  const historyPreviewRequest = useRef(0);
  const documentRef = useRef(documentState);
  const deckRef = useRef(deck);
  const filesRef = useRef(files);
  const titleRef = useRef(title);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const presentationInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);

  documentRef.current = documentState;
  deckRef.current = deck;
  filesRef.current = files;
  titleRef.current = title;

  const reloadSafe = isDemo
    ? revision === 0
    : !localSaveFailed &&
      localSavedRevision >= revision &&
      uploading.current.size === 0 &&
      syncState !== "syncing";
  useUpdateReloadSafety(`pitch-studio:${deckId}`, reloadSafe);

  useEscapeKey(() => {
    setImportOpen(false);
    setExportOpen(false);
  }, importOpen || exportOpen);
  useOutsideClick(
    toolbarRef,
    () => {
      setImportOpen(false);
      setExportOpen(false);
    },
    importOpen || exportOpen,
  );

  useEffect(() => {
    let dragDepth = 0;
    const hasFiles = (event: DragEvent) =>
      Array.from(event.dataTransfer?.items ?? []).some((item) => item.kind === "file");
    const kindFromEvent = (event: DragEvent): DropFileKind | undefined => {
      const file = event.dataTransfer?.files[0];
      if (file) return dropFileKind(file);
      const item = Array.from(event.dataTransfer?.items ?? []).find(
        (candidate) => candidate.kind === "file",
      );
      if (!item) return undefined;
      if (item.type.startsWith("image/")) return "image";
      if (item.type.startsWith("audio/")) return "audio";
      if (item.type.startsWith("video/")) return "video";
      return "presentation";
    };
    const onDragEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepth += 1;
      setDragKind(kindFromEvent(event));
    };
    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const onDragLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      dragDepth -= 1;
      if (dragDepth <= 0) {
        dragDepth = 0;
        setDragKind(undefined);
      }
    };
    const onDrop = () => {
      dragDepth = 0;
      setDragKind(undefined);
    };
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  useEffect(() => {
    if (!isDemo) {
      try {
        const rail = JSON.parse(localStorage.getItem(PITCH_RAIL_KEY) ?? "null") as unknown;
        if (rail && typeof rail === "object" && !Array.isArray(rail)) {
          const saved = rail as Record<string, unknown>;
          if (typeof saved.open === "boolean") setRailOpen(saved.open);
          if (typeof saved.pinned === "boolean") setRailPinned(saved.pinned);
        }
      } catch {
        // Private browsing may block preferences; the studio still works.
      }
    }

    if (hasSeenPitchStudioTour()) return;
    const timer = window.setTimeout(() => setTourOpen(true), 700);
    return () => window.clearTimeout(timer);
  }, [isDemo]);

  useEffect(() => {
    if (isDemo) return;
    try {
      localStorage.setItem(PITCH_RAIL_KEY, JSON.stringify({ open: railOpen, pinned: railPinned }));
    } catch {
      // A blocked preference store is non-critical.
    }
  }, [isDemo, railOpen, railPinned]);

  useEffect(() => {
    if (isDemo) return;
    let cancelled = false;
    void (async () => {
      const remembered = await rememberTokenFromHash(deckId).catch(() => undefined);
      const local = await readLocalPitchDraft(deckId).catch(() => undefined);
      if (cancelled) return;
      if (remembered) setCredential(remembered);
      if (local) {
        deviceIdRef.current = pitchDeviceId();
        pendingOperations.current = local.pendingOperations ?? [];
        nextCommandSequence.current = local.nextSequence ?? 1;
        setTitle(local.title);
        setDocumentState(local.document);
        setFiles(local.files);
        setActiveSlideId(local.document.slides.find((slide) => !slide.deletedAt)?.id ?? "");
        setSyncState("local");
        if (local.pendingSync) {
          setRevision(1);
          revisionRef.current = 1;
        }
      }
      if (!remembered) {
        if (!local) setPhase("missing");
        return;
      }
      const loadedRevision = revisionRef.current;
      try {
        const result = await readOwnedPitchFn({
          data: { deckId, ownerToken: remembered.token },
        });
        if (!result.ok) {
          setPhase(local ? "ready" : "missing");
          return;
        }
        const remote = result.value;
        const remoteFiles = await loadPitchFiles(remote.assets);
        if (revisionRef.current !== loadedRevision) {
          setDeck(remote);
          setDocumentState((current) =>
            current ? mergePitchDocuments(remote.document, current) : remote.document,
          );
          setFiles((current) => ({ ...remoteFiles, ...current }));
          setSceneEpoch((value) => value + 1);
          setSyncState("local");
          setPhase("ready");
          return;
        }
        const workingCopy = reconcileLocalPitchDraft(remote, local);
        setDeck(remote);
        if (!workingCopy.pendingSync) {
          setTitle(workingCopy.title);
          setDocumentState(workingCopy.document);
          setFiles({ ...remoteFiles, ...(local?.files ?? {}) });
          setActiveSlideId(workingCopy.document.slides.find((slide) => !slide.deletedAt)?.id ?? "");
          setSyncState("saved");
        } else {
          setTitle(workingCopy.title);
          setDocumentState(workingCopy.document);
          setFiles({ ...remoteFiles, ...(local?.files ?? {}) });
          setActiveSlideId(workingCopy.document.slides.find((slide) => !slide.deletedAt)?.id ?? "");
          setSyncState("local");
          if (revisionRef.current === 0) {
            setRevision(1);
            revisionRef.current = 1;
          }
        }
        setPhase("ready");
      } catch {
        setMessage(
          navigator.onLine
            ? "We could not reach this pitch right now. Try again in a moment."
            : "You are offline and this pitch is not saved on this device yet. Reconnect and try again.",
        );
        setPhase(local ? "ready" : "error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deckId, isDemo]);

  const markChanged = useCallback(
    (
      kind: PitchCommandKind = "element.change",
      payload: Record<string, string | number | boolean | null> = {},
    ) => {
      const deviceId = deviceIdRef.current || pitchDeviceId();
      deviceIdRef.current = deviceId;
      const last = pendingOperations.current.at(-1);
      if (
        kind === "element.change" &&
        last?.kind === kind &&
        last.payload.slideId === payload.slideId
      ) {
        pendingOperations.current = [
          ...pendingOperations.current.slice(0, -1),
          { ...last, payload, occurredAt: new Date().toISOString() },
        ];
      } else {
        pendingOperations.current = [
          ...pendingOperations.current,
          {
            id: randomId("m_"),
            deviceId,
            sequence: nextCommandSequence.current,
            kind,
            payload,
            occurredAt: new Date().toISOString(),
          },
        ];
        nextCommandSequence.current += 1;
      }
      revisionRef.current += 1;
      setRevision(revisionRef.current);
      setSyncState("local");
    },
    [],
  );

  useEffect(() => {
    if (isDemo || !documentState || phase !== "ready") return;
    const timer = window.setTimeout(() => {
      const savedRevision = revision;
      void saveLocalPitchDraft({
        deckId,
        title,
        document: documentState,
        files,
        pendingSync: revision > lastSyncedRevision.current,
        updatedAt: new Date().toISOString(),
        pendingOperations: pendingOperations.current,
        nextSequence: nextCommandSequence.current,
      })
        .then(() => {
          setLocalSavedRevision((current) => Math.max(current, savedRevision));
          setLocalSaveFailed(false);
          setMessage((current) =>
            current.startsWith("This browser could not update its safety copy.") ? "" : current,
          );
        })
        .catch(() => {
          setLocalSaveFailed(true);
          setMessage(
            "This browser could not update its safety copy. Keep this tab open, free some device storage if needed, then try again.",
          );
        });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [deck?.version, deckId, documentState, files, isDemo, localSaveWake, phase, revision, title]);

  const performSync = useCallback(async () => {
    const currentDeck = deckRef.current;
    const currentDocument = documentRef.current;
    const currentTitle = titleRef.current;
    if (isDemo || !credential || !currentDeck || !currentDocument || !navigator.onLine) {
      return false;
    }
    if (syncing.current) return false;
    if (revisionRef.current <= lastSyncedRevision.current) return true;
    syncing.current = true;
    const sentRevision = revisionRef.current;
    const sentOperations = [...pendingOperations.current];
    if (sentOperations.length === 0) {
      markChanged("deck.replace", { reason: "recovered unjournalled local draft" });
      syncing.current = false;
      return false;
    }
    setSyncState("syncing");
    try {
      const result = await syncPitchFn({
        data: {
          deckId,
          ownerToken: credential.token,
          baseVersion: currentDeck.version,
          mutationId: sentOperations[0].id,
          title: currentTitle,
          document: currentDocument,
          operations: sentOperations,
        },
      });
      if (!result.ok) {
        setSyncState("error");
        setMessage(result.error);
        return false;
      }
      lastSyncedRevision.current = sentRevision;
      const sentIds = new Set(sentOperations.map((operation) => operation.id));
      pendingOperations.current = pendingOperations.current.filter(
        (operation) => !sentIds.has(operation.id),
      );
      deckRef.current = result.value.deck;
      setDeck(result.value.deck);
      if (result.value.merged) {
        const mergedDocument = mergePitchDocuments(
          result.value.deck.document,
          documentRef.current ?? result.value.deck.document,
        );
        documentRef.current = mergedDocument;
        setDocumentState(mergedDocument);
        setSceneEpoch((value) => value + 1);
        setSyncState("merged");
        setMessage(
          "Two saved copies were consolidated. Review slide order, timing and sound where both devices changed the same slide.",
        );
      } else {
        const fullySynced = revisionRef.current === sentRevision;
        if (fullySynced) {
          await saveLocalPitchDraft({
            deckId,
            title: currentTitle,
            document: currentDocument,
            files: filesRef.current,
            pendingSync: pendingOperations.current.length > 0,
            updatedAt: result.value.deck.updatedAt,
            pendingOperations: pendingOperations.current,
            nextSequence: nextCommandSequence.current,
          });
          setLocalSavedRevision((current) => Math.max(current, sentRevision));
          setLocalSaveFailed(false);
        }
        setSyncState(fullySynced ? "saved" : "local");
      }
      await rememberPitchCredential({
        ...credential,
        title: currentTitle,
        ownerName: result.value.deck.ownerName,
        updatedAt: result.value.deck.updatedAt,
      });
      return revisionRef.current === sentRevision;
    } catch {
      setSyncState("local");
      setMessage(
        updateState === "ready"
          ? "A site update interrupted the server save. Your working copy is safe here; finish the update, then it will sync."
          : navigator.onLine
            ? "The server save was interrupted. Your working copy is safe here and will try again."
            : "You’re offline. Your working copy is safe here and will sync when you reconnect.",
      );
      return false;
    } finally {
      syncing.current = false;
      if (revisionRef.current > sentRevision) setSyncWake((value) => value + 1);
    }
  }, [credential, deckId, isDemo, markChanged, updateState]);

  useEffect(() => {
    if (isDemo || revision <= lastSyncedRevision.current) return;
    const timer = window.setTimeout(() => void performSync(), 1_800);
    return () => window.clearTimeout(timer);
  }, [isDemo, performSync, revision, syncWake]);

  useEffect(() => {
    if (isDemo) return;
    const online = () => {
      setSyncWake((value) => value + 1);
      void performSync();
    };
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, [isDemo, performSync]);

  useEffect(() => {
    const hasUnwrittenChanges = isDemo ? revision > 0 : localSavedRevision < revision;
    if (!hasUnwrittenChanges) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [isDemo, localSavedRevision, revision]);

  const currentSlide = useMemo(
    () => documentState?.slides.find((slide) => slide.id === activeSlideId && !slide.deletedAt),
    [activeSlideId, documentState],
  );
  const visibleSlides = useMemo(
    () => documentState?.slides.filter((slide) => !slide.deletedAt) ?? [],
    [documentState],
  );
  const hasUnsecuredMedia = useMemo(
    () =>
      !isDemo &&
      visibleSlides.some((slide) =>
        slide.elements.some(
          (element) =>
            element.type === "image" && Boolean(element.fileId) && !slide.assetIds[element.fileId!],
        ),
      ),
    [isDemo, visibleSlides],
  );

  const uploadBlob = useCallback(
    async (
      blob: Blob,
      input: {
        kind: "image" | "audio" | "thumbnail" | "import";
        fileName: string;
        fileId?: string;
      },
    ) => {
      if (!credential) throw new Error("Editing key missing");
      const reserved = await createPitchAssetUploadFn({
        data: {
          deckId,
          ownerToken: credential.token,
          fileId: input.fileId,
          kind: input.kind,
          fileName: input.fileName,
          mimeType: blob.type,
          bytes: blob.size,
        },
      });
      if (!reserved.ok) throw new Error(reserved.error);
      const uploaded = await fetch(reserved.value.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": blob.type },
        body: blob,
      });
      if (!uploaded.ok) throw new Error("Media upload failed");
      const finalised = await finalisePitchAssetFn({
        data: {
          deckId,
          ownerToken: credential.token,
          assetId: reserved.value.asset.id,
        },
      });
      if (!finalised.ok) throw new Error(finalised.error);
      return finalised.value;
    },
    [credential, deckId],
  );

  useEffect(() => {
    if (!documentState || !currentSlide || !credential) return;
    for (const [fileId, file] of Object.entries(files)) {
      const known = documentState.slides.some((slide) => Boolean(slide.assetIds[fileId]));
      if (known || uploading.current.has(fileId)) continue;
      uploading.current.add(fileId);
      void dataUrlToBlob(file.dataURL)
        .then((blob) =>
          uploadBlob(blob, {
            kind: "image",
            fileName: `${fileId}.${blob.type.split("/")[1] || "png"}`,
            fileId,
          }),
        )
        .then((asset) => {
          setDocumentState((current) =>
            current
              ? updateSlide(current, currentSlide.id, (slide) => ({
                  ...slide,
                  assetIds: { ...slide.assetIds, [fileId]: asset.id },
                  version: slide.version + 1,
                  updatedAt: Date.now(),
                }))
              : current,
          );
          markChanged("element.change", { slideId: currentSlide.id, assetLinked: fileId });
        })
        .catch(() => {
          setSyncState("error");
          setMessage(
            updateState === "ready"
              ? "A site update interrupted this image upload. Your image is safe on this device."
              : navigator.onLine
                ? "This image could not reach storage. It is safe on this device; try the upload again."
                : "This image is safe on this device and will upload when you reconnect.",
          );
        })
        .finally(() => uploading.current.delete(fileId));
    }
  }, [
    credential,
    currentSlide,
    documentState,
    files,
    markChanged,
    updateState,
    uploadBlob,
    uploadWake,
  ]);

  function onCanvasChange(
    slideId: string,
    elements: readonly ExcalidrawElement[],
    nextFiles: BinaryFiles,
  ) {
    if (!documentRef.current?.slides.some((slide) => slide.id === slideId && !slide.deletedAt)) {
      return;
    }
    setFiles((current) => ({ ...current, ...nextFiles }));
    filesRef.current = { ...filesRef.current, ...nextFiles };
    const nextDocument = documentRef.current
      ? updateSlide(documentRef.current, slideId, (slide) => ({
          ...slide,
          elements,
          version: slide.version + 1,
          updatedAt: Date.now(),
        }))
      : undefined;
    if (!nextDocument) return;
    documentRef.current = nextDocument;
    setDocumentState(nextDocument);
    markChanged("element.change", { slideId });
  }

  function flushCanvasState() {
    const api = apiRef.current;
    const current = documentRef.current;
    if (!api || !currentSlide || !current) return;

    const nextFiles = api.getFiles();
    filesRef.current = { ...filesRef.current, ...nextFiles };
    setFiles(filesRef.current);
    const elements = fromPitchStageScene(currentSlide.id, api.getSceneElementsIncludingDeleted());
    const nextDocument = updateSlide(current, currentSlide.id, (slide) => ({
      ...slide,
      elements,
      version: slide.version + 1,
      updatedAt: Date.now(),
    }));
    documentRef.current = nextDocument;
    setDocumentState(nextDocument);
    markChanged("element.change", { slideId: currentSlide.id, source: "canvas flush" });
  }

  function addSlide() {
    if (!documentState || visibleSlides.length >= maximumSlides) return;
    const id = randomId("s_");
    setDocumentState({
      ...documentState,
      slides: [
        ...documentState.slides,
        {
          id,
          name: `Slide ${visibleSlides.length + 1}`,
          version: 1,
          updatedAt: Date.now(),
          durationMs: PITCH_SLIDE_DEFAULT_DURATION_MS,
          elements: [],
          assetIds: {},
          audioCues: [],
        },
      ],
    });
    setActiveSlideId(id);
    markChanged("slide.add", { slideId: id });
  }

  function rememberUndo(label: string) {
    const document = documentRef.current;
    if (!document) return;
    setUndoEntry({
      label,
      title: titleRef.current,
      document,
      files: filesRef.current,
      activeSlideId,
    });
  }

  function undoLastAction() {
    if (!undoEntry) return;
    titleRef.current = undoEntry.title;
    documentRef.current = undoEntry.document;
    filesRef.current = undoEntry.files;
    setTitle(undoEntry.title);
    setDocumentState(undoEntry.document);
    setFiles(undoEntry.files);
    setActiveSlideId(undoEntry.activeSlideId);
    setSceneEpoch((value) => value + 1);
    markChanged("history.undo", { action: undoEntry.label });
    setMessage(`Undid ${undoEntry.label}.`);
    setUndoEntry(undefined);
  }

  function deleteSlide() {
    if (!documentState || !currentSlide || visibleSlides.length <= 1) return;
    rememberUndo(`removing “${currentSlide.name}”`);
    const index = visibleSlides.findIndex((slide) => slide.id === currentSlide.id);
    setDocumentState(
      updateSlide(documentState, currentSlide.id, (slide) => ({
        ...slide,
        deletedAt: Date.now(),
        version: slide.version + 1,
        updatedAt: Date.now(),
      })),
    );
    setActiveSlideId(visibleSlides[Math.max(0, index - 1)]?.id ?? visibleSlides[1]?.id ?? "");
    markChanged("slide.remove", { slideId: currentSlide.id });
    setMessage(`Removed “${currentSlide.name}”. You can undo this action.`);
  }

  async function attachAudio(file: File) {
    if (isDemo) {
      setMessage("Sound uploads are available once you start a saved pitch.");
      return;
    }
    if (!file || !currentSlide) return;
    if (file.size > PITCH_AUDIO_MAX_BYTES) {
      setMessage("That sound is too large. Choose a sound file under 15 MB.");
      return;
    }
    try {
      const durationSeconds = await audioDuration(file);
      if (!Number.isFinite(durationSeconds) || durationSeconds > PITCH_AUDIO_MAX_SECONDS) {
        throw new Error(`Keep slide sounds under ${PITCH_AUDIO_MAX_SECONDS / 60} minutes`);
      }
      const asset = await uploadBlob(file, { kind: "audio", fileName: file.name });
      const durationMs = Math.max(1, Math.round(durationSeconds * 1_000));
      setDocumentState((current) =>
        current
          ? updateSlide(current, currentSlide.id, (slide) => ({
              ...slide,
              audioCues: [
                ...slide.audioCues,
                {
                  id: randomId("cue_"),
                  assetId: asset.id,
                  trigger: "enter",
                  delayMs: 0,
                  sourceDurationMs: durationMs,
                  startAtMs: 0,
                  playForMs: durationMs,
                  volume: 0.85,
                  end: "slide-exit",
                },
              ],
              version: slide.version + 1,
              updatedAt: Date.now(),
            }))
          : current,
      );
      setDeck((current) =>
        current ? { ...current, assets: [...current.assets, asset] } : current,
      );
      markChanged("audio.add", { slideId: currentSlide.id, assetId: asset.id });
      setMessage("Sound added. Set its timing below, then test it in preview.");
    } catch (error) {
      setSyncState("error");
      setMessage(error instanceof Error ? error.message : "Sound upload failed");
    }
  }

  async function placeImage(file: File) {
    if (!currentSlide) return;
    if (file.size > PITCH_IMAGE_MAX_BYTES) {
      setMessage("That image is too large. Choose an image under 10 MB.");
      return;
    }
    try {
      const [size, dataURL] = await Promise.all([imageSize(file), blobToDataUrl(file)]);
      const scale = Math.min(1, 720 / Math.max(1, size.width), 400 / Math.max(1, size.height));
      const width = Math.max(1, size.width * scale);
      const height = Math.max(1, size.height * scale);
      const fileId = randomId("image_") as FileId;
      const imageFile: BinaryFileData = {
        id: fileId,
        dataURL,
        mimeType: (file.type || "image/png") as BinaryFileData["mimeType"],
        created: Date.now(),
      };
      const [image] = convertToExcalidrawElements(
        [
          {
            type: "image",
            x: (960 - width) / 2,
            y: (540 - height) / 2,
            width,
            height,
            fileId,
            customData: { pitchImport: "dropped-image" },
          },
        ],
        { regenerateIds: true },
      );
      const nextElements = [...currentSlide.elements, image];
      const nextFiles = { ...filesRef.current, [fileId]: imageFile };
      const nextDocument = documentRef.current
        ? updateSlide(documentRef.current, currentSlide.id, (slide) => ({
            ...slide,
            elements: nextElements,
            version: slide.version + 1,
            updatedAt: Date.now(),
          }))
        : undefined;
      if (!nextDocument) return;
      filesRef.current = nextFiles;
      documentRef.current = nextDocument;
      setFiles(nextFiles);
      setDocumentState(nextDocument);
      apiRef.current?.addFiles([imageFile]);
      apiRef.current?.updateScene({
        elements: toPitchStageScene(currentSlide.id, nextElements).elements,
      });
      markChanged("image.add", { slideId: currentSlide.id, fileId });
      setMessage("Image placed in the middle of the slide. Move it wherever you like.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "That image could not be placed");
    }
  }

  async function placeInk(input: {
    name: string;
    strokes: PitchInkLayer["strokes"];
    board: PitchInkLayer["board"];
    blob: Blob;
  }) {
    if (!currentSlide) return;
    const layerId = randomId("ink_");
    const fileId = randomId("inkfile_") as FileId;
    const dataURL = await blobToDataUrl(input.blob);
    const file: BinaryFileData = {
      id: fileId,
      dataURL,
      mimeType: "image/png",
      created: Date.now(),
    };
    const [image] = convertToExcalidrawElements(
      [
        {
          type: "image",
          x: 0,
          y: 0,
          width: 960,
          height: 540,
          fileId,
          customData: { pitchInkLayerId: layerId },
        },
      ],
      { regenerateIds: true },
    );
    const nextElements = [...currentSlide.elements, image];
    const layer: PitchInkLayer = {
      id: layerId,
      name: input.name,
      board: input.board,
      strokes: input.strokes,
      fileId,
      updatedAt: Date.now(),
    };
    setFiles((current) => ({ ...current, [fileId]: file }));
    setDocumentState((current) =>
      current
        ? updateSlide(current, currentSlide.id, (slide) => ({
            ...slide,
            elements: nextElements,
            inkLayers: [...(slide.inkLayers ?? []), layer],
            version: slide.version + 1,
            updatedAt: Date.now(),
          }))
        : current,
    );
    apiRef.current?.addFiles([file]);
    apiRef.current?.updateScene({
      elements: toPitchStageScene(currentSlide.id, nextElements).elements,
    });
    markChanged("ink.add", { slideId: currentSlide.id, layerId });
    setInkOpen(false);
  }

  async function importFile(file: File) {
    if (!file || !documentState) return;
    setImportOpen(false);
    setImporting(true);
    setMessage(`Reading ${file.name}…`);
    try {
      if (file.name.toLowerCase().endsWith(".mahdeck")) {
        const raw = JSON.parse(await file.text()) as unknown;
        const backup =
          raw && typeof raw === "object" && !Array.isArray(raw)
            ? (raw as Record<string, unknown>)
            : null;
        const source = backup?.document ?? raw;
        const parsed = parsePitchDocument(source, maximumSlides);
        if (!parsed.ok) throw new Error(parsed.error);
        const backupFiles = readBackupFiles(backup?.files);
        const sameDeck = !isDemo && backup?.deckId === deckId;
        const restored = sameDeck
          ? { document: parsed.document, files: backupFiles }
          : rekeyBackup(parsed.document, backupFiles);
        setPendingImport({
          file,
          restored,
          restoredTitle: typeof backup?.title === "string" ? backup.title : undefined,
          summary: {
            fileName: file.name,
            kind: "backup",
            importedSlides: restored.document.slides.filter((slide) => !slide.deletedAt).length,
            currentSlides: visibleSlides.length,
            maximumSlides,
          },
        });
        return;
      }

      const allImported = await importPresentation(file, maximumSlides);
      if (allImported.length === 0) throw new Error("That presentation contained no usable slides");
      setPendingImport({
        file,
        imported: allImported,
        summary: {
          fileName: file.name,
          kind: "presentation",
          importedSlides: allImported.length,
          currentSlides: visibleSlides.length,
          maximumSlides,
        },
      });
    } catch (error) {
      setSyncState("error");
      setMessage(friendlyImportError(error, file.name));
    } finally {
      setImporting(false);
    }
  }

  async function confirmImport(mode: "append" | "replace") {
    if (!pendingImport || !documentState) return;
    setImporting(true);
    setPendingImport(undefined);
    try {
      if (pendingImport.restored) {
        rememberUndo("replacing the deck from a backup");
        const restoredDocument = pendingImport.restored.document;
        documentRef.current = restoredDocument;
        setDocumentState(restoredDocument);
        setSceneEpoch((value) => value + 1);
        setActiveSlideId(restoredDocument.slides.find((slide) => !slide.deletedAt)?.id ?? "");
        setFiles(pendingImport.restored.files);
        if (pendingImport.restoredTitle) setTitle(pendingImport.restoredTitle);
        markChanged("deck.replace", { source: "native backup" });
        setMessage(
          isDemo
            ? "Native backup opened for this rehearsal. Download it again if you want to keep your changes."
            : Object.keys(pendingImport.restored.files).length > 0
              ? "Native backup restored. Its images are being secured to this pitch."
              : "Native backup restored.",
        );
        return;
      }

      const allImported = pendingImport.imported ?? [];
      const imported =
        mode === "append"
          ? allImported.slice(0, Math.max(0, maximumSlides - visibleSlides.length))
          : allImported;
      if (imported.length === 0)
        throw new Error(`This deck already has all ${maximumSlides} slides`);
      if (!isDemo) {
        const importedAsset = await uploadBlob(pendingImport.file, {
          kind: "import",
          fileName: pendingImport.file.name,
        });
        setDeck((current) =>
          current ? { ...current, assets: [...current.assets, importedAsset] } : current,
        );
      }
      const created = imported.map((slide) => ({
        id: randomId("s_"),
        name: slide.name,
        version: 1,
        updatedAt: Date.now(),
        durationMs: PITCH_SLIDE_DEFAULT_DURATION_MS,
        elements: slide.elements,
        assetIds: {},
        audioCues: [],
      }));
      const importedFiles = imported.reduce(
        (all, slide) => ({ ...all, ...slide.files }),
        {} as BinaryFiles,
      );
      const nextDocument = {
        ...documentState,
        slides: mode === "replace" ? created : [...documentState.slides, ...created],
      };
      if (mode === "replace") rememberUndo("replacing all slides");
      setFiles((current) =>
        mode === "replace" ? importedFiles : { ...current, ...importedFiles },
      );
      setDocumentState(nextDocument);
      documentRef.current = nextDocument;
      setActiveSlideId(created[0].id);
      markChanged(mode === "replace" ? "deck.replace" : "slide.add", {
        source: "presentation import",
        slideCount: created.length,
      });
      setMessage(
        mode === "replace"
          ? `Replaced the current slides with ${created.length} imported slide${created.length === 1 ? "" : "s"}.`
          : created.length < allImported.length
            ? `Added ${created.length} slides; the deck limit is ${maximumSlides}.`
            : `Added ${created.length} slides. Text and pictures are movable.`,
      );
    } catch (error) {
      setSyncState("error");
      setMessage(friendlyImportError(error, pendingImport.file.name));
    } finally {
      setImporting(false);
    }
  }

  function handleImportInput(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void importFile(file);
  }

  function handleDroppedFile(file: File, target: "stage" | "timeline" | "page") {
    setDragKind(undefined);
    const kind = dropFileKind(file);
    if (target === "stage" && kind === "image") {
      void placeImage(file);
      return;
    }
    if (target === "timeline" && kind === "audio") {
      void attachAudio(file);
      return;
    }
    if (
      (target === "page" || target === "stage") &&
      (kind === "presentation" || kind === "backup")
    ) {
      void importFile(file);
      return;
    }
    if (kind === "video") {
      setMessage(
        "Video drops are not available yet. The video timeline will come later; nothing was uploaded.",
      );
      return;
    }
    if (kind === "audio") {
      setMessage("Drop sound on the sound + timing timeline at the bottom of the studio.");
      return;
    }
    if (kind === "image") {
      setMessage("Drop an image inside the 16:9 slide frame.");
      return;
    }
    setMessage(
      "We could not identify that file. Choose a .pptx, PDF, .mahdeck backup, image or sound file.",
    );
  }

  async function publish() {
    if (isDemo || !credential || !currentSlide || !documentState) return;
    if (!navigator.onLine) {
      setMessage("Reconnect before publishing. Your working copy is safe on this device.");
      return;
    }
    flushCanvasState();
    const currentDocument = documentRef.current;
    const currentVisibleSlides = currentDocument?.slides.filter((slide) => !slide.deletedAt) ?? [];
    const currentHasUnsecuredMedia = currentVisibleSlides.some((slide) =>
      slide.elements.some(
        (element) =>
          element.type === "image" && Boolean(element.fileId) && !slide.assetIds[element.fileId!],
      ),
    );
    if (currentHasUnsecuredMedia) {
      setMessage("Finishing your image uploads first…");
      return;
    }
    setMessage("Saving and sealing this edition…");
    if (!(await performSync())) {
      setMessage("A newer change is still saving. Publish again when the status says saved.");
      return;
    }
    try {
      let thumbnailAssetId: string | undefined;
      const api = apiRef.current;
      const cover = currentVisibleSlides[0];
      if (api && cover) {
        const stage = pitchStageExport(cover.id, cover.elements);
        const thumbnail = await exportToBlob({
          ...stage,
          files,
          appState: {
            ...api.getAppState(),
            exportBackground: true,
            frameRendering: { enabled: true, clip: true, name: false, outline: false },
          },
          mimeType: "image/png",
          maxWidthOrHeight: 1_200,
          exportPadding: 0,
        });
        thumbnailAssetId = (
          await uploadBlob(thumbnail, {
            kind: "thumbnail",
            fileName: `${safeName(title)}-cover.png`,
          })
        ).id;
      }
      const result = await publishPitchFn({
        data: { deckId, ownerToken: credential.token, thumbnailAssetId },
      });
      if (!result.ok) throw new Error(result.error);
      setDeck(result.value);
      setMessage(
        `Published edition ${result.value.currentEditionNumber ?? 1}. It is sealed and remains addressable after later editions.`,
      );
      setSyncState("saved");
    } catch (error) {
      setSyncState("error");
      setMessage(error instanceof Error ? error.message : "Could not publish this pitch");
    }
  }

  async function loadVersionHistory() {
    if (!credential) return;
    setHistoryLoading(true);
    try {
      const result = await listPitchHistoryFn({
        data: { deckId, ownerToken: credential.token },
      });
      if (!result.ok) throw new Error(result.error);
      setHistoryItems(result.value);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load version history");
    } finally {
      setHistoryLoading(false);
    }
  }

  async function selectVersionHistoryItem(item?: PitchVersionHistoryItem) {
    const request = historyPreviewRequest.current + 1;
    historyPreviewRequest.current = request;
    setSelectedHistoryId(item?.id);
    setHistoryPreview(undefined);
    setHistoryPreviewError("");
    if (!item || !credential) {
      setHistoryPreviewLoading(false);
      return;
    }
    setHistoryPreviewLoading(true);
    try {
      const result = await readPitchVersionFn({
        data: { deckId, ownerToken: credential.token, backupId: item.id },
      });
      if (!result.ok) throw new Error(result.error);
      if (historyPreviewRequest.current === request) setHistoryPreview(result.value);
    } catch (error) {
      if (historyPreviewRequest.current === request) {
        const nextMessage =
          error instanceof Error ? error.message : "Could not preview that version";
        setHistoryPreviewError(nextMessage);
        setMessage(nextMessage);
      }
    } finally {
      if (historyPreviewRequest.current === request) setHistoryPreviewLoading(false);
    }
  }

  async function restoreVersion(item: PitchVersionHistoryItem) {
    if (!credential) return;
    flushCanvasState();
    setRestoringHistoryId(item.id);
    setMessage("Saving the current version before restoring…");
    try {
      if (!(await performSync())) {
        throw new Error("The current version is still saving. Try the restore again in a moment.");
      }
      const result = await restorePitchVersionFn({
        data: { deckId, ownerToken: credential.token, backupId: item.id },
      });
      if (!result.ok) throw new Error(result.error);
      const restored = result.value;
      const restoredFiles = await loadPitchFiles(restored.assets).catch(() => ({}));
      const nextRevision = revisionRef.current + 1;
      revisionRef.current = nextRevision;
      lastSyncedRevision.current = nextRevision;
      documentRef.current = restored.document;
      deckRef.current = restored;
      filesRef.current = restoredFiles;
      titleRef.current = restored.title;
      setRevision(nextRevision);
      setLocalSavedRevision(nextRevision);
      setDocumentState(restored.document);
      setDeck(restored);
      setFiles(restoredFiles);
      setTitle(restored.title);
      setActiveSlideId(restored.document.slides.find((slide) => !slide.deletedAt)?.id ?? "");
      setSceneEpoch((value) => value + 1);
      setSyncState("saved");
      setSelectedHistoryId(undefined);
      setHistoryPreview(undefined);
      setHistoryPreviewError("");
      pendingOperations.current = [];
      await saveLocalPitchDraft({
        deckId,
        title: restored.title,
        document: restored.document,
        files: restoredFiles,
        pendingSync: false,
        updatedAt: restored.updatedAt,
        pendingOperations: [],
        nextSequence: nextCommandSequence.current,
      }).then(
        () => setLocalSaveFailed(false),
        () => setLocalSaveFailed(true),
      );
      setMessage(`Restored the version from ${new Date(item.createdAt).toLocaleString()}.`);
      await loadVersionHistory();
    } catch (error) {
      setSyncState("error");
      setMessage(error instanceof Error ? error.message : "Could not restore that version");
    } finally {
      setRestoringHistoryId(undefined);
    }
  }

  function exportDeck() {
    if (!documentState) return;
    download(
      new Blob([JSON.stringify({ deckId, title, document: documentState, files }, null, 2)], {
        type: "application/json",
      }),
      `${safeName(title)}.mahdeck`,
    );
  }

  async function exportCurrentPng() {
    if (!currentSlide) return;
    const stage = pitchStageExport(currentSlide.id, currentSlide.elements);
    const blob = await exportToBlob({
      ...stage,
      files,
      appState: {
        ...apiRef.current?.getAppState(),
        frameRendering: { enabled: true, clip: true, name: false, outline: false },
      },
      mimeType: "image/png",
      maxWidthOrHeight: 2_400,
      exportPadding: 0,
    });
    download(blob, `${safeName(title)}-${currentSlide.name}.png`);
  }

  async function exportCurrentSvg() {
    if (!currentSlide) return;
    const { exportToSvg } = await import("@excalidraw/excalidraw");
    const stage = pitchStageExport(currentSlide.id, currentSlide.elements);
    const svg = await exportToSvg({
      ...stage,
      files,
      appState: {
        ...apiRef.current?.getAppState(),
        frameRendering: { enabled: true, clip: true, name: false, outline: false },
      },
      exportPadding: 0,
    });
    download(
      new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" }),
      `${safeName(title)}-${currentSlide.name}.svg`,
    );
  }

  async function exportDeckZip() {
    const { default: JSZip } = await import("jszip");
    const zip = new JSZip();
    for (const [index, slide] of visibleSlides.entries()) {
      const stage = pitchStageExport(slide.id, slide.elements);
      const blob = await exportToBlob({
        ...stage,
        files,
        appState: {
          frameRendering: { enabled: true, clip: true, name: false, outline: false },
        },
        mimeType: "image/png",
        maxWidthOrHeight: 2_400,
        exportPadding: 0,
      });
      zip.file(`${String(index + 1).padStart(2, "0")}-${safeName(slide.name)}.png`, blob);
    }
    zip.file(
      `${safeName(title)}.mahdeck`,
      JSON.stringify({ deckId, title, document: documentState, files }, null, 2),
    );
    download(await zip.generateAsync({ type: "blob" }), `${safeName(title)}.zip`);
  }

  async function runExport(exporter: () => Promise<void> | void) {
    try {
      await exporter();
      setExportOpen(false);
    } catch {
      setMessage("We could not create that download. Try again in a moment.");
    }
  }

  if (phase === "loading") {
    return (
      <main id="main" className="p-8 font-mono text-sm theme-muted">
        opening your studio…
      </main>
    );
  }
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
        const file = event.clipboardData.files[0];
        if (!file) return;
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest(".pitch-excalidraw")) return;
        event.preventDefault();
        handleDroppedFile(
          file,
          target?.closest("[data-pitch-drop-target='timeline']") ? "timeline" : "stage",
        );
      }}
      onDrop={(event) => {
        event.preventDefault();
        const file = event.dataTransfer.files[0];
        if (file) handleDroppedFile(file, "page");
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
                  ? "Drop sound on the sound + timing timeline"
                  : dragKind === "video"
                    ? "Video timeline is coming soon"
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
          disabled={isDemo || syncState === "syncing" || hasUnsecuredMedia}
          className="min-h-10 bg-foreground px-5 font-mono text-xs text-background hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {isDemo
            ? "create to publish"
            : hasUnsecuredMedia
              ? "securing images…"
              : deck?.publishedAt
                ? "republish edition"
                : "publish + seal"}
        </button>
      </header>

      {isDemo ? (
        <div
          className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 border-b border-[var(--things-amber)] bg-[var(--things-amber)] px-4 py-2 text-center font-mono text-xs text-foreground dark:text-background"
          role="status"
        >
          <span>
            Rehearsal mode · this tab is the only copy. Sound, saving and publishing are off.
          </span>
          <Link
            to="/things/pitches/new"
            className="text-foreground underline decoration-foreground underline-offset-4 hover:opacity-60 dark:text-background dark:decoration-background"
          >
            start one for real
          </Link>
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
                setMessage("Trying the unfinished uploads again…");
                setSyncState("local");
                setUploadWake((value) => value + 1);
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
                    PNG and SVG are single-slide images. ZIP contains every slide as a PNG plus a
                    .mahdeck studio backup. The backup opens here; it is not an editable PowerPoint
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
              const file = event.dataTransfer.files[0];
              if (file) handleDroppedFile(file, "stage");
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
            <ExcalidrawSurface
              key={`${currentSlide.id}:${sceneEpoch}`}
              slideId={currentSlide.id}
              elements={currentSlide.elements}
              files={files}
              onApi={(api) => {
                apiRef.current = api;
              }}
              onChange={onCanvasChange}
            />
          </div>
          <PitchAudioTimeline
            slide={currentSlide}
            assets={deck?.assets ?? []}
            soundDisabledReason={
              isDemo ? "Sound uploads are available once you start a saved pitch." : undefined
            }
            onAddSound={(file) => void attachAudio(file)}
            onDropFile={(file) => handleDroppedFile(file, "timeline")}
            onChange={(nextSlide, kind = "audio.change") => {
              if (kind === "audio.remove") rememberUndo("removing a sound");
              setDocumentState((current) =>
                current ? updateSlide(current, nextSlide.id, () => nextSlide) : current,
              );
              documentRef.current = documentRef.current
                ? updateSlide(documentRef.current, nextSlide.id, () => nextSlide)
                : documentRef.current;
              markChanged(kind, { slideId: nextSlide.id });
              if (kind === "audio.remove") {
                setMessage("Sound removed. You can undo this action.");
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
          assets={deck?.assets ?? []}
          initialSlideId={currentSlide.id}
          onClose={() => setPreviewOpen(false)}
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
