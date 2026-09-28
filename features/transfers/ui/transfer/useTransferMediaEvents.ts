import { useEffect, useRef } from "react";

/**
 * Signal that media processing may have changed for one transfer.
 * The caller reconciles each wake with the authoritative transfer read.
 *
 * Pass `enabled: false` once nothing is outstanding — an open stream holds a
 * connection on both ends for updates that will never come.
 */
function useTransferMediaEvents<T extends { id: string }>(params: {
  transferId: string;
  enabled: boolean;
  onFile: (file: T) => void;
  onConnected?: () => void;
}): void {
  const { transferId, enabled } = params;

  // Keep the callback out of the effect's deps: re-running it would tear down
  // and rebuild the connection on every parent render.
  const onFileRef = useRef(params.onFile);
  const onConnectedRef = useRef(params.onConnected);
  useEffect(() => {
    onFileRef.current = params.onFile;
    onConnectedRef.current = params.onConnected;
  }, [params.onFile, params.onConnected]);

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
    const handleConnected = () => onConnectedRef.current?.();

    source.addEventListener("file", handleFile as EventListener);
    source.addEventListener("unavailable", handleUnavailable);
    source.addEventListener("open", handleConnected);

    return () => {
      source.removeEventListener("file", handleFile as EventListener);
      source.removeEventListener("unavailable", handleUnavailable);
      source.removeEventListener("open", handleConnected);
      source.close();
    };
  }, [enabled, transferId]);
}

export { useTransferMediaEvents };
