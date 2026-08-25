import { useEffect, useState } from "react";

type Notice = {
  id: string;
  kind: "positive" | "negative" | "held" | "reversal";
  points: number;
  reasonCode: string;
};

export function ScoreNotificationNotice({ ticketId }: { ticketId: string }) {
  const [notices, setNotices] = useState<Notice[]>([]);

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
      setNotices(next.slice(-3));
      await fetch(`/api/tickets/${encodeURIComponent(ticketId)}/score/notifications`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ notificationIds: next.map((notice) => notice.id) }),
      });
      window.dispatchEvent(new Event("mah-score-wake"));
    }
    void load();
    return () => {
      active = false;
    };
  }, [ticketId]);

  if (notices.length === 0) return null;
  return (
    <div aria-live="polite" className="mt-4 border-y theme-border py-3">
      {notices.map((notice) => (
        <p key={notice.id} className="font-mono text-xs">
          {notice.kind === "held"
            ? `${Math.abs(notice.points)} points pending review`
            : `${notice.points > 0 ? "+" : ""}${notice.points} points · ${notice.reasonCode.replaceAll("-", " ")}`}
        </p>
      ))}
    </div>
  );
}
