"use client";

import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";

import { AppImage } from "@/components/AppImage";
import { CONTACT_EMAIL, SITE_BRAND } from "@/lib/shared/config";
import { useQrCode } from "@/hooks/useQrCode";
import { ticketIcsPath } from "@/features/events/routes";
import { AddressLink } from "@/features/events/ui/AddressLink";
import { ThreeWordHint } from "@/features/events/ui/ThreeWordHint";
import {
  formatEventDate,
  formatEventTime,
  type EventAlbumView,
  type TicketHolderEvent,
} from "@/features/events/types";
import { describeCheckpoints, type OrderTicketView, type TicketPageTicket } from "../types";
import { RefundTicketButton } from "./RefundTicketButton";
import { ShareTicketButton } from "./ShareTicketButton";
import { AttendeeSessionControls } from "./AttendeeSessionControls";
import { ScoreNotificationNotice } from "./ScoreNotificationNotice";
import { ScoreSyncStatus } from "./ScoreSyncStatus";

/**
 * The ticket itself.
 *
 * Designed to be opened at a door, one-handed, possibly on a cracked screen
 * with no signal: the QR is the largest thing on the page, the holder's name
 * is directly under it, and the address is right there without scrolling
 * into prose.
 */
const LINK_CLASS = "font-mono text-xs underline hover:opacity-70 transition-opacity";

