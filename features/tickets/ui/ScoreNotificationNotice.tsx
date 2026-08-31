import { useEffect, useRef, useState } from "react";

import { subscribeScoreStream } from "@/features/event-scoring/score-event-stream";
import { ScoreBalanceChange } from "@/features/event-scoring/ui/ScoreBalanceChange";

type Notice = {
  id: string;
  kind: "positive" | "negative" | "held" | "reversal";
  points: number;
  reasonCode: string;
};

export function ScoreNotificationNotice({ ticketId }: { ticketId: string }) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [balance, setBalance] = useState<number>();
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    let active = true;
    async function load() {
      const response = await fetch(
        `/api/tickets/${encodeURIComponent(ticketId)}/score/notifications`,
      );
      if (!response.ok || !active) return;
      const body = (await response.json()) as { notifications?: Notice[] };
      const next = body.notifications ?? [];
      if (!active || next.length === 0) return;
      const scoreResponse = await fetch(`/api/tickets/${encodeURIComponent(ticketId)}/score`);
      if (scoreResponse.ok) {
        const scoreBody = (await scoreResponse.json()) as { participant?: { balance?: number } };
        if (typeof scoreBody.participant?.balance === "number")
          setBalance(scoreBody.participant.balance);
      }
      setNotices(next.slice(-3));
      clearTimeout(dismissTimer.current);
      dismissTimer.current = setTimeout(() => setNotices([]), 8_000);
      await fetch(`/api/tickets/${encodeURIComponent(ticketId)}/score/notifications`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notificationIds: next.map((notice) => notice.id) }),
      });
      window.dispatchEvent(new Event("mah-score-wake"));
    }
    // Notices are a nicety: an offline ticket page or a non-JSON response
    // should fail silently, not surface an unhandled rejection.
    const refresh = () => void load().catch(() => undefined);
    const unsubscribe = subscribeScoreStream(ticketId, (event) => {
      if (event.kind !== "unavailable") refresh();
    });
    refresh();
    const fallback = window.setInterval(refresh, 5_000);
    window.addEventListener("mah-score-wake", refresh);
    return () => {
      active = false;
      unsubscribe();
      window.clearInterval(fallback);
      clearTimeout(dismissTimer.current);
      window.removeEventListener("mah-score-wake", refresh);
    };
  }, [ticketId]);

  if (notices.length === 0) return null;
  return <ScoreBalanceChange notices={notices} balance={balance} />;
}
