"use client";

import { useRef, useState } from "react";

import { prepareTransferUploadFile } from "@/features/transfers/browser-heif";

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
  convertedFrom?: "heic";
};

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
}: {
  token: string;
  eventTitle: string;
  initialFileCount: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const nextIdRef = useRef(1);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [albumUrl, setAlbumUrl] = useState<string | null>(null);
  const [albumCount, setAlbumCount] = useState(initialFileCount);
  const [notice, setNotice] = useState<string | null>(null);

  const setItem = (id: number, patch: Partial<UploadItem>) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const upload = async (picked: File[]) => {
    if (picked.length === 0) return;
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
      // Convert HEICs and derive previews on-device before anything moves.
      const prepared: {
        id: number;
        payload: FilePayload;
        uploadFile: File;
        originalFile?: File;
      }[] = [];
      for (const { id, file } of batch) {
        try {
          const result = await prepareTransferUploadFile(file, { derivePreview: true });
          const name = tagFilename(result.uploadName, id);
          prepared.push({
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
          });
        } catch {
          setItem(id, { status: "failed", error: "couldn't read this file" });
        }
      }
      if (prepared.length === 0) return;

      const presignResponse = await fetch("/api/drop/presign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, files: prepared.map((entry) => entry.payload) }),
      });
      const presignData: {
        urls?: {
          name: string;
          contentType: string;
          primaryUrl: string;
          archivedOriginalUrl?: string;
        }[];
        error?: string;
      } = await presignResponse.json().catch(() => ({}));
      if (!presignResponse.ok || !presignData.urls) {
        throw new Error(presignData.error ?? "Couldn't start the upload");
      }
      const urlByName = new Map(presignData.urls.map((entry) => [entry.name, entry]));

      const uploaded: FilePayload[] = [];
      for (const entry of prepared) {
        const target = urlByName.get(entry.payload.name);
        if (!target) {
          setItem(entry.id, { status: "failed", error: "no upload slot" });
          continue;
        }
        setItem(entry.id, { status: "uploading" });
        try {
          const put = await fetch(target.primaryUrl, {
            method: "PUT",
            headers: { "Content-Type": target.contentType },
            body: entry.uploadFile,
          });
          if (!put.ok) throw new Error(`storage said ${put.status}`);
          if (entry.originalFile && target.archivedOriginalUrl) {
            await fetch(target.archivedOriginalUrl, {
              method: "PUT",
              headers: {
                "Content-Type": entry.originalFile.type || "application/octet-stream",
              },
              body: entry.originalFile,
            }).catch(() => undefined);
          }
          uploaded.push(entry.payload);
          setItem(entry.id, { status: "done" });
        } catch {
          setItem(entry.id, { status: "failed", error: "upload failed — try again" });
        }
      }
      if (uploaded.length === 0) throw new Error("Nothing made it up — try again");

      const finalizeResponse = await fetch("/api/drop/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, files: uploaded }),
      });
      const finalizeData: {
        shareUrl?: string;
        transfer?: { fileCount: number };
        error?: string;
      } = await finalizeResponse.json().catch(() => ({}));
      if (!finalizeResponse.ok) {
        throw new Error(finalizeData.error ?? "Upload finished but saving failed — try again");
      }

      if (finalizeData.shareUrl) setAlbumUrl(finalizeData.shareUrl);
      if (finalizeData.transfer) setAlbumCount(finalizeData.transfer.fileCount);
      setNotice(`${uploaded.length} added — thank you!`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Something went wrong — try again");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <main id="main" className="mx-auto max-w-md px-6 pb-16 pt-14">
        <p className="font-mono text-micro theme-muted tracking-widest uppercase">
          share your photos
        </p>
        <h1 className="mt-2 font-serif text-3xl text-foreground">{eventTitle}</h1>
        <p className="mt-3 font-mono text-xs theme-muted leading-relaxed">
          Everything you add lands in the shared album for everyone who was there.
          {albumCount > 0 ? ` ${albumCount} in there so far.` : ""}
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

        {albumUrl && (
          <p className="mt-6 text-center">
            <a href={albumUrl} className="font-mono text-sm text-foreground underline">
              open the shared album →
            </a>
          </p>
        )}

        <p className="mt-10 text-center font-mono text-micro theme-faint leading-relaxed">
          Uploads are shared with the organiser and other guests. Videos may take a moment to appear
          while previews are made.
        </p>
      </main>
    </div>
  );
}
