import { useEffect, useState, type FormEvent } from "react";

import { AppSelect } from "@/components/AppSelect";
import type { AdminScoringTeam, ScoringAction } from "./event-scoring-types";
import { AdminStatus, adminToneForStatus } from "./AdminStatus";

type Participant = {
  id: string;
  displayName?: string;
  publicAlias: string;
  balance: number;
  teamName?: string;
};

export function ScoringTeamsPanel({
  eventSlug,
  teams,
  authFetch,
  onAction,
}: {
  eventSlug: string;
  teams: AdminScoringTeam[];
  authFetch: (url: string, options?: RequestInit) => Promise<Response>;
  onAction: ScoringAction;
}) {
  const activeTeams = teams.filter((team) => team.status === "active");
  const [name, setName] = useState("");
  const [term, setTerm] = useState("");
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [participant, setParticipant] = useState<Participant | null>(null);
  const [teamId, setTeamId] = useState(activeTeams[0]?.id ?? "");
  const [searchMessage, setSearchMessage] = useState("");

  useEffect(() => {
    const selectable = teams.filter((team) => team.status === "active");
    if (!selectable.some((team) => team.id === teamId)) setTeamId(selectable[0]?.id ?? "");
  }, [teamId, teams]);

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
    const result = await onAction({
      action: "assign-team",
      participantId: participant.id,
      teamId,
    });
    if (result) {
      setParticipant(null);
      setParticipants([]);
      setTerm("");
    }
  }

  return (
    <section aria-labelledby="scoring-teams-heading" className="border-t theme-border pt-6">
      <h4 id="scoring-teams-heading" className="font-serif text-xl">
        Attendee teams
      </h4>
      <p className="mt-2 font-mono text-xs leading-relaxed theme-muted">
        Create event teams, then search for an attendee to place or move them. A move takes effect
        now; points already recorded keep their original team attribution.
      </p>

      <form onSubmit={(event) => void create(event)} className="mt-4 flex gap-2">
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
          create team
        </button>
      </form>

      {teams.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-2 border-y theme-border py-3 font-mono text-xs">
          {teams.map((team) => (
            <li key={team.id} className="flex items-center gap-2">
              <span>{team.name}</span>
              <AdminStatus tone={adminToneForStatus(team.status)} className="text-micro">
                {team.status}
              </AdminStatus>
            </li>
          ))}
        </ul>
      )}

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
      {searchMessage && (
        <p role="status" className="mt-3 font-mono text-xs theme-muted">
          {searchMessage}
        </p>
      )}
      {participants.length > 0 && (
        <ul className="mt-2 divide-y theme-border border-y theme-border">
          {participants.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                onClick={() => {
                  setParticipant(entry);
                  setParticipants([]);
                }}
                className="flex min-h-11 w-full flex-wrap items-center justify-between gap-2 py-2 text-left hover:opacity-70"
              >
                <span className="font-serif">{entry.displayName ?? entry.publicAlias}</span>
                <span className="font-mono text-micro theme-muted">
                  {entry.teamName ? `${entry.teamName} · ` : ""}
                  {entry.balance} points
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {participant && activeTeams.length > 0 && (
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
      )}
      {participant && activeTeams.length === 0 && (
        <p role="status" className="mt-4 font-mono text-xs theme-muted">
          Create an active team before assigning this attendee.
        </p>
      )}
    </section>
  );
}
