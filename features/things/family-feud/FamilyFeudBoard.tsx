import { useEffect, useRef, useState } from "react";

import type {
  FamilyFeudAnswerSnapshot,
  FamilyFeudSnapshot,
  FamilyFeudTeamId,
  FamilyFeudTeamSnapshot,
} from "./types";

export function FamilyFeudTeamMark({
  team,
  compact = false,
  truncate = false,
}: {
  team: FamilyFeudTeamSnapshot;
  compact?: boolean;
  truncate?: boolean;
}) {
  const colour = team.id === "one" ? "var(--things-amber)" : "var(--things-frost)";
  const marker = (
    <span
      aria-hidden="true"
      className={`${compact ? "mr-1 h-3 w-3" : "mr-2 h-4 w-4"} inline-block shrink-0 align-[-0.08em] border-2 border-current ${team.marker === "circle" ? "rounded-full" : "feud-triangle"}`}
    />
  );
  if (truncate)
    return (
      <span className="inline-flex min-w-0 items-center text-current" style={{ color: colour }}>
        {marker}
        <span className="truncate">{team.name}</span>
      </span>
    );
  return (
    <span className="text-current" style={{ color: colour }}>
      {marker}
      <span>{team.name}</span>
    </span>
  );
}

export function FamilyFeudScoreboard({
  snapshot,
  animateAwards = false,
}: {
  snapshot: FamilyFeudSnapshot;
  animateAwards?: boolean;
}) {
  const oneScore = snapshot.teams[0].score;
  const twoScore = snapshot.teams[1].score;
  const [displayScores, setDisplayScores] = useState({ one: oneScore, two: twoScore });
  const lastAward = useRef<string | null>(null);
  const cue = snapshot.cue;
  const awardId = animateAwards && cue?.kind === "correct" ? cue.id : null;
  const awardTeamId = awardId ? cue?.teamId : undefined;
  const awardPoints = awardId ? cue?.points : undefined;
  const award =
    awardId && awardTeamId && awardPoints
      ? { id: awardId, teamId: awardTeamId, points: awardPoints }
      : null;
  useEffect(() => {
    const settled = { one: oneScore, two: twoScore };
    if (!awardId || !awardTeamId || !awardPoints || awardId === lastAward.current) {
      setDisplayScores(settled);
      return;
    }
    lastAward.current = awardId;
    setDisplayScores({
      ...settled,
      [awardTeamId]: Math.max(0, settled[awardTeamId] - awardPoints),
    });
    const timer = window.setTimeout(() => setDisplayScores(settled), 650);
    return () => window.clearTimeout(timer);
  }, [awardId, awardPoints, awardTeamId, oneScore, twoScore]);
  return (
    <div className="grid grid-cols-2 border-y border-white/12" aria-label="Score">
      {snapshot.teams.map((team) => (
        <div
          key={team.id}
          className={`relative flex min-w-0 items-center justify-between gap-1 px-1 py-3 text-sm min-[360px]:gap-2 min-[360px]:px-2 sm:gap-4 sm:px-6 sm:text-base ${team.id === "one" ? "border-r border-white/12" : ""}`}
        >
          <FamilyFeudTeamMark team={team} compact truncate />
          {award?.teamId === team.id ? (
            <span
              key={award.id}
              aria-hidden="true"
              className="feud-score-float pointer-events-none absolute right-12 top-1/2 z-10 font-mono text-xl font-semibold tabular-nums sm:right-16 sm:text-2xl"
              style={{
                color: team.id === "one" ? "var(--things-amber)" : "var(--things-frost)",
              }}
            >
              +{award.points}
            </span>
          ) : null}
          <span className="shrink-0 font-mono text-2xl tabular-nums text-white sm:text-3xl">
            {displayScores[team.id]}
          </span>
        </div>
      ))}
      <span className="sr-only" aria-live="polite">
        {award
          ? `${snapshot.teams.find(({ id }) => id === award.teamId)?.name} gains ${award.points} points.`
          : ""}
      </span>
    </div>
  );
}

