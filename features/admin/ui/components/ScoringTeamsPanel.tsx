import { useEffect, useState, type FormEvent } from "react";

import { AppSelect } from "@/components/AppSelect";
import { TeamBadge } from "@/features/event-operations/ui/TeamBadge";
import type { AdminScoringTeam, AdminTeamParticipant, ScoringAction } from "./event-scoring-types";

type Participant = {
  id: string;
  displayName?: string;
  publicAlias: string;
  balance: number;
  checkedIn: boolean;
  teamName?: string;
};

type ParticipantScore = {
  participant: { name: string; publicAlias: string; points: number; teamName?: string };
  transactions: Array<{
    transactionId: string;
    activityName?: string;
    reasonCode: string;
    status: string;
    points: number;
    createdAt: string;
  }>;
};

export function ScoringTeamsPanel({
  eventSlug,
  teams,
  teamRoster,
  authFetch,
  onAction,
}: {
  eventSlug: string;
  teams: AdminScoringTeam[];
  teamRoster: AdminTeamParticipant[];
  authFetch: (url: string, options?: RequestInit) => Promise<Response>;
  onAction: ScoringAction;
}) {
  const activeTeams = teams.filter((team) => team.status === "active");
  const [teamCount, setTeamCount] = useState<2 | 3 | 4>(
    activeTeams.length === 3 || activeTeams.length === 4 ? activeTeams.length : 2,
  );
  const [name, setName] = useState("");
  const [term, setTerm] = useState("");
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [participant, setParticipant] = useState<Participant | null>(null);
  const [teamId, setTeamId] = useState(activeTeams[0]?.id ?? "");
  const [searchMessage, setSearchMessage] = useState("");
  const [participantScore, setParticipantScore] = useState<ParticipantScore | null>(null);
  const [scoreMessage, setScoreMessage] = useState("");

  useEffect(() => {
    const selectable = teams.filter((team) => team.status === "active");
    if (!selectable.some((team) => team.id === teamId)) setTeamId(selectable[0]?.id ?? "");
    if (selectable.length === 2 || selectable.length === 3 || selectable.length === 4) {
      setTeamCount(selectable.length);
    }
  }, [teamId, teams]);

  async function shuffle() {
    await onAction({ action: "shuffle-teams", teamCount });
  }

  async function create(event: FormEvent) {
    event.preventDefault();
    const result = await onAction({ action: "create-team", name });
    if (result) setName("");
  }

  async function search(event: FormEvent) {
    event.preventDefault();
    setSearchMessage("");
    const response = await authFetch(
      `/api/admin/events/${encodeURIComponent(eventSlug)}/scoring?participant=${encodeURIComponent(term)}`,
    );
    const body = (await response.json().catch(() => null)) as {
      participants?: Participant[];
      error?: string;
    } | null;
    if (!response.ok) {
      setParticipants([]);
      setSearchMessage(body?.error ?? "Could not search attendees.");
      return;
    }
    const matches = body?.participants ?? [];
    setParticipants(matches);
    setSearchMessage(matches.length === 0 ? "No attendees matched that search." : "");
  }

  async function assign(event: FormEvent) {
    event.preventDefault();
    if (!participant || !teamId) return;
    const result = await onAction({ action: "assign-team", participantId: participant.id, teamId });
    if (result) {
      setParticipant(null);
      setParticipants([]);
      setTerm("");
    }
  }

  async function selectParticipant(entry: Participant) {
    setParticipant(entry);
    setParticipants([]);
    setParticipantScore(null);
    setScoreMessage("Loading point history…");
    const response = await authFetch(
      `/api/admin/events/${encodeURIComponent(eventSlug)}/scoring?scoreParticipant=${encodeURIComponent(entry.id)}`,
    );
    const body = (await response.json().catch(() => null)) as {
      participantScore?: ParticipantScore;
      error?: string;
    } | null;
    if (!response.ok || !body?.participantScore) {
      setScoreMessage(body?.error ?? "Could not load point history.");
      return;
    }
    setParticipantScore(body.participantScore);
    setScoreMessage("");
  }

  return (
    <section aria-labelledby="scoring-teams-heading" className="border-t theme-border pt-6">
      <h4 id="scoring-teams-heading" className="font-serif text-xl">
        Attendee teams
      </h4>
      <p className="mt-2 font-mono text-xs leading-relaxed theme-muted">
        Pick a team count, then shuffle everyone currently checked in. New arrivals automatically
        join the smallest team.
      </p>

      <div className="mt-5 grid grid-cols-3 gap-2" aria-label="Number of event teams">
        {([2, 3, 4] as const).map((count) => (
          <button
            key={count}
            type="button"
            aria-pressed={teamCount === count}
            onClick={() => setTeamCount(count)}
            className="min-h-11 border theme-border px-3 font-mono text-xs aria-pressed:border-foreground aria-pressed:bg-[var(--stone-100)] hover:opacity-70"
          >
            {count} teams
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => void shuffle()}
        className="mh-action mh-action--primary mt-3 w-full"
      >
        shuffle {teamRoster.length} checked-in {teamRoster.length === 1 ? "guest" : "guests"}
      </button>
      <p className="mt-2 font-mono text-micro theme-muted">
        Team sizes differ by at most one. Existing point history keeps its original team.
      </p>

      {activeTeams.length > 0 ? (
        <ul className="mt-5 divide-y border-y theme-border">
          {activeTeams.map((team) => (
            <li key={team.id} className="flex min-h-12 items-center py-2">
              <TeamBadge
                name={team.name}
                colourKey={team.colourKey}
                detail={`${team.checkedInCount} checked in`}
              />
            </li>
          ))}
        </ul>
      ) : null}

      <details className="mt-6 border-t theme-border pt-2">
        <summary className="min-h-11 cursor-pointer py-3 font-mono text-xs underline">
          find a person, view points or move teams
        </summary>
        <form onSubmit={(event) => void create(event)} className="mt-3 flex gap-2">
          <label htmlFor="scoring-new-team" className="sr-only">
            New team name
          </label>
          <input
            id="scoring-new-team"
            required
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="new team name"
            className="min-h-11 min-w-0 flex-1 border theme-border bg-transparent px-3 font-mono text-xs"
          />
          <button className="min-h-11 border theme-border px-3 font-mono text-xs hover:opacity-70">
            create
          </button>
        </form>

        <form onSubmit={(event) => void search(event)} className="mt-5 flex gap-2">
          <label htmlFor="scoring-team-participant" className="sr-only">
            Attendee name, alias, or ticket suffix
          </label>
          <input
            id="scoring-team-participant"
            required
            minLength={2}
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="name, alias, or ticket suffix"
            className="min-h-11 min-w-0 flex-1 border theme-border bg-transparent px-3 font-mono text-xs"
          />
          <button className="min-h-11 border theme-border px-3 font-mono text-xs hover:opacity-70">
            search
          </button>
        </form>
        {searchMessage ? (
          <p role="status" className="mt-3 font-mono text-xs theme-muted">
            {searchMessage}
          </p>
        ) : null}
        {participants.length > 0 ? (
          <ul className="mt-2 divide-y border-y theme-border">
            {participants.map((entry) => (
              <li key={entry.id}>
                <button
                  type="button"
                  onClick={() => void selectParticipant(entry)}
                  className="flex min-h-11 w-full flex-wrap items-center justify-between gap-2 py-2 text-left hover:opacity-70"
                >
                  <span className="font-serif">{entry.displayName ?? entry.publicAlias}</span>
                  <span className="font-mono text-micro theme-muted">
                    {entry.teamName ? `${entry.teamName} · ` : ""}
                    {entry.checkedIn ? "checked in" : "not checked in"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        {participant ? (
          <section
            aria-labelledby="participant-score-heading"
            className="mt-5 border-y theme-border py-4"
          >
            <div className="flex items-baseline justify-between gap-4">
              <h5 id="participant-score-heading" className="font-serif text-lg">
                {participant.displayName ?? participant.publicAlias}
              </h5>
              <span className="font-mono text-sm">
                {participantScore?.participant.points ?? participant.balance} points
              </span>
            </div>
            {scoreMessage ? (
              <p role="status" className="mt-3 font-mono text-xs theme-muted">
                {scoreMessage}
              </p>
            ) : participantScore?.transactions.length ? (
              <ol className="mt-3 divide-y theme-border">
                {participantScore.transactions.map((entry) => (
                  <li
                    key={entry.transactionId}
                    className="flex items-start justify-between gap-4 py-3"
                  >
                    <span className="min-w-0 font-mono text-xs">
                      <span className="block">
                        {entry.activityName ?? entry.reasonCode.replaceAll("-", " ")}
                        {entry.status === "held" ? " · pending review" : ""}
                        {entry.status === "reversed" ? " · reversed" : ""}
                      </span>
                      <time className="mt-1 block theme-muted" dateTime={entry.createdAt}>
                        {new Intl.DateTimeFormat("en-GB", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(new Date(entry.createdAt))}
                      </time>
                    </span>
                    <span className="font-mono text-xs">
                      {entry.points > 0 ? "+" : ""}
                      {entry.points}
                    </span>
                  </li>
                ))}
              </ol>
            ) : participantScore ? (
              <p className="mt-3 font-mono text-xs theme-muted">No score entries yet.</p>
            ) : null}
          </section>
        ) : null}

        {participant && activeTeams.length > 0 ? (
          <form onSubmit={(event) => void assign(event)} className="mt-4 grid gap-4 sm:grid-cols-2">
            <p className="font-serif sm:col-span-2">
              {participant.displayName ?? participant.publicAlias}
              {participant.teamName ? ` · currently ${participant.teamName}` : " · no team"}
            </p>
            <label className="font-mono text-xs">
              team
              <AppSelect
                value={teamId}
                onValueChange={setTeamId}
                options={activeTeams.map((team) => ({ value: team.id, label: team.name }))}
                variant="field"
                ariaLabel="Attendee team"
                className="mt-2"
              />
            </label>
            <button className="min-h-11 self-end border border-foreground px-4 font-mono text-xs hover:opacity-70">
              {participant.teamName ? "move attendee" : "assign attendee"}
            </button>
          </form>
        ) : null}
      </details>
    </section>
  );
}
