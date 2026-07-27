import { useEffect, useRef } from "react";

/**
 * Apply live processing updates for one transfer.
 *
 * Files that were queued for the media worker land in the page as
 * `original_only`; this stream delivers each one again when its poster is
 * ready, and `onFile` patches it into place. `EventSource` reconnects on its
 * own, so a dropped connection costs a few seconds, not a refresh.
 *
 * Pass `enabled: false` once nothing is outstanding — an open stream holds a
 * connection on both ends for updates that will never come.
 */
function useTransferMediaEvents<T extends { id: string }>(params: {
  transferId: string;
  enabled: boolean;
  onFile: (file: T) => void;
}): void {
  const { transferId, enabled } = params;

  // Keep the callback out of the effect's deps: re-running it would tear down
  // and rebuild the connection on every parent render.
  const onFileRef = useRef(params.onFile);
  useEffect(() => {
    onFileRef.current = params.onFile;
  }, [params.onFile]);

  useEffect(() => {
    if (!enabled || typeof window === "undefined" || !("EventSource" in window)) return;

    const source = new EventSource(`/api/transfers/${encodeURIComponent(transferId)}/events`);

    const handleFile = (event: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(event.data) as { file?: T };
        if (parsed.file && typeof parsed.file.id === "string") {
          onFileRef.current(parsed.file);
        }
      } catch {
        // A malformed frame is not worth tearing the stream down for.
      }
    };

    // The server sends this when it has no backplane to stream from; without
    // closing, EventSource would reconnect to the same dead end forever.
    const handleUnavailable = () => source.close();

    source.addEventListener("file", handleFile as EventListener);
    source.addEventListener("unavailable", handleUnavailable);

    return () => {
      source.removeEventListener("file", handleFile as EventListener);
      source.removeEventListener("unavailable", handleUnavailable);
      source.close();
    };
  }, [enabled, transferId]);
}

export { useTransferMediaEvents };