export function FamilyFeudAnswerBoard({
  answers,
  activeTeamId,
  houseAnswers = [],
  onAnswer,
  privateAnswers = false,
}: {
  answers: FamilyFeudAnswerSnapshot[];
  activeTeamId?: FamilyFeudTeamId;
  houseAnswers?: NonNullable<FamilyFeudSnapshot["round"]>["houseAnswers"];
  onAnswer?: (answer: FamilyFeudAnswerSnapshot) => void;
  privateAnswers?: boolean;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2" aria-label={`${answers.length} answers`}>
      {answers.map((answer) => {
        const shown = answer.shown || privateAnswers;
        const content = (
          <>
            <span
              aria-hidden="true"
              className={`feud-answer-card ${shown ? "feud-answer-card--shown" : ""} ${privateAnswers ? "feud-answer-card--private" : ""}`}
            >
              <span className="feud-answer-face feud-answer-face--closed">
                <span className="feud-answer-number font-mono text-xl tabular-nums">
                  {answer.position}
                </span>
              </span>
              <span className="feud-answer-face feud-answer-face--open gap-3 px-4">
                <span className="font-mono text-xs text-white/40 tabular-nums">
                  {String(answer.position).padStart(2, "0")}
                </span>
                <span className="min-w-0 flex-1 truncate font-serif text-lg sm:text-xl">
                  {answer.label ?? "—"}
                </span>
                <span className="font-mono text-xs text-white/45 tabular-nums">
                  {answer.boardValue} {answer.boardValue === 1 ? "pt" : "pts"}
                </span>
              </span>
            </span>
            <span className="sr-only">
              {shown
                ? `${answer.position}, ${answer.label}, worth ${answer.boardValue} ${answer.boardValue === 1 ? "point" : "points"}`
                : `Answer ${answer.position}, hidden`}
            </span>
          </>
        );
        const colour =
          answer.awardedTeamId === "one"
            ? "var(--things-amber)"
            : answer.awardedTeamId === "two"
              ? "var(--things-frost)"
              : undefined;
        const classes = `feud-answer-shell relative min-h-16 overflow-hidden rounded-xl border text-left ${
          shown ? "border-white/18 text-white" : "border-white/10 bg-white/[0.025] text-white/20"
        } ${onAnswer ? "w-full transition-opacity hover:opacity-75 disabled:opacity-45" : ""}`;
        return onAnswer ? (
          <button
            key={answer.id}
            type="button"
            onClick={() => onAnswer(answer)}
            disabled={answer.revealed}
            className={classes}
            style={{ borderInlineStartColor: colour }}
            aria-label={
              answer.revealed
                ? `${answer.position}, ${answer.label}, worth ${answer.boardValue} ${answer.boardValue === 1 ? "point" : "points"}, already revealed`
                : `Reveal answer ${answer.position}, ${answer.label}, worth ${answer.boardValue} ${answer.boardValue === 1 ? "point" : "points"}`
            }
          >
            {content}
          </button>
        ) : (
          <div
            key={answer.id}
            className={classes}
            style={{ borderInlineStartColor: colour }}
            aria-label={
              shown
                ? `Answer ${answer.position}, ${answer.label}, worth ${answer.boardValue} ${answer.boardValue === 1 ? "point" : "points"}`
                : `Answer ${answer.position}, hidden`
            }
          >
            {content}
          </div>
        );
      })}
      {houseAnswers.map((answer) => (
        <div
          key={answer.id}
          className="feud-answer-revealed flex min-h-14 items-center gap-3 rounded-xl border border-dashed border-white/25 bg-white/[0.07] px-4 text-white"
        >
          <span className="font-mono text-xs text-[var(--things-amber)]">H</span>
          <span className="min-w-0 flex-1 truncate font-serif text-lg">{answer.label}</span>
          <span className="font-mono text-xs text-white/45">+{answer.points}</span>
        </div>
      ))}
      {activeTeamId ? <span className="sr-only">Active team: {activeTeamId}</span> : null}
    </div>
  );
}
