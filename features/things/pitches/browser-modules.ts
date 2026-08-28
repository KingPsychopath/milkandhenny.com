import { createIsomorphicFn } from "@tanstack/react-start";

const loadExcalidrawForClient = createIsomorphicFn().client(() => import("@excalidraw/excalidraw"));

const loadPitchPdfJsForClient = createIsomorphicFn().client(() => import("pdfjs-dist"));

export async function loadExcalidraw() {
  const module = await loadExcalidrawForClient();
  if (!module) throw new Error("The pitch canvas is only available in a browser");
  return module;
}

export async function loadPitchPdfJs() {
  const module = await loadPitchPdfJsForClient();
  if (!module) throw new Error("Pitch PDF import is only available in a browser");
  return module;
}
