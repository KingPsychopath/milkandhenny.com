"use client";

import { useEffect } from "react";

type ApplicationFileDropHandler = (dataTransfer: DataTransfer) => void | Promise<void>;

const handlers: ApplicationFileDropHandler[] = [];

function registerApplicationFileDrop(handler: ApplicationFileDropHandler): () => void {
  handlers.push(handler);
  return () => {
    const index = handlers.lastIndexOf(handler);
    if (index >= 0) handlers.splice(index, 1);
  };
}

function hasFiles(event: DragEvent): boolean {
  const transfer = event.dataTransfer;
  return Boolean(
    transfer &&
    (transfer.files.length > 0 ||
      Array.from(transfer.items).some((item) => item.kind === "file") ||
      Array.from(transfer.types).includes("Files")),
  );
}

function isInsideDropZone(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest("[data-file-drop-zone]") !== null;
}

function ApplicationFileDrop() {
  useEffect(() => {
    const handleDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const handleDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (isInsideDropZone(event.target)) return;
      const handler = handlers.at(-1);
      if (handler && event.dataTransfer) void handler(event.dataTransfer);
    };

    window.addEventListener("dragover", handleDragOver, { capture: true });
    window.addEventListener("drop", handleDrop, { capture: true });
    return () => {
      window.removeEventListener("dragover", handleDragOver, { capture: true });
      window.removeEventListener("drop", handleDrop, { capture: true });
    };
  }, []);

  return null;
}

export { ApplicationFileDrop, registerApplicationFileDrop };
export type { ApplicationFileDropHandler };
