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
import {
  readLocalPitchDraft,
  reconcileLocalPitchDraft,
  rememberPitchCredential,
  rememberTokenFromHash,
  saveLocalPitchDraft,
} from "../browser-store.client";
import { importPresentation } from "../import.client";
import { mergePitchDocuments } from "../merge";
import { createEmptyPitchDocument } from "../new-document.client";
import {
  createPitchAssetUploadFn,
  finalisePitchAssetFn,
  publishPitchFn,
  readOwnedPitchFn,
  syncPitchFn,
} from "../pitches.functions";
import {
  type OwnedPitchDeck,
  PITCH_AUDIO_MAX_SECONDS,
  PITCH_SLIDE_DEFAULT_DURATION_MS,
  type PitchDocument,
  type PitchInkLayer,
  type PitchOwnerCredential,
  type PitchSlide,
} from "../types";
import { parsePitchDocument } from "../validation";
import { ExcalidrawSurface } from "./ExcalidrawSurface";
import { blobToDataUrl, dataUrlToBlob, loadPitchFiles } from "./files.client";
import { DrawesomeInk } from "./DrawesomeInk";
import { PitchAudioTimeline } from "./PitchAudioTimeline";
import { PitchDeviceSwitcher } from "./PitchDeviceSwitcher";
import { PitchPreview } from "./PitchPreview";
import { PitchRecovery } from "./PitchRecovery";
import { PitchSlideThumbnail } from "./PitchSlideThumbnail";
import { pitchStageExport, toPitchStageScene } from "./pitch-stage.client";

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
  const [inkOpen, setInkOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(true);
  const [railPinned, setRailPinned] = useState(true);
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

  const reloadSafe = isDemo
    ? revision === 0
    : !localSaveFailed &&
      localSavedRevision >= revision &&
      uploading.current.size === 0 &&
      syncState !== "syncing";
  useUpdateReloadSafety(`pitch-studio:${deckId}`, reloadSafe);

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
        setPhase(local ? "ready" : "error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deckId, isDemo]);

  const markChanged = useCallback(() => {
    revisionRef.current += 1;
    setRevision(revisionRef.current);
    setSyncState(navigator.onLine ? "local" : "local");
  }, []);

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
    if (isDemo || !credential || !deck || !documentState || !navigator.onLine) return false;
    if (syncing.current) return false;
    if (revisionRef.current <= lastSyncedRevision.current) return true;
    syncing.current = true;
    const sentRevision = revisionRef.current;
    setSyncState("syncing");
    try {
      const result = await syncPitchFn({
        data: {
          deckId,
          ownerToken: credential.token,
          baseVersion: deck.version,
          mutationId: randomId("m_"),
          title,
          document: documentState,
        },
      });
      if (!result.ok) {
        setSyncState("error");
        setMessage(result.error);
        return false;
      }
      lastSyncedRevision.current = sentRevision;
      setDeck(result.value.deck);
      if (result.value.merged) {
        setDocumentState((current) =>
          current
            ? mergePitchDocuments(result.value.deck.document, current)
            : result.value.deck.document,
        );
        setSceneEpoch((value) => value + 1);
        setSyncState("merged");
        setMessage("Two saved copies were consolidated. Nothing was discarded.");
      } else {
        const fullySynced = revisionRef.current === sentRevision;
        if (fullySynced) {
          await saveLocalPitchDraft({
            deckId,
            title,
            document: documentState,
            files,
            pendingSync: false,
            updatedAt: result.value.deck.updatedAt,
          });
          setLocalSavedRevision((current) => Math.max(current, sentRevision));
          setLocalSaveFailed(false);
        }
        setSyncState(fullySynced ? "saved" : "local");
      }
      await rememberPitchCredential({
        ...credential,
        title,
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
  }, [credential, deck, deckId, documentState, files, isDemo, title, updateState]);

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
          markChanged();
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

  function onCanvasChange(elements: readonly ExcalidrawElement[], nextFiles: BinaryFiles) {
    if (!currentSlide) return;
    setFiles((current) => ({ ...current, ...nextFiles }));
    setDocumentState((current) =>
      current
        ? updateSlide(current, currentSlide.id, (slide) => ({
            ...slide,
            elements,
            version: slide.version + 1,
            updatedAt: Date.now(),
          }))
        : current,
    );
    markChanged();
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
    markChanged();
  }

  function deleteSlide() {
    if (!documentState || !currentSlide || visibleSlides.length <= 1) return;
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
    markChanged();
  }

  async function attachAudio(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (isDemo || !file || !currentSlide) return;
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
      markChanged();
      setMessage("Sound added. Set its timing below, then test it in preview.");
    } catch (error) {
      setSyncState("error");
      setMessage(error instanceof Error ? error.message : "Sound upload failed");
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
    markChanged();
    setInkOpen(false);
  }

  async function importFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !documentState) return;
    setMessage(`Reading ${file.name}…`);
    try {
      if (file.name.toLowerCase().endsWith(".json")) {
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
        const restoredDocument = restored.document;
        setDocumentState(restoredDocument);
        setSceneEpoch((value) => value + 1);
        setActiveSlideId(restoredDocument.slides.find((slide) => !slide.deletedAt)?.id ?? "");
        setFiles(restored.files);
        markChanged();
        setMessage(
          isDemo
            ? "Native backup opened for this rehearsal. Download it again if you want to keep your changes."
            : Object.keys(restored.files).length > 0
              ? "Native backup restored. Its images are being secured to this pitch."
              : "Native backup restored.",
        );
        return;
      }

      const available = maximumSlides - visibleSlides.length;
      if (available < 1) throw new Error(`This deck already has all ${maximumSlides} slides`);
      if (!isDemo) {
        const importedAsset = await uploadBlob(file, {
          kind: "import",
          fileName: file.name,
        });
        setDeck((current) =>
          current ? { ...current, assets: [...current.assets, importedAsset] } : current,
        );
      }
      const allImported = await importPresentation(file, available);
      const imported = allImported.slice(0, available);
      if (imported.length === 0) throw new Error("That presentation contained no usable slides");
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
      setFiles((current) => imported.reduce((all, slide) => ({ ...all, ...slide.files }), current));
      setDocumentState((current) =>
        current ? { ...current, slides: [...current.slides, ...created] } : current,
      );
      setActiveSlideId(created[0].id);
      markChanged();
      setMessage(
        imported.length < allImported.length
          ? `Imported ${imported.length} slides; the deck limit is ${maximumSlides}.`
          : `Imported ${imported.length} slides. Text and pictures are movable.`,
      );
    } catch (error) {
      setSyncState("error");
      setMessage(error instanceof Error ? error.message : "Could not import that presentation");
    }
  }

  async function publish() {
    if (isDemo || !credential || !currentSlide || !documentState) return;
    if (!navigator.onLine) {
      setMessage("Reconnect before publishing. Your working copy is safe on this device.");
      return;
    }
    if (hasUnsecuredMedia) {
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
      const cover = visibleSlides[0];
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
        "Published. That public edition is sealed; keep editing here and republish when you want a new edition.",
      );
      setSyncState("saved");
    } catch (error) {
      setSyncState("error");
      setMessage(error instanceof Error ? error.message : "Could not publish this pitch");
    }
  }

  function exportDeck() {
    if (!documentState) return;
    download(
      new Blob([JSON.stringify({ deckId, title, document: documentState, files }, null, 2)], {
        type: "application/json",
      }),
      `${safeName(title)}.mahdeck.json`,
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
      `${safeName(title)}.mahdeck.json`,
      JSON.stringify({ deckId, title, document: documentState, files }, null, 2),
    );
    download(await zip.generateAsync({ type: "blob" }), `${safeName(title)}.zip`);
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
      <main id="main" className="p-8 font-mono text-sm text-red-700 dark:text-red-300">
        The studio could not open this pitch.
      </main>
    );
  }

  return (
    <main id="main" className="flex min-h-screen flex-col bg-background">
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
            markChanged();
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
          className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 border-b theme-border bg-surface px-4 py-2 text-center font-mono text-xs theme-muted"
          role="status"
        >
          <span>
            Rehearsal mode · this tab is the only copy. Sound, saving and publishing are off.
          </span>
          <Link
            to="/things/pitches/new"
            className="text-foreground underline decoration-border underline-offset-4 hover:opacity-60"
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
          <div className="z-10 flex shrink-0 items-center gap-2 overflow-x-auto border-b theme-border bg-background/90 px-3 py-2 backdrop-blur">
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
                markChanged();
              }}
              className="min-h-10 min-w-32 max-w-52 shrink bg-transparent px-2 font-mono text-xs text-foreground outline-none focus:border-b theme-border-strong"
            />
            <button
              type="button"
              onClick={() => setInkOpen(true)}
              className="min-h-10 shrink-0 border-b theme-border-strong px-2 font-mono text-xs hover:opacity-60"
            >
              beautiful ink
            </button>
            <button
              type="button"
              onClick={() => void exportCurrentPng()}
              className="min-h-10 shrink-0 border-b theme-border-strong px-2 font-mono text-xs hover:opacity-60"
            >
              PNG
            </button>
            <button
              type="button"
              onClick={() => void exportCurrentSvg()}
              className="min-h-10 shrink-0 border-b theme-border-strong px-2 font-mono text-xs hover:opacity-60"
            >
              SVG
            </button>
            <button
              type="button"
              onClick={() => void exportDeckZip()}
              className="min-h-10 shrink-0 border-b theme-border-strong px-2 font-mono text-xs hover:opacity-60"
            >
              ZIP
            </button>
            <button
              type="button"
              onClick={exportDeck}
              className="min-h-10 shrink-0 border-b theme-border-strong px-2 font-mono text-xs hover:opacity-60"
            >
              backup
            </button>
            <label className="inline-flex min-h-10 shrink-0 cursor-pointer items-center border-b theme-border-strong px-2 font-mono text-xs hover:opacity-60">
              import
              <input
                type="file"
                accept=".pdf,.pptx,.mahdeck.json,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation,application/json"
                className="sr-only"
                onChange={(event) => void importFile(event)}
              />
            </label>
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
          <div data-tour="stage" className="min-h-[24rem] flex-1">
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
            onAddSound={(event) => void attachAudio(event)}
            onChange={(nextSlide) => {
              setDocumentState((current) =>
                current ? updateSlide(current, nextSlide.id, () => nextSlide) : current,
              );
              markChanged();
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
