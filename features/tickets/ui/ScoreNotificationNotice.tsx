import { useEffect, useRef, useState } from "react";

import { subscribeScoreStream } from "@/features/event-scoring/score-event-stream";
import { ScoreBalanceChange } from "@/features/event-scoring/ui/ScoreBalanceChange";
import type { AchievementNotification } from "@/features/achievements/types";
import { AchievementUnlockNotice } from "@/features/achievements/ui/AchievementUnlockNotice";

type Notice = {
  id: string;
  kind: "positive" | "negative" | "held" | "reversal";
  points: number;
  reasonCode: string;
  transactionId: string;
};

type Reward =
  | { id: string; kind: "score"; notices: Notice[] }
  | { id: string; kind: "achievement"; achievement: AchievementNotification; notices: Notice[] };

export function ScoreNotificationNotice({ ticketId }: { ticketId: string }) {
  const [queue, setQueue] = useState<Reward[]>([]);
  const [balance, setBalance] = useState<number>();
  const seen = useRef(new Set<string>());

  useEffect(() => {
    if (!queue[0]) return;
    const delay = queue[0].kind === "achievement" ? 4_500 : 3_500;
    const timer = setTimeout(() => setQueue((current) => current.slice(1)), delay);
    return () => clearTimeout(timer);
  }, [queue]);

  useEffect(() => {
    let active = true;
    async function load() {
      const response = await fetch(
        `/api/tickets/${encodeURIComponent(ticketId)}/score/notifications`,
      );
      if (!response.ok || !active) return;
      const body = (await response.json()) as {
        notifications?: Notice[];
        achievements?: AchievementNotification[];
      };
      const next = body.notifications ?? [];
      const achievements = body.achievements ?? [];
      if (!active || (next.length === 0 && achievements.length === 0)) return;
      const scoreResponse = await fetch(`/api/tickets/${encodeURIComponent(ticketId)}/score`);
      if (scoreResponse.ok) {
        const scoreBody = (await scoreResponse.json()) as { participant?: { balance?: number } };
        if (typeof scoreBody.participant?.balance === "number")
          setBalance(scoreBody.participant.balance);
      }
      const pairedNoticeIds = new Set<string>();
      const rewards: Reward[] = achievements.map((achievement) => {
        const notices = next.filter(
          (notice) =>
            !pairedNoticeIds.has(notice.id) &&
            notice.transactionId === achievement.sourceTransactionId,
        );
        notices.forEach((notice) => pairedNoticeIds.add(notice.id));
        return { id: achievement.id, kind: "achievement", achievement, notices };
      });
      const remaining = next.filter((notice) => !pairedNoticeIds.has(notice.id));
      if (remaining.length > 0) {
        rewards.unshift({
          id: `scores:${remaining.map((notice) => notice.id).join(":")}`,
          kind: "score",
          notices: remaining,
        });
      }
      const unseen = rewards.filter((reward) => !seen.current.has(reward.id));
      unseen.forEach((reward) => seen.current.add(reward.id));
      if (unseen.length > 0) setQueue((current) => [...current, ...unseen]);
      await fetch(`/api/tickets/${encodeURIComponent(ticketId)}/score/notifications`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          notificationIds: next.map((notice) => notice.id),
          achievementNotificationIds: achievements.map((achievement) => achievement.id),
        }),
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
      window.removeEventListener("mah-score-wake", refresh);
    };
  }, [ticketId]);

  const reward = queue[0];
  if (!reward) return null;
  if (reward.kind === "score")
    return <ScoreBalanceChange notices={reward.notices} balance={balance} />;
  const points = reward.notices.reduce(
    (total, notice) => total + (notice.kind === "held" ? 0 : notice.points),
    0,
  );
  return (
    <AchievementUnlockNotice
      achievement={reward.achievement}
      points={points || undefined}
      balance={balance}
    />
  );
}
