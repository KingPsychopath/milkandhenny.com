import { useState } from "react";

import type { ScoringAction, ScoringData } from "./event-scoring-types";

export function ScoringIdentityPanel({
  merges,
  onAction,
}: {
  merges: ScoringData["merges"];
  onAction: ScoringAction;
}) {
  const [sourceParticipantId, setSource] = useState("");
  const [targetParticipantId, setTarget] = useState("");
  const [reason, setReason] = useState("");
  const [privacyPersonId, setPrivacyPersonId] = useState("");
  const [privacyReason, setPrivacyReason] = useState("");
  return (
    <section aria-labelledby="scoring-identity-heading" className="border-t theme-border pt-6">
      <h4 id="scoring-identity-heading" className="font-serif text-xl">
        Identity resolution
      </h4>
      <p className="mt-2 font-mono text-xs theme-muted">
        Use participant search above to compare possible duplicates. Names and browser details are
        never enough on their own.
      </p>
      <form
        className="mt-4 grid gap-4 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          void onAction({
            action: "merge-participants",
            sourceParticipantId,
            targetParticipantId,
            reason,
            evidence: ["admin-reviewed-ticket"],
          }).then((result) => {
            if (result) {
              setSource("");
              setTarget("");
              setReason("");
            }
          });
        }}
      >
        <label className="font-mono text-xs">
          source participant
          <input
            required
            value={sourceParticipantId}
            onChange={(event) => setSource(event.target.value)}
            className="mt-2 min-h-11 w-full border theme-border bg-transparent px-3"
          />
        </label>
        <label className="font-mono text-xs">
          target participant
          <input
            required
            value={targetParticipantId}
            onChange={(event) => setTarget(event.target.value)}
            className="mt-2 min-h-11 w-full border theme-border bg-transparent px-3"
          />
        </label>
        <label className="font-mono text-xs sm:col-span-2">
          review reason
          <input
            required
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="mt-2 min-h-11 w-full border theme-border bg-transparent px-3"
          />
        </label>
        <button className="min-h-11 border border-foreground px-4 font-mono text-xs hover:opacity-70">
          merge after review
        </button>
      </form>
      <ul className="mt-5 divide-y theme-border border-y theme-border">
        {merges.map((merge) => (
          <li key={merge.id} className="flex flex-wrap items-center gap-3 py-3 font-mono text-xs">
            <span className="min-w-0 flex-1">
              {merge.sourceParticipantId} into {merge.targetParticipantId} · {merge.reason}
            </span>
            <button
              type="button"
              onClick={() => {
                const reason = window.prompt("Why are you reversing this merge?");
                if (reason)
                  void onAction({ action: "split-participants", mergeId: merge.id, reason });
              }}
              className="min-h-11 px-2 underline hover:opacity-70"
            >
              reverse merge
            </button>
          </li>
        ))}
      </ul>
      <form
        className="mt-6 grid gap-4 border-t theme-border pt-5 sm:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (
            !window.confirm(
              "Remove this person's identifiers and names while keeping immutable event records?",
            )
          )
            return;
          void onAction({
            action: "pseudonymize-person",
            personId: privacyPersonId,
            reason: privacyReason,
          }).then((result) => {
            if (result) {
              setPrivacyPersonId("");
              setPrivacyReason("");
            }
          });
        }}
      >
        <div className="sm:col-span-2">
          <h5 className="font-serif text-lg">Privacy deletion</h5>
          <p className="mt-1 font-mono text-xs theme-muted">
            Remove names and verified identifiers. Ledger, admission, links, and audit rows remain
            valid.
          </p>
        </div>
        <label className="font-mono text-xs">
          person ID
          <input
            required
            value={privacyPersonId}
            onChange={(event) => setPrivacyPersonId(event.target.value)}
            className="mt-2 min-h-11 w-full border theme-border bg-transparent px-3"
          />
        </label>
        <label className="font-mono text-xs">
          reason
          <input
            required
            value={privacyReason}
            onChange={(event) => setPrivacyReason(event.target.value)}
            className="mt-2 min-h-11 w-full border theme-border bg-transparent px-3"
          />
        </label>
        <button className="min-h-11 border border-foreground px-4 font-mono text-xs hover:opacity-70">
          pseudonymize person
        </button>
      </form>
    </section>
  );
}
