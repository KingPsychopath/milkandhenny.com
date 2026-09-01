import type { AchievementNotification } from "../types";
import { AchievementIcon } from "./AchievementIcon";

function signedPoints(points: number) {
  return `${points > 0 ? "+" : ""}${points}`;
}

export function AchievementUnlockNotice({
  achievement,
  points,
  balance,
}: {
  achievement: AchievementNotification;
  points?: number;
  balance?: number;
}) {
  return (
    <aside
      aria-label={`Achievement unlocked: ${achievement.title}`}
      className="achievement-celebration fixed inset-x-3 bottom-3 z-40 mx-auto max-w-sm overflow-hidden rounded-[1.75rem] border border-[var(--status-positive)] bg-background/95 px-5 py-5 shadow-2xl backdrop-blur-xl sm:bottom-5"
    >
      <div className="flex items-center gap-4">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-full border border-[var(--status-positive)] text-[var(--status-positive)]">
          <AchievementIcon icon={achievement.icon} className="size-8" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-mono text-micro uppercase tracking-widest text-[var(--status-positive)]">
            achievement unlocked
          </p>
          <h2 className="mt-1 font-serif text-2xl">{achievement.title}</h2>
        </div>
        {points ? (
          <span className="shrink-0 rounded-full border theme-border-strong px-3 py-1.5 font-mono text-sm">
            {signedPoints(points)}
          </span>
        ) : null}
      </div>
      <p className="mt-4 font-mono text-xs leading-relaxed theme-muted">
        {achievement.description}
      </p>
      {balance !== undefined && points ? (
        <p className="mt-3 font-mono text-micro theme-muted">new total: {balance} points</p>
      ) : null}
      <p className="sr-only" aria-live="polite">
        Achievement unlocked: {achievement.title}.
        {points ? ` ${Math.abs(points)} points ${points > 0 ? "added" : "removed"}.` : ""}
      </p>
    </aside>
  );
}
