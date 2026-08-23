import { convertToExcalidrawElements } from "@excalidraw/excalidraw";
import type { BinaryFileData, BinaryFiles } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement, FileId } from "@excalidraw/excalidraw/element/types";
import type JSZip from "jszip";

import { PITCH_SLIDE_STAGE } from "./types";
import { blobToDataUrl } from "./ui/files.client";

export interface ImportedPitchSlide {
  name: string;
  elements: readonly ExcalidrawElement[];
  files: BinaryFiles;
  mediaFiles: File[];
}

function randomId(prefix: string): string {
  return `${prefix}${crypto.randomUUID().replaceAll("-", "")}`;
}

function binaryFile(
  fileId: FileId,
  blob: Blob,
  dataURL: BinaryFileData["dataURL"],
): BinaryFileData {
  return {
    id: fileId,
    dataURL,
    mimeType: blob.type as BinaryFileData["mimeType"],
    created: Date.now(),
  };
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not render PDF page"))),
      "image/png",
      0.92,
    );
  });
}

function fitWithinStage(width: number, height: number) {
  const scale = Math.min(PITCH_SLIDE_STAGE.width / width, PITCH_SLIDE_STAGE.height / height);
  const fittedWidth = width * scale;
  const fittedHeight = height * scale;
  return {
    x: (PITCH_SLIDE_STAGE.width - fittedWidth) / 2,
    y: (PITCH_SLIDE_STAGE.height - fittedHeight) / 2,
    width: fittedWidth,
    height: fittedHeight,
  };
}

export async function importPdf(file: File, maximumSlides = 12): Promise<ImportedPitchSlide[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
  });
  const pdf = await loadingTask.promise;
  const result: ImportedPitchSlide[] = [];
  for (let pageNumber = 1; pageNumber <= Math.min(pdf.numPages, maximumSlides); pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const natural = page.getViewport({ scale: 1 });
    const scale = Math.min(2, 1_600 / natural.width);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) throw new Error("This browser could not render the PDF");
    await page.render({ canvas, canvasContext: context, viewport }).promise;
    const blob = await canvasBlob(canvas);
    const fileId = randomId("pdf_") as FileId;
    const dataURL = await blobToDataUrl(blob);
    const bounds = fitWithinStage(natural.width, natural.height);
    const [image] = convertToExcalidrawElements(
      [
        {
          type: "image",
          ...bounds,
          fileId,
          customData: { pitchImport: "pdf", page: pageNumber },
        },
      ],
      { regenerateIds: true },
    );
    result.push({
      name: `PDF ${pageNumber}`,
      elements: [image],
      files: { [fileId]: binaryFile(fileId, blob, dataURL) },
      mediaFiles: [],
    });
    page.cleanup();
  }
  await loadingTask.destroy();
  return result;
}

function emu(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed / 9_525 : fallback;
}

function parseXml(xml: string): XMLDocument {
  return new DOMParser().parseFromString(xml.replace(/^\uFEFF/, ""), "application/xml");
}

function pptxStageTransform(zip: JSZip) {
  const fallback = {
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  };
  const presentation = zip.file("ppt/presentation.xml");
  if (!presentation) return Promise.resolve(fallback);
  return presentation.async("text").then((xml) => {
    const parsed = parseXml(xml);
    const size = parsed.getElementsByTagName("p:sldSz")[0];
    const width = emu(size?.getAttribute("cx") ?? null, PITCH_SLIDE_STAGE.width);
    const height = emu(size?.getAttribute("cy") ?? null, PITCH_SLIDE_STAGE.height);
    if (width <= 0 || height <= 0) return fallback;
    const fitted = fitWithinStage(width, height);
    return {
      scale: fitted.width / width,
      offsetX: fitted.x,
      offsetY: fitted.y,
    };
  });
}

function relationshipMap(xml: string): Map<string, string> {
  const document = parseXml(xml);
  const map = new Map<string, string>();
  for (const node of Array.from(document.getElementsByTagName("Relationship"))) {
    const id = node.getAttribute("Id");
    const target = node.getAttribute("Target");
    if (id && target) map.set(id, target);
  }
  return map;
}

function normalisePptxTarget(target: string): string {
  const parts = `ppt/slides/${target}`.split("/");
  const resolved: string[] = [];
  for (const part of parts) {
    if (part === "..") resolved.pop();
    else if (part !== ".") resolved.push(part);
  }
  return resolved.join("/");
}

