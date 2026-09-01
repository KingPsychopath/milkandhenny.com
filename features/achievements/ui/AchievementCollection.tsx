import type { AchievementProgress, AchievementView } from "../types";
import { AchievementIcon } from "./AchievementIcon";

function AchievementList({ achievements }: { achievements: AchievementProgress[] }) {
  return (
    <ul className="divide-y border-y theme-border">
      {achievements.map((achievement) => {
        const unlocked = Boolean(achievement.unlockedAt);
        const percentage = Math.min(100, (achievement.current / achievement.target) * 100);
        return (
          <li key={`${achievement.key}:${achievement.eventSlug ?? "permanent"}`} className="py-4">
            <div className="flex gap-4">
              <span
                className={`flex size-11 shrink-0 items-center justify-center rounded-full border ${
                  unlocked
                    ? "border-[var(--status-positive)] text-[var(--status-positive)]"
                    : "theme-border-strong theme-muted"
                }`}
              >
                <AchievementIcon icon={achievement.icon} className="size-6" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="font-serif text-lg">{achievement.title}</h3>
                  <span className="shrink-0 font-mono text-micro theme-muted">
                    {unlocked ? "unlocked" : `${achievement.current}/${achievement.target}`}
                  </span>
                </div>
                <p className="mt-1 font-mono text-micro leading-relaxed theme-muted">
                  {achievement.secret && !unlocked
                    ? "Keep playing to discover this achievement."
                    : achievement.description}
                </p>
                {!unlocked && achievement.target > 1 ? (
                  <div
                    className="mt-3 h-1 overflow-hidden rounded-full bg-[var(--stone-200)]"
                    role="progressbar"
                    aria-label={`${achievement.title} progress`}
                    aria-valuemin={0}
                    aria-valuemax={achievement.target}
                    aria-valuenow={achievement.current}
                  >
                    <span
                      className="block h-full bg-foreground transition-[width]"
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                ) : null}
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function TicketAchievementCollection({ view }: { view: AchievementView }) {
  if (view.totalCount === 0) return null;
  return (
    <section className="mt-8 border-t theme-border pt-6" aria-labelledby="achievements-heading">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="achievements-heading" className="font-serif text-2xl">
          Achievements
        </h2>
        <span className="font-mono text-micro theme-muted">
          {view.unlockedCount}/{view.totalCount} unlocked
        </span>
      </div>
      <p className="mt-2 font-mono text-micro leading-relaxed theme-muted">
        This ticket keeps tonight&apos;s progress. Claimed achievements also stay in You.
      </p>
      {view.event.length > 0 ? (
        <div className="mt-5">
          <p className="mb-2 font-mono text-micro uppercase tracking-widest theme-muted">tonight</p>
          <AchievementList achievements={view.event} />
        </div>
      ) : null}
      {view.permanent.length > 0 ? (
        <div className="mt-6">
          <p className="mb-2 font-mono text-micro uppercase tracking-widest theme-muted">
            across Milk &amp; Henny
          </p>
          <AchievementList achievements={view.permanent} />
        </div>
      ) : null}
    </section>
  );
}

export function AchievementCabinet({ achievements }: { achievements: AchievementProgress[] }) {
  if (achievements.length === 0) return null;
  const unlocked = achievements.filter((achievement) => achievement.unlockedAt).length;
  return (
    <section className="mt-10 border-t theme-border pt-6" aria-labelledby="cabinet-heading">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="cabinet-heading" className="font-serif text-2xl">
          Achievement cabinet
        </h2>
        <span className="font-mono text-micro theme-muted">
          {unlocked}/{achievements.length}
        </span>
      </div>
      <p className="mt-2 max-w-md font-mono text-micro leading-relaxed theme-muted">
        Permanent unlocks from your claimed tickets, games and pitches.
      </p>
      <div className="mt-5">
        <AchievementList achievements={achievements} />
      </div>
    </section>
  );
}
