import { useEffect, useMemo, useState } from "react";

import { StatusNotice } from "@/components/StatusNotice";
import { AppSelect } from "@/components/AppSelect";
import {
  getStaffOperationsPageFn,
  moveStaffTeamParticipantFn,
  shuffleStaffTeamsFn,
} from "../staff-operations.functions";
import { TeamBadge } from "./TeamBadge";
import type { StaffOperationsData } from "./useStaffOperationsController";

type TeamState = Pick<StaffOperationsData, "teams" | "teamRoster">;

function initialTeamCount(teams: StaffOperationsData["teams"]): 2 | 3 | 4 {
  const count = teams.filter((team) => team.status === "active").length;
  return count === 3 || count === 4 ? count : 2;
}

export function StaffTeamsPanel({ data, token }: { data: StaffOperationsData; token: string }) {
  const [state, setState] = useState<TeamState>({ teams: data.teams, teamRoster: data.teamRoster });
  const [teamCount, setTeamCount] = useState<2 | 3 | 4>(() => initialTeamCount(data.teams));
  const [selectedParticipantId, setSelectedParticipantId] = useState("");
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setState({ teams: data.teams, teamRoster: data.teamRoster });
    setTeamCount(initialTeamCount(data.teams));
  }, [data.teamRoster, data.teams]);

  useEffect(() => {
    let current = true;
    void getStaffOperationsPageFn({ data: { eventSlug: data.eventSlug, token } })
      .then((page) => {
        if (!current || !page.found) return;
        setState({ teams: page.teams, teamRoster: page.teamRoster });
        setTeamCount(initialTeamCount(page.teams));
      })
      .catch(() => {
        if (current) setError("Team totals could not be refreshed. Try again before shuffling.");
      });
    return () => {
      current = false;
    };
  }, [data.eventSlug, token]);

  const activeTeams = state.teams.filter((team) => team.status === "active");
  const selectedParticipant = state.teamRoster.find(
    (participant) => participant.id === selectedParticipantId,
  );
  const visibleRoster = useMemo(() => {
    const term = filter.trim().toLocaleLowerCase();
    if (!term) return state.teamRoster;
    return state.teamRoster.filter((participant) =>
      [
        participant.displayName,
        participant.publicAlias,
        participant.ticketSuffix,
        participant.teamName,
      ]
        .filter(Boolean)
        .some((value) => value!.toLocaleLowerCase().includes(term)),
    );
  }, [filter, state.teamRoster]);

  async function shuffle() {
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const result = await shuffleStaffTeamsFn({
        data: { eventSlug: data.eventSlug, token, teamCount },
      });
      if (!result.ok) return setError(result.error);
      setState(result.value);
      setSelectedParticipantId("");
      setSelectedTeamId("");
      setStatus(
        `${result.value.teamRoster.length} checked-in ${result.value.teamRoster.length === 1 ? "guest" : "guests"} balanced across ${teamCount} teams.`,
      );
    } catch {
      setError("Teams could not be shuffled. Check the connection and try once more.");
    } finally {
      setBusy(false);
    }
  }

  async function move() {
    if (!selectedParticipantId || !selectedTeamId) {
      setError("Choose a checked-in guest and their new team.");
      return;
    }
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const result = await moveStaffTeamParticipantFn({
        data: {
          eventSlug: data.eventSlug,
          token,
          participantId: selectedParticipantId,
          teamId: selectedTeamId,
        },
      });
      if (!result.ok) return setError(result.error);
      const destination = result.value.teams.find((team) => team.id === selectedTeamId);
      setState(result.value);
      setSelectedParticipantId("");
      setSelectedTeamId("");
      setStatus(
        `${selectedParticipant?.displayName ?? selectedParticipant?.publicAlias ?? "Guest"} moved to ${destination?.name ?? "the selected team"}.`,
      );
    } catch {
      setError("That guest could not be moved. Check the connection and try once more.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="staff-teams-heading" className="mt-10 border-t theme-border pt-7">
      <p className="font-mono text-micro uppercase tracking-widest theme-muted">
        checked-in guests
      </p>
      <h2 id="staff-teams-heading" className="mt-2 font-serif text-2xl">
        Balance the teams
      </h2>
      <p className="mt-2 max-w-xl font-mono text-xs leading-5 theme-muted">
        Pick the number of teams, then shuffle. Everyone currently checked in is spread as evenly as
        possible; later arrivals join the smallest team automatically.
      </p>

      <div className="mt-6 grid grid-cols-3 gap-2" aria-label="Number of teams">
        {([2, 3, 4] as const).map((count) => (
          <button
            key={count}
            type="button"
            disabled={busy}
            aria-pressed={teamCount === count}
            onClick={() => setTeamCount(count)}
            className={`min-h-14 border px-3 font-mono text-sm hover:opacity-70 disabled:opacity-50 ${
              teamCount === count ? "border-foreground" : "theme-border"
            }`}
          >
            {count} teams
          </button>
        ))}
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => void shuffle()}
        className="mt-3 min-h-14 w-full border border-foreground px-5 font-mono text-sm hover:opacity-70 disabled:opacity-50"
      >
        {busy ? "balancing…" : `shuffle ${state.teamRoster.length} checked-in guests`}
      </button>

      {activeTeams.length > 0 ? (
        <div className="mt-6 grid gap-2 sm:grid-cols-2" aria-label="Current team sizes">
          {activeTeams.map((team) => (
            <div
              key={team.id}
              className="flex min-h-11 items-center justify-between border-b theme-border py-2"
            >
              <TeamBadge name={team.name} colourKey={team.colourKey} />
              <span className="font-mono text-xs theme-muted">
                {team.checkedInCount} {team.checkedInCount === 1 ? "person" : "people"}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {error ? (
        <StatusNotice tone="danger" label="Teams not changed" className="mt-5">
          {error}
        </StatusNotice>
      ) : null}
      {status ? (
        <StatusNotice tone="positive" label="Teams ready" className="mt-5">
          {status}
        </StatusNotice>
      ) : null}

      {activeTeams.length > 0 && state.teamRoster.length > 0 ? (
        <details className="mt-8 border-t theme-border pt-5">
          <summary className="min-h-11 cursor-pointer font-mono text-xs leading-[2.75rem] hover:opacity-70">
            move one person
          </summary>
          <div className="mt-3 space-y-4">
            <label className="block font-mono text-xs">
              <span className="mb-2 block theme-muted">Find a checked-in guest</span>
              <input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder="name, alias, or ticket ending"
                className="min-h-11 w-full border theme-border bg-transparent px-3"
              />
            </label>
            <div className="font-mono text-xs">
              <p className="mb-2 theme-muted">Guest</p>
              <AppSelect
                value={selectedParticipantId}
                onValueChange={(value) => {
                  setSelectedParticipantId(value);
                  setSelectedTeamId("");
                }}
                options={[
                  { value: "", label: "choose someone" },
                  ...visibleRoster.map((participant) => ({
                    value: participant.id,
                    label: `${participant.displayName ?? participant.publicAlias}${
                      participant.teamName ? ` — ${participant.teamName}` : " — unassigned"
                    }`,
                  })),
                ]}
                ariaLabel="Guest"
                variant="field"
              />
            </div>
            {selectedParticipant ? (
              <div>
                <p className="font-mono text-xs theme-muted">Move to</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {activeTeams
                    .filter((team) => team.id !== selectedParticipant.teamId)
                    .map((team) => (
                      <button
                        key={team.id}
                        type="button"
                        disabled={busy}
                        aria-pressed={selectedTeamId === team.id}
                        onClick={() => setSelectedTeamId(team.id)}
                        className={`min-h-12 border px-3 text-left hover:opacity-70 disabled:opacity-50 ${
                          selectedTeamId === team.id ? "border-foreground" : "theme-border"
                        }`}
                      >
                        <TeamBadge
                          name={team.name}
                          colourKey={team.colourKey}
                          detail={`${team.checkedInCount} now`}
                        />
                      </button>
                    ))}
                </div>
              </div>
            ) : null}
            <button
              type="button"
              disabled={busy || !selectedParticipantId || !selectedTeamId}
              onClick={() => void move()}
              className="min-h-12 w-full border border-foreground px-4 font-mono text-xs hover:opacity-70 disabled:opacity-40"
            >
              move guest
            </button>
          </div>
        </details>
      ) : null}
    </section>
  );
}