export async function importPptx(file: File, maximumSlides = 12): Promise<ImportedPitchSlide[]> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(file);
  const slidePaths = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((left, right) => {
      const number = (value: string) => Number(value.match(/slide(\d+)/)?.[1] ?? 0);
      return number(left) - number(right);
    });
  if (slidePaths.length === 0) throw new Error("That PowerPoint file contains no slides");

  const stage = await pptxStageTransform(zip);
  const point = (value: number, axis: "x" | "y") =>
    value * stage.scale + (axis === "x" ? stage.offsetX : stage.offsetY);
  const length = (value: number) => value * stage.scale;
  const result: ImportedPitchSlide[] = [];
  for (const [slideIndex, slidePath] of slidePaths.slice(0, maximumSlides).entries()) {
    const slideXml = await zip.file(slidePath)!.async("text");
    const slide = parseXml(slideXml);
    const relationPath = slidePath.replace("slides/", "slides/_rels/") + ".rels";
    const relations = zip.file(relationPath)
      ? relationshipMap(await zip.file(relationPath)!.async("text"))
      : new Map<string, string>();
    const skeletons: Parameters<typeof convertToExcalidrawElements>[0] = [];
    const files: BinaryFiles = {};
    const mediaFiles: File[] = [];

    for (const [shapeIndex, shape] of Array.from(slide.getElementsByTagName("p:sp")).entries()) {
      const text = Array.from(shape.getElementsByTagName("a:t"))
        .map((node) => node.textContent ?? "")
        .join(" ")
        .trim();
      if (!text) continue;
      const off = shape.getElementsByTagName("a:off")[0];
      const extent = shape.getElementsByTagName("a:ext")[0];
      skeletons.push({
        type: "text",
        text,
        x: point(emu(off?.getAttribute("x") ?? null, 80), "x"),
        y: point(emu(off?.getAttribute("y") ?? null, 60 + shapeIndex * 70), "y"),
        width: length(Math.max(120, emu(extent?.getAttribute("cx") ?? null, 700))),
        height: length(Math.max(36, emu(extent?.getAttribute("cy") ?? null, 60))),
        fontSize: length(shapeIndex === 0 ? 42 : 28),
        fontFamily: 3,
        customData: { pitchImport: "pptx", slide: slideIndex + 1 },
      });
    }

    for (const [pictureIndex, picture] of Array.from(
      slide.getElementsByTagName("p:pic"),
    ).entries()) {
      const blip = picture.getElementsByTagName("a:blip")[0];
      const relationId =
        blip?.getAttribute("r:embed") ??
        blip?.getAttributeNS(
          "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
          "embed",
        );
      const target = relationId ? relations.get(relationId) : undefined;
      const mediaPath = target ? normalisePptxTarget(target) : null;
      const media = mediaPath ? zip.file(mediaPath) : null;
      if (!media) continue;
      const extension = mediaPath!.split(".").pop()?.toLowerCase();
      if (!extension || !["png", "jpg", "jpeg", "webp", "gif"].includes(extension)) continue;
      const mime =
        extension === "jpg" || extension === "jpeg"
          ? "image/jpeg"
          : extension === "webp"
            ? "image/webp"
            : extension === "gif"
              ? "image/gif"
              : "image/png";
      const blob = new Blob([await media.async("arraybuffer")], { type: mime });
      const fileId = randomId("pptx_") as FileId;
      const off = picture.getElementsByTagName("a:off")[0];
      const extent = picture.getElementsByTagName("a:ext")[0];
      skeletons.push({
        type: "image",
        x: point(emu(off?.getAttribute("x") ?? null, 100 + pictureIndex * 40), "x"),
        y: point(emu(off?.getAttribute("y") ?? null, 160 + pictureIndex * 40), "y"),
        width: length(Math.max(100, emu(extent?.getAttribute("cx") ?? null, 500))),
        height: length(Math.max(100, emu(extent?.getAttribute("cy") ?? null, 300))),
        fileId,
        customData: { pitchImport: "pptx", slide: slideIndex + 1 },
      });
      files[fileId] = binaryFile(fileId, blob, await blobToDataUrl(blob));
    }

    const importedMediaPaths = new Set(
      [...relations.values()]
        .map(normalisePptxTarget)
        .filter((path) => /\.(?:mp3|m4a|aac|wav|ogg|mp4|m4v|mov|webm)$/i.test(path)),
    );
    for (const mediaPath of importedMediaPaths) {
      const media = zip.file(mediaPath);
      if (!media) continue;
      const extension = mediaPath.split(".").pop()?.toLowerCase() ?? "";
      const mimeType =
        extension === "mp3"
          ? "audio/mpeg"
          : extension === "m4a" || extension === "aac"
            ? "audio/mp4"
            : extension === "wav"
              ? "audio/wav"
              : extension === "ogg"
                ? "audio/ogg"
                : extension === "webm"
                  ? "video/webm"
                  : extension === "mov"
                    ? "video/quicktime"
                    : "video/mp4";
      mediaFiles.push(
        new File(
          [await media.async("arraybuffer")],
          mediaPath.split("/").at(-1) ?? `media.${extension}`,
          {
            type: mimeType,
          },
        ),
      );
    }

    result.push({
      name: `PowerPoint ${slideIndex + 1}`,
      elements: convertToExcalidrawElements(skeletons, { regenerateIds: true }),
      files,
      mediaFiles,
    });
  }
  return result;
}

export async function importPresentation(
  file: File,
  maximumSlides = 12,
): Promise<ImportedPitchSlide[]> {
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    return importPdf(file, maximumSlides);
  }
  if (
    file.type === "application/vnd.openxmlformats-officedocument.presentationml.presentation" ||
    file.name.toLowerCase().endsWith(".pptx")
  ) {
    return importPptx(file, maximumSlides);
  }
  throw new Error(
    "Choose a PowerPoint (.pptx) or PDF file. For Google Slides, download the presentation as a PowerPoint file first.",
  );
}
