import { CameraFeed } from "@/features/tickets/ui/CameraFeed";
import { searchStaffParticipantsFn } from "../staff-scoring.functions";
import type { PageData, Participant, StaffScoringController } from "./useStaffScoringController";

export function StaffParticipantLookup({
  data,
  token,
  controller,
}: {
  data: PageData;
  token: string;
  controller: StaffScoringController;
}) {
  const {
    query,
    setQuery,
    results,
    setResults,
    participant,
    setParticipant,
    recipientScope,
    setRecipientScope,
    setScanned,
    setReviewReady,
    setNeedsConfirmation,
    cameraOpen,
    setCameraOpen,
    busy,
    findParticipant,
    resolveScan,
  } = controller;

  async function selectRecent(entry: Participant) {
    setParticipant(entry);
    setRecipientScope("participant");
    setResults([]);
    setScanned("");
    setQuery("");
    setReviewReady(false);
    try {
      const matches = await searchStaffParticipantsFn({
        data: {
          eventSlug: data.eventSlug,
          token,
          term: entry.ticketSuffix ?? entry.displayName ?? entry.publicAlias,
        },
      });
      const fresh = matches.find((match) => match.id === entry.id);
      if (fresh) setParticipant(fresh);
    } catch {
      // The recent record is already complete enough to keep the night moving.
    }
  }

  if (participant) {
    return (
      <section aria-label={participant.displayName ?? participant.publicAlias}>
        <div className="flex items-start justify-between gap-4 border-y theme-border py-4">
          <div className="min-w-0">
            <p className="font-serif text-xl">
              {participant.displayName ?? participant.publicAlias}
            </p>
            <p className="mt-1 font-mono text-micro theme-muted">
              {participant.balance} points · ticket {participant.ticketSuffix ?? "selected"}
              {participant.teamName ? ` · ${participant.teamName}` : ""}
              {participant.orderSize > 1
                ? ` · ${participant.orderPoints} across ${participant.orderSize} tickets`
                : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setParticipant(null);
              setScanned("");
              setReviewReady(false);
              setNeedsConfirmation(false);
            }}
            className="mh-action mh-action--quiet shrink-0"
          >
            change
          </button>
        </div>
        {participant.orderSize > 1 ? (
          <fieldset className="mt-4">
            <legend className="font-mono text-xs">give points to</legend>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <button
                type="button"
                aria-pressed={recipientScope === "participant"}
                onClick={() => setRecipientScope("participant")}
                className={`mh-action ${recipientScope === "participant" ? "mh-action--primary" : "mh-action--secondary"}`}
              >
                this ticket
              </button>
              <button
                type="button"
                aria-pressed={recipientScope === "order"}
                onClick={() => setRecipientScope("order")}
                className={`mh-action ${recipientScope === "order" ? "mh-action--primary" : "mh-action--secondary"}`}
              >
                all {participant.orderSize}
              </button>
            </div>
          </fieldset>
        ) : null}
      </section>
    );
  }

  return (
    <section aria-labelledby="participant-lookup-heading">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h3 id="participant-lookup-heading" className="font-serif text-xl">
            Find the person
          </h3>
          <p className="mt-1 font-mono text-xs theme-muted">
            Name, alias, ticket code, or QR—all in one place.
          </p>
        </div>
      </div>
      {data.recentParticipants.length > 0 ? (
        <div className="mt-3 flex gap-2 overflow-x-auto pb-1" aria-label="Recent people">
          {data.recentParticipants.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => void selectRecent(entry)}
              className="min-h-11 shrink-0 border theme-border px-3 text-left hover:opacity-70"
            >
              <span className="block font-serif">{entry.displayName ?? entry.publicAlias}</span>
              <span className="font-mono text-micro theme-muted">recent {entry.recentReason}</span>
            </button>
          ))}
        </div>
      ) : null}
      <form
        className="mt-3"
        onSubmit={(event) => {
          event.preventDefault();
          void findParticipant();
        }}
      >
        <label htmlFor="staff-person-lookup" className="sr-only">
          Find by name, alias, or ticket
        </label>
        <div className="flex min-h-12 items-stretch border theme-border focus-within:border-foreground">
          <input
            id="staff-person-lookup"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="name, alias, or ticket"
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent px-3 font-mono text-xs outline-none"
          />
          <button
            type="submit"
            disabled={busy}
            className="min-w-14 border-l theme-border px-3 font-mono text-xs disabled:opacity-50"
          >
            find
          </button>
          <button
            type="button"
            aria-label={cameraOpen ? "Close ticket camera" : "Scan ticket with camera"}
            title={cameraOpen ? "Close camera" : "Scan ticket QR"}
            onClick={() => setCameraOpen((current) => !current)}
            className="grid min-w-11 place-items-center border-l theme-border hover:opacity-70"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M4 7.5h3l1.2-2h7.6l1.2 2h3v11H4z" />
              <circle cx="12" cy="13" r="3.25" />
            </svg>
          </button>
        </div>
      </form>
      {cameraOpen ? (
        <div className="mt-3 max-w-sm">
          <CameraFeed
            paused={busy}
            onCode={(raw) => {
              setQuery(raw);
              void resolveScan(raw);
            }}
          />
        </div>
      ) : null}
      {results.length > 0 ? (
        <ul className="mt-3 divide-y theme-border border-y theme-border">
          {results.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                onClick={() => {
                  setParticipant(entry);
                  setRecipientScope("participant");
                  setResults([]);
                  setScanned("");
                  setQuery("");
                  setReviewReady(false);
                  setNeedsConfirmation(false);
                }}
                className="flex min-h-14 w-full items-center justify-between gap-3 py-2 text-left hover:opacity-70"
              >
                <span className="font-serif">{entry.displayName ?? entry.publicAlias}</span>
                <span className="text-right font-mono text-micro theme-muted">
                  {entry.balance} points
                  {entry.ticketSuffix ? ` · ${entry.ticketSuffix}` : ""}
                  {entry.orderSize > 1 ? ` · ${entry.orderSize} tickets` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
