import { type FormEvent, useEffect, useMemo, useState } from "react";

import { AppSelect } from "@/components/AppSelect";
import { TicketIdentityControlsView } from "@/features/attendee-access/ui/TicketIdentityControls";
import { AttendeeOperationRow } from "@/features/attendee-access/ui/MyAccountPage";
import type { AttendeeTicketOperation } from "@/features/attendee-access/types";
import type { TicketHolderEvent } from "@/features/events/types";
import { TicketPage } from "@/features/tickets/ui/TicketPage";

const VARIANTS = [
  "single ticket",
  "multi-ticket purchaser",
  "unassigned group ticket",
  "claimed ticket",
  "already using another ticket",
  "pending incoming transfer",
  "pending outgoing transfer",
  "accepted transfer",
  "refunded / void",
  "checked in",
  "scoring off",
  "leaderboard off",
  "clues off",
  "refund consent pending",
  "offline score pending",
] as const;

type Variant = (typeof VARIANTS)[number];

const EVENT: TicketHolderEvent = {
  slug: "after-hours-preview",
  title: "After Hours",
  tagline: "Synthetic admin preview",
  status: "published",
  startsAt: "2027-10-16T19:00:00.000Z",
  endsAt: "2027-10-17T01:00:00.000Z",
  doorsAt: "2027-10-16T18:30:00.000Z",
  lastEntryAt: "2027-10-16T21:00:00.000Z",
  timezone: "Europe/London",
  area: "Peckham",
  venueName: "The Test Room",
  address: "1 Example Lane, London",
  doorCode: "1942",
  threeWordHint: "amber.ticket.preview",
  mapUrl: "https://maps.example.test",
  stepFreeAccess: true,
  lineup: [],
  ticketTypes: [],
  waitlistEnabled: false,
  transferable: true,
  createdAt: "2026-08-25T12:00:00.000Z",
  updatedAt: "2026-08-25T12:00:00.000Z",
  locationRevealed: true,
};

const OPERATION_VARIANTS = new Set<Variant>([
  "pending incoming transfer",
  "pending outgoing transfer",
  "accepted transfer",
  "refund consent pending",
]);

function operationFor(
  variant: Variant,
  status: string,
): {
  label: string;
  item: AttendeeTicketOperation;
  outgoing: boolean;
} {
  const label =
    variant === "pending incoming transfer"
      ? "incoming transfer"
      : variant === "pending outgoing transfer"
        ? "transfer sent"
        : variant === "refund consent pending"
          ? "ticket return"
          : "incoming transfer";
  return {
    label,
    outgoing: variant === "pending outgoing transfer" || variant === "refund consent pending",
    item: {
      id: `preview-${variant.replaceAll(" ", "-")}`,
      ticketId: "01J6PREVIEWTICKET1",
      eventSlug: EVENT.slug,
      eventTitle: EVENT.title,
      status,
      expiresAt: "2027-10-15T19:00:00.000Z",
    },
  };
}

