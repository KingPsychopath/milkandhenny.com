import { useState } from "react";

import { StatusNotice } from "@/components/StatusNotice";
import { setStaffGuestPhotosFn } from "../staff-scoring.functions";
import type { PageData } from "./useStaffScoringController";

export function StaffPhotosPanel({ data, token }: { data: PageData; token: string }) {
  const [drop, setDrop] = useState(data.mediaDrop);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const live = Boolean(drop?.uploadPath);

  async function setEnabled(enabled: boolean) {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const result = await setStaffGuestPhotosFn({
        data: { eventSlug: data.eventSlug, token, enabled },
      });
      if (!result.ok) return setError(result.error);
      setDrop(
        result.value
          ? {
              uploadPath: result.value.live ? `/drop/${result.value.token}` : undefined,
              albumPath: `/t/${result.value.transferId}`,
              expiresAt: result.value.expiresAt,
            }
          : undefined,
      );
      setStatus(enabled ? "The shared album is open." : "Uploads are closed.");
    } catch {
      setError("The photo control could not be updated. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="staff-photos-heading" className="mt-10 border-t theme-border pt-7">
      <h2 id="staff-photos-heading" className="font-serif text-2xl">
        Shared photos
      </h2>
      <p className="mt-2 font-mono text-xs leading-relaxed theme-muted">
        Open or close guest uploads. Photos already added stay viewable until the album expires.
      </p>

      {!data.guestPhotosAvailable ? (
        <StatusNotice tone="attention" label="Disabled by event settings" className="mt-4">
          Ask an admin to enable guest photos for this event first.
        </StatusNotice>
      ) : (
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <span className="font-mono text-xs">{live ? "uploads open" : "uploads closed"}</span>
          <button
            type="button"
            disabled={busy || live}
            onClick={() => void setEnabled(true)}
            className="mh-action mh-action--primary disabled:opacity-40"
          >
            open uploads
          </button>
          <button
            type="button"
            disabled={busy || !live}
            onClick={() => void setEnabled(false)}
            className="mh-action mh-action--secondary disabled:opacity-40"
          >
            close uploads
          </button>
          {drop?.albumPath ? (
            <a href={drop.albumPath} className="mh-action mh-action--quiet">
              view album
            </a>
          ) : null}
        </div>
      )}

      {error ? (
        <StatusNotice tone="danger" label="Could not update photos" className="mt-4">
          {error}
        </StatusNotice>
      ) : null}
      {status ? (
        <StatusNotice tone="positive" label="Photos updated" className="mt-4">
          {status}
        </StatusNotice>
      ) : null}
    </section>
  );
}
