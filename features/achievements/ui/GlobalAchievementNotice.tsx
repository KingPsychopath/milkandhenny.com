import { useEffect, useRef, useState } from "react";
import { useRouterState } from "@tanstack/react-router";

import type { AchievementNotification } from "../types";
import {
  getAchievementNotificationsFn,
  markAchievementNotificationsDeliveredFn,
} from "../achievements.functions";
import { AchievementUnlockNotice } from "./AchievementUnlockNotice";

export function GlobalAchievementNotice({ authenticated }: { authenticated: boolean }) {
  const [queue, setQueue] = useState<AchievementNotification[]>([]);
  const seen = useRef(new Set<string>());
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  // Ticket pages merge achievement and score rewards into one queue. Keeping the
  // account notifier dormant there prevents two celebrations covering each other.
  const ticketOwnsRewardQueue = pathname.startsWith("/ticket/");

  useEffect(() => {
    if (!authenticated || ticketOwnsRewardQueue) return;
    let active = true;
    async function refresh() {
      const achievements = await getAchievementNotificationsFn();
      if (!active) return;
      const unseen = achievements.filter((achievement) => !seen.current.has(achievement.id));
      unseen.forEach((achievement) => seen.current.add(achievement.id));
      if (unseen.length > 0) setQueue((current) => [...current, ...unseen]);
      if (achievements.length > 0) {
        await markAchievementNotificationsDeliveredFn({
          data: { notificationIds: achievements.map((achievement) => achievement.id) },
        });
      }
    }
    const load = () => void refresh().catch(() => undefined);
    load();
    const interval = window.setInterval(load, 8_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [authenticated, ticketOwnsRewardQueue]);

  useEffect(() => {
    if (!queue[0]) return;
    const timer = window.setTimeout(() => setQueue((current) => current.slice(1)), 4_500);
    return () => window.clearTimeout(timer);
  }, [queue]);

  return queue[0] ? (
    <AchievementUnlockNotice
      achievement={queue[0]}
      points={queue[0].sourceTransactionId ? queue[0].rewardPoints : undefined}
    />
  ) : null;
}