export function TicketPage({
  ticket,
  event,
  qrPayload,
  orderTickets,
  orderSize,
  orderPosition,
  canManageOrder,
  managerTicketId,
  checkpointNames,
  album,
  score,
}: {
  ticket: TicketPageTicket;
  event: TicketHolderEvent;
  qrPayload: string;
  orderTickets: OrderTicketView[];
  orderSize: number;
  orderPosition: number;
  canManageOrder: boolean;
  managerTicketId?: string;
  checkpointNames: string[];
  album: EventAlbumView;
  score?: {
    participantId: string;
    points: number;
    revision: number;
    rank: number;
    teamRank?: number;
    synchronizedAt: string;
    orderPoints?: number;
    transactions: Array<{
      status: string;
      reasonCode: string;
      points: number;
      createdAt: string;
    }>;
  };
}) {
  const { dataUrl: qr, failed } = useQrCode(qrPayload, 512);
  const redeemed = Boolean(ticket.redeemedAt);
  const invalid = ticket.status !== "valid";
  // Self-serve refunds close when doors open; after that it is a conversation.
  const doorsOpen = Date.now() >= Date.parse(event.doorsAt ?? event.startsAt);
  const anyOrderTicketRedeemed = orderTickets.some((entry) => Boolean(entry.redeemedAt));
  const anyOrderTicketInvalid = orderTickets.some((entry) => entry.status !== "valid");
  const orderAmountMinor = orderTickets.reduce(
    (sum, entry) => sum + (entry.amountPaidMinor ?? 0),
    0,
  );
  const orderCurrency = orderTickets.find((entry) => entry.currency)?.currency;
  const checkpoints = describeCheckpoints(checkpointNames);
  // The purchaser ticket is the order's credential — see `resolveTicketOrderAccess`.
  // Whoever holds this id gets every sibling QR and the refund button, so it is
  // the one ticket in the order that must not have a "share" next to it.
  const isManagerTicket = ticket.id === managerTicketId;
  const [pendingDiscovery, setPendingDiscovery] = useState<string | null>(null);

  useEffect(() => {
    const pending = sessionStorage.getItem("mah-pending-discovery");
    if (pending) setPendingDiscovery(pending);
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <main id="main" className="max-w-md mx-auto px-6 pt-10 pb-16">
        <Link
          to="/events/$slug"
          params={{ slug: event.slug }}
          className="font-mono text-micro theme-muted tracking-wide hover:text-foreground transition-colors"
        >
          ← {event.title}
        </Link>

        {orderSize > 1 && canManageOrder && (
          <nav aria-label="Tickets in this order" className="mt-6 border-y theme-border py-3">
            <p className="font-mono text-micro theme-muted">
              {orderSize} tickets in this order · choose a QR, or send each guest their own
            </p>
            {/* A list rather than the old pill row, because every guest needs a
                share control beside their name and a button cannot live inside a
                link. Tapping the name still switches which QR this page shows —
                that stays the fast path; "send" is for handing over the link.

                The action column is a fixed width so the pills all end on the
                same edge: sizing it to its contents made every row a different
                length, since "send", "yours" and nothing are three widths. */}
            <ul className="mt-2 space-y-1">
              {orderTickets.map((entry, index) => {
                const current = entry.id === ticket.id;
                const entryStatus =
                  entry.status === "refunded"
                    ? "refunded"
                    : entry.status !== "valid"
                      ? "void"
                      : entry.redeemedAt
                        ? `in ${formatEventTime(entry.redeemedAt, event.timezone)}`
                        : null;
                return (
                  <li key={entry.id} className="grid grid-cols-[1fr_2.5rem] items-center gap-2">
                    <Link
                      to="/ticket/$id"
                      params={{ id: entry.id }}
                      aria-current={current ? "page" : undefined}
                      className={`flex min-w-0 items-baseline gap-2 rounded-lg border px-3 py-2 font-mono text-micro transition-opacity hover:opacity-70 ${
                        current
                          ? "border-foreground bg-foreground text-background"
                          : "theme-border-strong text-foreground"
                      }`}
                    >
                      <span className="truncate">
                        {index + 1} · {entry.holderName}
                      </span>
                      {entryStatus && (
                        <span className="ml-auto shrink-0 opacity-60">{entryStatus}</span>
                      )}
                    </Link>
                    <span className="text-right">
                      {entry.id === managerTicketId ? (
                        <span className="font-mono text-micro theme-faint">yours</span>
                      ) : entry.status === "valid" ? (
                        <ShareTicketButton
                          ticketId={entry.id}
                          holderName={entry.holderName}
                          eventTitle={event.title}
                          label="send"
                        />
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 font-mono text-micro theme-faint leading-relaxed">
              Send each guest their own link. Keep yours — it&apos;s the only one that can refund
              the order.
            </p>
          </nav>
        )}

        {orderSize > 1 && !canManageOrder && (
          <p className="mt-6 border-y theme-border py-3 font-mono text-micro theme-muted">
            ticket {orderPosition} of {orderSize} in this order · this link opens only this ticket
          </p>
        )}

        {invalid && (
          <p className="mt-6 px-4 py-3 border theme-border-strong rounded-lg font-mono text-xs text-foreground">
            This ticket is no longer valid
            {ticket.status === "refunded" ? " — it was refunded." : "."}
          </p>
        )}

        {/* Quiet, and never over the QR: the door is done with this code but a
            checkpoint is not, so this has to inform without reading as spent. */}
        {redeemed && !invalid && (
          <p className="mt-6 px-4 py-3 border theme-border rounded-lg font-mono text-xs theme-subtle">
            Scanned in
            {ticket.redeemedAt
              ? ` at ${formatEventTime(ticket.redeemedAt, event.timezone)}`
              : ""} —
            you&apos;re through.{" "}
            {checkpoints
              ? `Keep this open: ${checkpoints} scan the same code.`
              : "This code still works if anyone needs to check it again."}
          </p>
        )}

        {/* The QR — deliberately the largest element on the page. */}
        <div className="mt-8 flex items-center justify-center">
          <div
            className={`w-full aspect-square max-w-xs rounded-xl bg-white p-4 ${
              invalid ? "opacity-30" : ""
            }`}
          >
            {qr ? (
              <AppImage
                src={qr}
                alt="Your ticket QR code. Show this at the door."
                width={512}
                height={512}
                className="w-full h-full"
              />
            ) : failed ? (
              <div className="w-full h-full flex items-center justify-center text-center">
                <p className="font-mono text-xs text-stone-600 px-4">
                  Couldn&apos;t draw the code. Show the reference below to staff.
                </p>
              </div>
            ) : (
              <div className="w-full h-full" aria-hidden="true" />
            )}
          </div>
        </div>

        <div className="mt-6 text-center">
          <p className="font-serif text-xl text-foreground">{ticket.holderName}</p>
          {/* Only the kinds that tell the holder something. A paid ticket
              being paid is the unremarkable case, and labelling it invites
              the reader to wonder what it would mean if it were missing. */}
          {ticket.kind !== "paid" && (
            <p className="mt-1 font-mono text-micro theme-muted tracking-widest uppercase">
              {ticket.kind === "comp" ? "complimentary" : "free entry"}
            </p>
          )}
          {/* Readable fallback if the camera or the screen refuses to cooperate. */}
          <p className="mt-3 font-mono text-sm theme-subtle tracking-[0.2em]">{ticket.id}</p>
          <p className="mt-2 font-mono text-micro theme-muted">this QR is your entry ticket</p>
        </div>

        <dl className="mt-8 divide-y theme-border border-y theme-border py-2">
          <div className="flex gap-4 py-2">
            <dt className="shrink-0 w-16 font-mono text-micro theme-muted tracking-widest uppercase pt-0.5">
              When
            </dt>
            <dd className="font-serif text-sm text-foreground leading-relaxed">
              {formatEventDate(event.startsAt, event.timezone)}
              <br />
              <span className="theme-subtle">
                {event.doorsAt ? `Doors ${formatEventTime(event.doorsAt, event.timezone)}` : ""}
                {event.lastEntryAt
                  ? ` · last entry ${formatEventTime(event.lastEntryAt, event.timezone)}`
                  : ""}
              </span>
            </dd>
          </div>

          <div className="flex gap-4 py-2">
            <dt className="shrink-0 w-16 font-mono text-micro theme-muted tracking-widest uppercase pt-0.5">
              Where
            </dt>
            <dd className="font-serif text-sm text-foreground leading-relaxed">
              {event.venueName && <span className="block">{event.venueName}</span>}
              <AddressLink
                address={event.address}
                venueName={event.venueName}
                className="theme-subtle"
              />
              {event.doorCode && (
                <span className="block font-mono text-xs mt-1">
                  venue door code <strong>{event.doorCode}</strong>
                </span>
              )}
              {event.threeWordHint && <ThreeWordHint hint={event.threeWordHint} />}
              {event.mapUrl && (
                <a
                  href={event.mapUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-block mt-2 font-mono text-xs underline hover:opacity-70 transition-opacity"
                >
                  open in maps ↗
                </a>
              )}
            </dd>
          </div>

          {/* The reason to open this page again after the night. */}
          <div className="flex gap-4 py-2">
            <dt className="shrink-0 w-16 font-mono text-micro theme-muted tracking-widest uppercase pt-0.5">
              Photos
            </dt>
            <dd className="font-serif text-sm text-foreground leading-relaxed">
              {album.state === "pending" && (
                <span className="block theme-subtle">The shared album opens on the night.</span>
              )}

              {album.state === "open" && (
                <>
                  <span className="block">
                    {album.fileCount > 0
                      ? `${album.fileCount} ${album.fileCount === 1 ? "photo" : "photos"} so far`
                      : "Nothing in it yet"}
                  </span>
                  <span className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                    {album.uploadPath && (
                      <a href={album.uploadPath} className={LINK_CLASS}>
                        add yours
                      </a>
                    )}
                    {album.albumPath && (
                      <a href={album.albumPath} className={LINK_CLASS}>
                        see the album
                      </a>
                    )}
                  </span>
                </>
              )}

              {album.state === "closed" &&
                (album.albumPath ? (
                  <>
                    <span className="block theme-subtle">Uploads have closed.</span>
                    <a href={album.albumPath} className={`inline-block mt-2 ${LINK_CLASS}`}>
                      see the album
                    </a>
                  </>
                ) : (
                  <span className="block theme-subtle">The album has expired.</span>
                ))}

              {/* An album is a transfer: saying when it goes is not a detail. */}
              {album.albumPath && album.expiresAt && (
                <span className="block font-mono text-micro theme-muted mt-2">
                  saved until {formatEventDate(album.expiresAt, event.timezone)}
                </span>
              )}
            </dd>
          </div>
        </dl>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-5">
          <a
            href={ticketIcsPath(ticket.id)}
            className="font-mono text-xs theme-muted hover:text-foreground transition-colors underline"
          >
            add to calendar
          </a>
          {!isManagerTicket && (
            <ShareTicketButton
              ticketId={ticket.id}
              holderName={ticket.holderName}
              eventTitle={event.title}
              className="text-xs"
              label="share this ticket"
            />
          )}
        </div>

        {score && (
          <section
            aria-labelledby="ticket-score-heading"
            className="mt-8 border-y theme-border py-4"
          >
            <div className="flex items-baseline justify-between gap-4">
              <h2
                id="ticket-score-heading"
                className="font-mono text-micro theme-muted tracking-widest uppercase"
              >
                event score
              </h2>
              <a
                href={`/events/${encodeURIComponent(event.slug)}/score`}
                className="font-mono text-micro underline hover:opacity-70 transition-opacity"
              >
                leaderboard
              </a>
            </div>
            <p className="mt-2 font-serif text-2xl text-foreground">{score.points} points</p>
            <ScoreNotificationNotice ticketId={ticket.id} />
            <p className="mt-1 font-mono text-micro theme-subtle">rank {score.rank}</p>
            {score.teamRank !== undefined && (
              <p className="mt-1 font-mono text-micro theme-subtle">
                rank {score.teamRank} within your team
              </p>
            )}
            {score.orderPoints !== undefined && orderSize > 1 && (
              <p className="mt-2 font-mono text-xs theme-subtle">
                managed order total: {score.orderPoints} points
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-4">
              <a
                href={`/events/${encodeURIComponent(event.slug)}/discoveries`}
                className="font-mono text-xs underline hover:opacity-70"
              >
                scan a clue
              </a>
              <a
                href={`/events/${encodeURIComponent(event.slug)}/discoveries`}
                className="font-mono text-xs underline hover:opacity-70"
              >
                enter a code
              </a>
              {pendingDiscovery && (
                <a
                  href={pendingDiscovery}
                  onClick={() => sessionStorage.removeItem("mah-pending-discovery")}
                  className="font-mono text-xs underline hover:opacity-70"
                >
                  return to pending clue
                </a>
              )}
            </div>
            <p className="mt-4 font-mono text-micro theme-muted">
              <ScoreSyncStatus
                snapshot={{
                  eventSlug: event.slug,
                  participantId: score.participantId,
                  balance: score.points,
                  revision: score.revision,
                  synchronizedAt: score.synchronizedAt,
                }}
              />{" "}
              · last synchronized {formatEventTime(score.synchronizedAt, event.timezone)}
            </p>
            {score.transactions.length > 0 && (
              <details className="mt-4">
                <summary className="min-h-11 cursor-pointer py-3 font-mono text-xs underline">
                  score history
                </summary>
                <ol className="divide-y theme-border border-y theme-border">
                  {score.transactions.map((transaction, index) => (
                    <li
                      key={`${transaction.createdAt}-${index}`}
                      className="flex items-baseline justify-between gap-4 py-3"
                    >
                      <span className="font-mono text-xs">
                        {transaction.reasonCode.replaceAll("-", " ")}
                        {transaction.status === "held" ? " · pending review" : ""}
                        {transaction.status === "reversed" ? " · reversed" : ""}
                      </span>
                      <span className="font-mono text-xs">
                        {transaction.points > 0 ? "+" : ""}
                        {transaction.points}
                      </span>
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </section>
        )}

        {score && <AttendeeSessionControls ticketId={ticket.id} />}

        {/* A way to reach a human, on the page they will actually have open.
            Step-free access, a name that needs changing, a QR the door cannot
            read — all of it is a message to us, and none of it should require
            finding the contact page from a phone in a queue. The subject line
            carries the ticket reference so the reply does not start with
            "which ticket?". */}
        <p className="mt-6 text-center font-mono text-micro theme-muted leading-relaxed">
          Trouble getting in, or need access help?{" "}
          <a
            href={`mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
              `${event.title} — ticket ${ticket.id}`,
            )}`}
            className="underline hover:text-foreground transition-colors"
          >
            {CONTACT_EMAIL}
          </a>
        </p>

        {ticket.kind === "paid" && canManageOrder && managerTicketId && (
          <div className="mt-8 border-t theme-border pt-6">
            <RefundTicketButton
              ticketId={managerTicketId}
              ticketCount={orderSize}
              amountMinor={orderAmountMinor || ticket.amountPaidMinor}
              currency={orderCurrency ?? ticket.currency}
              disabledReason={
                anyOrderTicketInvalid
                  ? orderSize === 1
                    ? "This ticket has been refunded."
                    : "This order has already been partly or fully refunded. Message us if something's wrong."
                  : anyOrderTicketRedeemed
                    ? "Someone on this order is already checked in. Message us and we'll review it with the door record."
                    : doorsOpen
                      ? "Doors are open, so refunds are no longer self-serve. Message us."
                      : undefined
              }
            />
          </div>
        )}

        <p className="mt-10 text-center font-mono text-micro theme-faint tracking-wide">
          {SITE_BRAND.toLowerCase()}
        </p>
      </main>
    </div>
  );
}
