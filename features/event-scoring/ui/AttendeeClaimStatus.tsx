import { useCallback, useEffect, useState } from "react";

import {
  ATTENDEE_CLAIMS_EVENT,
  attendeeClaimSummary,
  dismissRejectedAttendeeClaims,
} from "../attendee-claims.client";

type ClaimSummary = Awaited<ReturnType<typeof attendeeClaimSummary>>;

export function AttendeeClaimStatus({
  eventSlug,
  participantId,
}: {
  eventSlug: string;
  participantId: string;
}) {
  const [summary, setSummary] = useState<ClaimSummary>({
    pending: 0,
    rejected: 0,
    rejectedReasons: [],
  });
  const refresh = useCallback(() => {
    void attendeeClaimSummary(eventSlug, participantId)
      .then(setSummary)
      .catch(() => undefined);
  }, [eventSlug, participantId]);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 5_000);
    window.addEventListener(ATTENDEE_CLAIMS_EVENT, refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(ATTENDEE_CLAIMS_EVENT, refresh);
    };
  }, [refresh]);

  if (summary.pending === 0 && summary.rejected === 0) return null;
  if (summary.rejected > 0) {
    return (
      <aside className="mt-4 border-y theme-border py-4" aria-labelledby="claim-help-heading">
        <p id="claim-help-heading" className="font-mono text-xs text-[var(--status-danger)]">
          {summary.rejected === 1
            ? "One points claim needs help."
            : `${summary.rejected} points claims need help.`}
        </p>
        <p className="mt-2 font-mono text-micro leading-relaxed theme-muted">
          {summary.rejectedReasons.at(-1) ?? "The points were not added."} Show this ticket to the
          event lead if that does not look right.
        </p>
        <button
          type="button"
          onClick={() => void dismissRejectedAttendeeClaims(eventSlug, participantId).then(refresh)}
          className="mh-action mh-action--quiet mt-2"
        >
          dismiss confirmed result
        </button>
      </aside>
    );
  }
  return (
    <p role="status" className="mt-4 font-mono text-micro leading-relaxed theme-muted">
      {summary.pending === 1 ? "One points claim is" : `${summary.pending} points claims are`} saved
      on this device and waiting for a definitive server result. Reconnection retries automatically.
    </p>
  );
}
