"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { registerApplicationFileDrop } from "@/features/media/ApplicationFileDrop";
import { prepareBrowserImage } from "@/features/media/browser-image-prep.client";
import { collectDroppedFiles } from "@/features/media/collect-dropped-files.client";
import { uploadPresignedObject } from "@/lib/client/presigned-upload";
import { mapWithConcurrency } from "@/lib/shared/map-with-concurrency";

/**
 * Guest media drop.
 *
 * One big button on a phone: pick photos and videos, watch them go up, get
 * a link to the shared album. iPhone HEICs are converted in the browser
 * before upload (the transfer pipeline archives the original), so "it
 * doesn't work on my iPhone" never happens at a party.
 */

type ItemStatus = "preparing" | "uploading" | "done" | "failed";

type UploadItem = {
  id: number;
  label: string;
  status: ItemStatus;
  error?: string;
};

type FilePayload = {
  name: string;
  size: number;
  type?: string;
  originalName?: string;
  originalSize?: number;
  originalType?: string;
  convertedFrom?: "browser_image";
};

const UPLOAD_ATTEMPTS = 4;

function retryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function retryDelay(attempt: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 350 * 2 ** attempt));
}

async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < UPLOAD_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (response.ok || !retryableStatus(response.status) || attempt === UPLOAD_ATTEMPTS - 1) {
        return response;
      }
    } catch (error) {
      lastError = error;
      if (attempt === UPLOAD_ATTEMPTS - 1) throw error;
    }
    await retryDelay(attempt);
  }
  throw lastError instanceof Error ? lastError : new Error("Upload request failed");
}

async function putFile(url: string, file: File, contentType: string): Promise<void> {
  const response = await uploadPresignedObject({
    url,
    body: file,
    contentType,
  });
  if (!response.ok) throw new Error(`Storage rejected ${file.name} (${response.status})`);
}

/**
 * Every phone calls its photos IMG_xxxx; a per-file tag keeps two guests'
 * IMG_0001.jpg from colliding in the shared album.
 */
function tagFilename(name: string, id: number): string {
  const tag = `${Date.now().toString(36).slice(-4)}${id.toString(36)}`;
  return `${tag}-${name}`;
}

