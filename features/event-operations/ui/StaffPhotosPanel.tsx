import { useState } from "react";

import { StatusNotice } from "@/components/StatusNotice";
import { setStaffGuestPhotosFn } from "../staff-operations.functions";
import type { StaffOperationsData } from "./useStaffOperationsController";

function dateTime(value: string) {
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function StaffPhotosPanel({ data, token }: { data: StaffOperationsData; token: string }) {
  const [drop, setDrop] = useState(data.mediaDrop);
  const [schedule, setSchedule] = useState(data.mediaSchedule);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const live = Boolean(drop?.uploadPath);
  const eventHasNotStarted = Date.parse(data.eventStartsAt) > Date.now();

  async function setEnabled(enabled: boolean, opensAt?: string) {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const result = await setStaffGuestPhotosFn({
        data: { eventSlug: data.eventSlug, token, enabled, opensAt },
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const nextDrop = result.value.drop;
      const nextSchedule = result.value.schedule;
      setDrop(
        nextDrop
          ? {
              uploadPath: nextDrop.live ? `/drop/${nextDrop.token}` : undefined,
              albumPath: nextDrop.available ? `/t/${nextDrop.transferId}` : undefined,
              expiresAt: nextDrop.expiresAt,
            }
          : undefined,
      );
      setSchedule(
        nextSchedule && !nextSchedule.openedAt && !nextSchedule.cancelledAt
          ? { opensAt: nextSchedule.opensAt }
          : undefined,
      );
      setStatus(
        opensAt
          ? `The shared album will open at ${dateTime(opensAt)}.`
          : enabled
            ? "The shared album is open now."
            : schedule
              ? "The scheduled opening is cancelled."
              : "Uploads are closed. Existing photos remain viewable until expiry.",
      );
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
        This is a temporary event album. Closing uploads keeps existing files viewable; expiry
        removes the temporary album.
      </p>

      {!data.guestPhotosAvailable ? (
        <StatusNotice tone="attention" label="Disabled by event settings" className="mt-4">
          Ask an admin to enable guest photos for this event first.
        </StatusNotice>
      ) : (
        <div className="mt-5">
          <p className="font-mono text-xs" role="status">
            {live
              ? "uploads open now"
              : schedule
                ? `scheduled to open ${dateTime(schedule.opensAt)}`
                : drop?.albumPath
                  ? "uploads closed · album still viewable"
                  : drop
                    ? "previous temporary album expired"
                    : "album not open"}
          </p>
          {drop?.albumPath ? (
            <p className="mt-1 font-mono text-micro theme-muted">
              temporary album available until {dateTime(drop.expiresAt)}
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            {!live ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void setEnabled(true)}
                className="mh-action mh-action--primary disabled:opacity-40"
              >
                {drop?.albumPath ? "reopen uploads now" : "open a new album now"}
              </button>
            ) : null}
            {live ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void setEnabled(false)}
                className="mh-action mh-action--secondary disabled:opacity-40"
              >
                close uploads
              </button>
            ) : schedule ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void setEnabled(false)}
                className="mh-action mh-action--secondary disabled:opacity-40"
              >
                cancel scheduled opening
              </button>
            ) : eventHasNotStarted ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void setEnabled(true, data.eventStartsAt)}
                className="mh-action mh-action--secondary disabled:opacity-40"
              >
                open at event start
              </button>
            ) : null}
            {drop?.albumPath ? (
              <a href={drop.albumPath} className="mh-action mh-action--quiet">
                view album
              </a>
            ) : null}
          </div>
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