export function AttendeePreviewMatrix() {
  const [variant, setVariant] = useState<Variant>("single ticket");
  const [mobile, setMobile] = useState(true);
  const [dark, setDark] = useState(false);
  const [showSend, setShowSend] = useState(false);
  const [recipientEmail, setRecipientEmail] = useState("");
  const [message, setMessage] = useState("");
  const [operationStatus, setOperationStatus] = useState("pending");
  const index = VARIANTS.indexOf(variant);

  useEffect(() => {
    setShowSend(false);
    setRecipientEmail("");
    setMessage("");
    setOperationStatus(variant === "accepted transfer" ? "accepted" : "pending");
  }, [variant]);

  const identityState = useMemo(() => {
    if (variant === "claimed ticket") {
      return { account: { name: "Avery Finch" }, personallyClaimed: true } as const;
    }
    if (variant === "already using another ticket") {
      return {
        account: { name: "Avery Finch" },
        personallyClaimed: false,
        anotherClaimedTicketName: "Morgan Finch",
      } as const;
    }
    if (variant === "unassigned group ticket") {
      return { account: { name: "Avery Finch" }, personallyClaimed: false } as const;
    }
    return { account: null, personallyClaimed: false } as const;
  }, [variant]);

  const move = (offset: number) => {
    const next = (index + offset + VARIANTS.length) % VARIANTS.length;
    setVariant(VARIANTS[next]!);
  };

  function previewSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(
      identityState.personallyClaimed
        ? "Transfer invitation sent. You keep the ticket until it is accepted."
        : "Assignment invitation sent. You can cancel it from You while it is pending.",
    );
    setRecipientEmail("");
    setShowSend(false);
  }

  const previewIdentityControls = (
    <TicketIdentityControlsView
      ticketId="01J6PREVIEWTICKET1"
      account={identityState.account}
      personallyClaimed={identityState.personallyClaimed}
      anotherClaimedTicketName={identityState.anotherClaimedTicketName}
      canManageOrder={variant === "multi-ticket purchaser" || variant === "unassigned group ticket"}
      busy={false}
      message={message}
      inAppBrowser={false}
      recipientEmail={recipientEmail}
      showSend={showSend}
      onClaim={() => setMessage("This ticket is now saved to You across devices.")}
      onRecipientEmailChange={setRecipientEmail}
      onSend={previewSend}
      onToggleSend={() => setShowSend((current) => !current)}
    />
  );

  const multiTicket = variant === "multi-ticket purchaser";
  const ticketStatus = variant === "refunded / void" ? "refunded" : "valid";
  const redeemedAt = variant === "checked in" ? "2027-10-16T19:42:00.000Z" : undefined;
  const scoringOff = variant === "scoring off";
  const score = scoringOff
    ? undefined
    : {
        participantId: "participant-preview",
        publicAlias: "amber fox",
        displayMode: "alias" as const,
        points: 120,
        revision: 4,
        rank: 7,
        teamRank: 2,
        synchronizedAt: "2027-10-16T20:15:00.000Z",
        orderPoints: multiTicket ? 280 : undefined,
        leaderboardAvailable: variant !== "leaderboard off",
        transactions:
          variant === "offline score pending"
            ? [
                {
                  status: "held",
                  reasonCode: "offline-award",
                  activityName: "Offline award",
                  sourceType: "staff-award",
                  points: 12,
                  createdAt: "2027-10-16T20:14:00.000Z",
                },
              ]
            : [],
      };

  return (
    <section aria-labelledby="attendee-preview-heading">
      <div className="border-b theme-border pb-5">
        <p className="font-mono text-micro uppercase tracking-widest theme-muted">production UI</p>
        <h3 id="attendee-preview-heading" className="mt-2 font-serif text-3xl">
          Attendee experience
        </h3>
        <p className="mt-2 max-w-2xl font-mono text-xs leading-relaxed theme-muted">
          This renders the same ticket and identity components attendees use. Only the data and
          actions are synthetic, so production UI changes appear here automatically.
        </p>
      </div>
      <div className="mt-5 flex flex-wrap items-end gap-3">
        <button type="button" onClick={() => move(-1)} className="mh-action mh-action--quiet">
          ← previous
        </button>
        <label className="font-mono text-xs">
          invariant
          <AppSelect
            value={variant}
            onValueChange={(value) => setVariant(value as Variant)}
            options={VARIANTS.map((item) => ({ value: item, label: item }))}
            ariaLabel="Preview invariant"
            className="ml-2"
          />
        </label>
        <button type="button" onClick={() => move(1)} className="mh-action mh-action--quiet">
          next →
        </button>
        <label className="ml-auto flex min-h-11 items-center gap-2 font-mono text-xs">
          <input
            type="checkbox"
            checked={mobile}
            onChange={(event) => setMobile(event.target.checked)}
          />
          phone width
        </label>
        <label className="flex min-h-11 items-center gap-2 font-mono text-xs">
          <input
            type="checkbox"
            checked={dark}
            onChange={(event) => setDark(event.target.checked)}
          />
          dark theme
        </label>
      </div>
      <p className="mt-3 font-mono text-micro theme-muted">
        {index + 1} of {VARIANTS.length} · synthetic records · no network mutations
      </p>
      <div
        className={`mt-5 overflow-auto border theme-border p-3 sm:p-5 ${dark ? "dark bg-background text-foreground" : "bg-background text-foreground"}`}
      >
        <div className={`${mobile ? "max-w-[26rem]" : "max-w-2xl"} mx-auto bg-background`}>
          {OPERATION_VARIANTS.has(variant) ? (
            <main className="min-h-[32rem] px-6 py-10">
              <p className="font-mono text-micro uppercase tracking-widest theme-muted">
                you · ticket actions
              </p>
              <h4 className="mt-2 font-serif text-3xl">Your ticket activity</h4>
              <ul className="mt-6 divide-y border-y theme-border">
                {(() => {
                  const operation = operationFor(variant, operationStatus);
                  return (
                    <AttendeeOperationRow
                      label={operation.label}
                      item={operation.item}
                      busy={false}
                      onResend={
                        operation.outgoing ? () => setMessage("Invitation resent.") : undefined
                      }
                      onCancel={
                        operation.outgoing ? () => setOperationStatus("cancelled") : undefined
                      }
                    />
                  );
                })()}
              </ul>
              {message ? (
                <p role="status" className="mt-4 font-mono text-xs theme-muted">
                  {message}
                </p>
              ) : null}
            </main>
          ) : (
            <TicketPage
              ticket={{
                id: "01J6PREVIEWTICKET1",
                publicId: "PREVIEW-TICKET-1",
                holderName: "Avery Finch",
                kind: "paid",
                status: ticketStatus,
                redeemedAt,
                amountPaidMinor: 2500,
                currency: "GBP",
              }}
              event={EVENT}
              qrPayload="milkandhenny:attendee-preview:01J6PREVIEWTICKET1"
              orderTickets={
                multiTicket
                  ? [
                      { id: "01J6PREVIEWTICKET1", holderName: "Avery Finch", status: "valid" },
                      { id: "01J6PREVIEWTICKET2", holderName: "Morgan Finch", status: "valid" },
                      { id: "01J6PREVIEWTICKET3", holderName: "Sam Finch", status: "valid" },
                    ]
                  : [{ id: "01J6PREVIEWTICKET1", holderName: "Avery Finch", status: ticketStatus }]
              }
              orderSize={multiTicket ? 3 : 1}
              orderPosition={1}
              canManageOrder={multiTicket || variant === "unassigned group ticket"}
              managerTicketId="01J6PREVIEWTICKET1"
              checkpointNames={["cloakroom", "welcome drink"]}
              album={{
                state: "open",
                albumPath: "/gallery",
                fileCount: 18,
                expiresAt: "2027-11-16T19:00:00.000Z",
              }}
              hasDiscoveries={variant !== "clues off"}
              score={score}
              preview
              embedded
              previewIdentityControls={previewIdentityControls}
            />
          )}
        </div>
      </div>
    </section>
  );
}
