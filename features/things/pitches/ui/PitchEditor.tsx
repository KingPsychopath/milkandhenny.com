import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  convertToExcalidrawElements,
  exportToBlob,
  getNonDeletedElements,
} from "@excalidraw/excalidraw";
import type {
  BinaryFileData,
  BinaryFiles,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement, FileId } from "@excalidraw/excalidraw/element/types";

import {
  readLocalPitchDraft,
  rememberPitchCredential,
  rememberTokenFromHash,
  saveLocalPitchDraft,
} from "../browser-store.client";
import { importPresentation } from "../import.client";
import { mergePitchDocuments } from "../merge";
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
  type PitchDocument,
  type PitchInkLayer,
  type PitchOwnerCredential,
  type PitchSlide,
} from "../types";
import { parsePitchDocument } from "../validation";
import { ExcalidrawSurface } from "./ExcalidrawSurface";
import { blobToDataUrl, dataUrlToBlob, loadPitchFiles } from "./files.client";
import { DrawesomeInk } from "./DrawesomeInk";
import { PitchRecovery } from "./PitchRecovery";

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
        audioAssetId: undefined,
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

export function PitchEditor({ deckId, maximumSlides }: { deckId: string; maximumSlides: number }) {
  const [credential, setCredential] = useState<PitchOwnerCredential>();
  const [deck, setDeck] = useState<OwnedPitchDeck>();
  const [documentState, setDocumentState] = useState<PitchDocument>();
  const [files, setFiles] = useState<BinaryFiles>({});
  const [title, setTitle] = useState("");
  const [activeSlideId, setActiveSlideId] = useState("");
  const [phase, setPhase] = useState<"loading" | "ready" | "missing" | "error">("loading");
  const [syncState, setSyncState] = useState<"saved" | "local" | "syncing" | "merged" | "error">(
    "local",
  );
  const [message, setMessage] = useState("");
  const [inkOpen, setInkOpen] = useState(false);
  const [sceneEpoch, setSceneEpoch] = useState(0);
  const [revision, setRevision] = useState(0);
  const [syncWake, setSyncWake] = useState(0);
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const uploading = useRef(new Set<string>());
  const revisionRef = useRef(0);
  const lastSyncedRevision = useRef(0);
  const syncing = useRef(false);

  useEffect(() => {
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
        setPhase("ready");
        setSyncState("local");
      }
      if (!remembered) {
        if (!local) setPhase("missing");
        return;
      }
      try {
        const result = await readOwnedPitchFn({
          data: { deckId, ownerToken: remembered.token },
        });
        if (!result.ok) {
          if (!local) setPhase("missing");
          return;
        }
        const remote = result.value;
        const remoteFiles = await loadPitchFiles(remote.assets);
        const localIsAhead =
          local &&
          (local.serverVersion > remote.version ||
            (local.serverVersion === remote.version &&
              (local.title !== remote.title ||
                JSON.stringify(local.document) !== JSON.stringify(remote.document))));
        setDeck(remote);
        if (!localIsAhead) {
          setTitle(remote.title);
          setDocumentState(remote.document);
          setFiles({ ...remoteFiles, ...(local?.files ?? {}) });
          setActiveSlideId(remote.document.slides.find((slide) => !slide.deletedAt)?.id ?? "");
          setSyncState("saved");
        } else {
          setFiles({ ...remoteFiles, ...local.files });
          setSyncState("local");
          setRevision(1);
          revisionRef.current = 1;
        }
        setPhase("ready");
      } catch {
        if (!local) setPhase("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deckId]);

  const markChanged = useCallback(() => {
    revisionRef.current += 1;
    setRevision(revisionRef.current);
    setSyncState(navigator.onLine ? "local" : "local");
  }, []);

  useEffect(() => {
    if (!documentState || phase !== "ready") return;
    const timer = window.setTimeout(() => {
      void saveLocalPitchDraft({
        deckId,
        title,
        document: documentState,
        files,
        serverVersion: deck?.version ?? 1,
        updatedAt: new Date().toISOString(),
      }).catch(() => undefined);
    }, 180);
    return () => window.clearTimeout(timer);
  }, [deck?.version, deckId, documentState, files, phase, title]);

  const performSync = useCallback(async () => {
    if (!credential || !deck || !documentState || !navigator.onLine) return false;
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
        setSyncState(revisionRef.current === sentRevision ? "saved" : "local");
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
      return false;
    } finally {
      syncing.current = false;
      if (revisionRef.current > sentRevision) setSyncWake((value) => value + 1);
    }
  }, [credential, deck, deckId, documentState, title]);

  useEffect(() => {
    if (revision <= lastSyncedRevision.current) return;
    const timer = window.setTimeout(() => void performSync(), 1_800);
    return () => window.clearTimeout(timer);
  }, [performSync, revision, syncWake]);

  useEffect(() => {
    const online = () => {
      setSyncWake((value) => value + 1);
      void performSync();
    };
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, [performSync]);

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
      visibleSlides.some((slide) =>
        slide.elements.some(
          (element) =>
            element.type === "image" && Boolean(element.fileId) && !slide.assetIds[element.fileId!],
        ),
      ),
    [visibleSlides],
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
        .catch((error) => {
          setSyncState("error");
          setMessage(error instanceof Error ? error.message : "An image could not be uploaded");
        })
        .finally(() => uploading.current.delete(fileId));
    }
  }, [credential, currentSlide, documentState, files, markChanged, uploadBlob]);

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
          elements: [],
          assetIds: {},
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
    if (!file || !currentSlide) return;
    try {
      const duration = await audioDuration(file);
      if (!Number.isFinite(duration) || duration > PITCH_AUDIO_MAX_SECONDS) {
        throw new Error(`Keep slide sounds under ${PITCH_AUDIO_MAX_SECONDS / 60} minutes`);
      }
      const asset = await uploadBlob(file, { kind: "audio", fileName: file.name });
      setDocumentState((current) =>
        current
          ? updateSlide(current, currentSlide.id, (slide) => ({
              ...slide,
              audioAssetId: asset.id,
              version: slide.version + 1,
              updatedAt: Date.now(),
            }))
          : current,
      );
      setDeck((current) =>
        current ? { ...current, assets: [...current.assets, asset] } : current,
      );
      markChanged();
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
    apiRef.current?.updateScene({ elements: nextElements });
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
        const sameDeck = backup?.deckId === deckId;
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
          Object.keys(restored.files).length > 0
            ? "Native backup restored. Its images are being secured to this pitch."
            : "Native backup restored.",
        );
        return;
      }

      const available = maximumSlides - visibleSlides.length;
      if (available < 1) throw new Error(`This deck already has all ${maximumSlides} slides`);
      const importedAsset = await uploadBlob(file, {
        kind: "import",
        fileName: file.name,
      });
      setDeck((current) =>
        current ? { ...current, assets: [...current.assets, importedAsset] } : current,
      );
      const allImported = await importPresentation(file, available);
      const imported = allImported.slice(0, available);
      if (imported.length === 0) throw new Error("That presentation contained no usable slides");
      const created = imported.map((slide) => ({
        id: randomId("s_"),
        name: slide.name,
        version: 1,
        updatedAt: Date.now(),
        elements: slide.elements,
        assetIds: {},
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
    if (!credential || !currentSlide || !documentState) return;
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
      const elements = getNonDeletedElements(currentSlide.elements);
      if (api && elements.length > 0) {
        const thumbnail = await exportToBlob({
          elements,
          files,
          appState: { ...api.getAppState(), exportBackground: true },
          mimeType: "image/png",
          maxWidthOrHeight: 1_200,
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
    const elements = getNonDeletedElements(currentSlide.elements);
    if (elements.length === 0) return;
    const blob = await exportToBlob({
      elements,
      files,
      appState: apiRef.current?.getAppState(),
      mimeType: "image/png",
      maxWidthOrHeight: 2_400,
    });
    download(blob, `${safeName(title)}-${currentSlide.name}.png`);
  }

  async function exportCurrentSvg() {
    if (!currentSlide) return;
    const { exportToSvg } = await import("@excalidraw/excalidraw");
    const svg = await exportToSvg({
      elements: getNonDeletedElements(currentSlide.elements),
      files,
      appState: apiRef.current?.getAppState(),
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
      const elements = getNonDeletedElements(slide.elements);
      if (elements.length === 0) continue;
      const blob = await exportToBlob({
        elements,
        files,
        mimeType: "image/png",
        maxWidthOrHeight: 2_400,
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
        <span className="font-mono text-micro uppercase tracking-[0.12em] theme-muted">
          {syncState === "saved"
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
          onClick={() => void publish()}
          disabled={syncState === "syncing" || hasUnsecuredMedia}
          className="min-h-10 bg-foreground px-5 font-mono text-xs text-background hover:opacity-80 disabled:cursor-wait disabled:opacity-45"
        >
          {hasUnsecuredMedia
            ? "securing images…"
            : deck?.publishedAt
              ? "republish edition"
              : "publish + seal"}
        </button>
      </header>

      {message ? (
        <div
          className="border-b theme-border px-4 py-2 text-center font-mono text-xs theme-muted"
          role="status"
        >
          {message}
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(28rem,1fr)] lg:grid-cols-[12rem_minmax(0,1fr)] lg:grid-rows-1">
        <aside className="flex gap-2 overflow-x-auto border-b theme-border p-3 lg:flex-col lg:border-b-0 lg:border-r">
          {visibleSlides.map((slide, index) => (
            <button
              key={slide.id}
              type="button"
              onClick={() => setActiveSlideId(slide.id)}
              className={`min-h-14 min-w-28 border px-3 text-left font-mono text-xs ${
                slide.id === currentSlide.id
                  ? "theme-border-strong bg-surface text-foreground"
                  : "theme-border theme-muted hover:opacity-60"
              }`}
            >
              <span className="block text-micro theme-faint">
                {String(index + 1).padStart(2, "0")}
              </span>
              {slide.name}
            </button>
          ))}
          <button
            type="button"
            disabled={visibleSlides.length >= maximumSlides}
            onClick={addSlide}
            className="min-h-12 min-w-28 border border-dashed theme-border px-3 font-mono text-xs theme-muted hover:opacity-60 disabled:opacity-30"
          >
            + slide
          </button>
        </aside>

        <section className="relative min-h-0">
          <div className="absolute inset-x-0 top-0 z-10 flex flex-wrap justify-end gap-2 bg-background/90 px-3 py-2 backdrop-blur">
            <label className="inline-flex min-h-9 cursor-pointer items-center border-b theme-border-strong px-2 font-mono text-xs text-foreground hover:opacity-60">
              add sound
              <input
                type="file"
                accept="audio/mpeg,audio/mp4,audio/ogg,audio/wav,audio/webm"
                className="sr-only"
                onChange={(event) => void attachAudio(event)}
              />
            </label>
            <button
              type="button"
              onClick={() => setInkOpen(true)}
              className="min-h-9 border-b theme-border-strong px-2 font-mono text-xs hover:opacity-60"
            >
              beautiful ink
            </button>
            <button
              type="button"
              onClick={() => void exportCurrentPng()}
              className="min-h-9 border-b theme-border-strong px-2 font-mono text-xs hover:opacity-60"
            >
              PNG
            </button>
            <button
              type="button"
              onClick={() => void exportCurrentSvg()}
              className="min-h-9 border-b theme-border-strong px-2 font-mono text-xs hover:opacity-60"
            >
              SVG
            </button>
            <button
              type="button"
              onClick={() => void exportDeckZip()}
              className="min-h-9 border-b theme-border-strong px-2 font-mono text-xs hover:opacity-60"
            >
              ZIP
            </button>
            <button
              type="button"
              onClick={exportDeck}
              className="min-h-9 border-b theme-border-strong px-2 font-mono text-xs hover:opacity-60"
            >
              backup
            </button>
            <label className="inline-flex min-h-9 cursor-pointer items-center border-b theme-border-strong px-2 font-mono text-xs hover:opacity-60">
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
              className="min-h-9 border-b theme-border px-2 font-mono text-xs theme-muted hover:opacity-60 disabled:opacity-30"
            >
              remove slide
            </button>
          </div>
          <div className="h-full min-h-[32rem] pt-12">
            <ExcalidrawSurface
              key={`${currentSlide.id}:${sceneEpoch}`}
              elements={currentSlide.elements}
              files={files}
              onApi={(api) => {
                apiRef.current = api;
              }}
              onChange={onCanvasChange}
            />
          </div>
        </section>
      </div>
      {inkOpen ? <DrawesomeInk onCancel={() => setInkOpen(false)} onPlace={placeInk} /> : null}
    </main>
  );
}