export function DropPage({
  token,
  eventTitle,
  initialFileCount,
  albumPath,
}: {
  token: string;
  eventTitle: string;
  initialFileCount: number;
  albumPath: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const nextIdRef = useRef(1);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [albumCount, setAlbumCount] = useState(initialFileCount);
  const [notice, setNotice] = useState<string | null>(null);

  const setItem = useCallback((id: number, patch: Partial<UploadItem>) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const upload = useCallback(
    async (picked: File[]) => {
      if (picked.length === 0 || busy) return;
      setBusy(true);
      setNotice(null);

      const batch = picked.slice(0, 30).map((file) => {
        const id = nextIdRef.current++;
        return { id, file };
      });
      setItems((current) => [
        ...current,
        ...batch.map(({ id, file }) => ({
          id,
          label: file.name,
          status: "preparing" as ItemStatus,
        })),
      ]);

      try {
        // Normalize HEIF and oversized stills off-thread before anything moves.
        const prepared: {
          id: number;
          payload: FilePayload;
          uploadFile: File;
          originalFile?: File;
        }[] = [];
        const preparedResults = await mapWithConcurrency(batch, 2, async ({ id, file }) => {
          try {
            const result = await prepareBrowserImage(file, {
              archiveOriginal: true,
              derivePreview: true,
              requireBrowserDecode: true,
            });
            const name = tagFilename(result.uploadName, id);
            return {
              id,
              uploadFile: result.uploadFile,
              originalFile: result.originalFile,
              payload: {
                name,
                size: result.uploadFile.size,
                type: result.uploadFile.type || undefined,
                originalName: result.originalFile
                  ? tagFilename(result.originalFile.name, id)
                  : undefined,
                originalSize: result.originalFile?.size,
                originalType: result.originalFile?.type || undefined,
                convertedFrom: result.convertedFrom,
              },
            };
          } catch {
            setItem(id, { status: "failed", error: "couldn't read this file" });
            return null;
          }
        });
        prepared.push(...preparedResults.filter((entry) => entry !== null));
        if (prepared.length === 0) return;

        const presignResponse = await fetchWithRetry("/api/drop/presign", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, files: prepared.map((entry) => entry.payload) }),
        });
        const presignData = (await presignResponse.json().catch(() => ({}))) as {
          urls?: {
            name: string;
            contentType: string;
            primaryUrl: string;
            archivedOriginalUrl?: string;
          }[];
          error?: string;
        };
        if (!presignResponse.ok || !presignData.urls) {
          throw new Error(presignData.error ?? "Couldn't start the upload");
        }
        const urlByName = new Map(presignData.urls.map((entry) => [entry.name, entry]));

        const uploadedResults = await mapWithConcurrency(prepared, 2, async (entry) => {
          const target = urlByName.get(entry.payload.name);
          if (!target) {
            setItem(entry.id, { status: "failed", error: "no upload slot" });
            return null;
          }
          setItem(entry.id, { status: "uploading" });
          try {
            await putFile(target.primaryUrl, entry.uploadFile, target.contentType);
            if (entry.originalFile) {
              const archivedOriginalUrl = target.archivedOriginalUrl;
              if (!archivedOriginalUrl) {
                throw new Error("Storage did not provide an original-file upload slot");
              }
              await putFile(
                archivedOriginalUrl,
                entry.originalFile,
                entry.originalFile.type || "application/octet-stream",
              );
            }
            setItem(entry.id, { status: "done" });
            return entry.payload;
          } catch {
            setItem(entry.id, { status: "failed", error: "upload failed — try again" });
            return null;
          }
        });
        const uploaded = uploadedResults.filter((entry) => entry !== null);
        if (uploaded.length === 0) throw new Error("Nothing made it up — try again");

        const finalizeResponse = await fetchWithRetry("/api/drop/finalize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, files: uploaded }),
        });
        const finalizeData = (await finalizeResponse.json().catch(() => ({}))) as {
          shareUrl?: string;
          transfer?: { fileCount: number };
          error?: string;
        };
        if (!finalizeResponse.ok) {
          throw new Error(finalizeData.error ?? "Upload finished but saving failed — try again");
        }

        if (finalizeData.transfer) setAlbumCount(finalizeData.transfer.fileCount);
        setNotice(`${uploaded.length} added — thank you!`);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Something went wrong — try again");
      } finally {
        setBusy(false);
      }
    },
    [busy, setItem, token],
  );

  useEffect(
    () =>
      registerApplicationFileDrop(async (dataTransfer) => {
        const files = await collectDroppedFiles(dataTransfer);
        await upload(files);
      }),
    [upload],
  );

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? []);
      if (files.length === 0) return;
      event.preventDefault();
      void upload(files);
    };
    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, [upload]);

  return (
    <div className="min-h-dvh bg-background">
      <main id="main" className="mx-auto max-w-md px-6 pb-16 pt-14">
        <p className="font-mono text-micro theme-muted tracking-widest uppercase">
          share your photos
        </p>
        <h1 className="mt-2 font-serif text-3xl text-foreground">{eventTitle}</h1>
        <p className="mt-3 font-mono text-xs theme-muted leading-relaxed">
          Everything you add lands in the shared album for everyone who was there.
        </p>

        <input
          ref={inputRef}
          type="file"
          multiple
          accept="image/*,video/*"
          className="hidden"
          onChange={(event) => {
            const picked = Array.from(event.target.files ?? []);
            event.target.value = "";
            void upload(picked);
          }}
        />

        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="mt-8 min-h-16 w-full rounded-2xl bg-foreground font-mono text-base text-background disabled:opacity-60"
        >
          {busy ? "uploading…" : "add photos & videos"}
        </button>
        <p className="mt-2 text-center font-mono text-micro theme-faint">
          you can also drop or paste files anywhere on this page
        </p>

        {/* The album is browsable before uploading anything — seeing what's
            already there is half the fun and most of the trust. */}
        <a
          href={albumPath}
          className="mt-3 flex min-h-12 w-full items-center justify-center rounded-2xl border theme-border-strong font-mono text-sm text-foreground"
        >
          {albumCount > 0
            ? `browse the album (${albumCount} so far) →`
            : "peek at the album (empty so far) →"}
        </a>

        {notice && (
          <p aria-live="polite" className="mt-3 text-center font-mono text-xs text-foreground">
            {notice}
          </p>
        )}

        {items.length > 0 && (
          <ul className="mt-6 divide-y theme-border border-y theme-border">
            {items.map((item) => (
              <li
                key={item.id}
                className="flex items-center justify-between gap-3 py-2 font-mono text-xs"
              >
                <span className="truncate theme-muted">{item.label}</span>
                <span className="shrink-0">
                  {item.status === "done" && (
                    <span className="text-[var(--things-green)]">up ✓</span>
                  )}
                  {item.status === "failed" && (
                    <span className="text-[var(--things-country-outside)]">
                      {item.error ?? "failed"}
                    </span>
                  )}
                  {(item.status === "preparing" || item.status === "uploading") && (
                    <span className="theme-muted">
                      {item.status === "preparing" ? "preparing…" : "uploading…"}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-10 text-center font-mono text-micro theme-faint leading-relaxed">
          Uploads are shared with the organiser and other guests. Videos may take a moment to appear
          while previews are made.
        </p>
      </main>
    </div>
  );
}
