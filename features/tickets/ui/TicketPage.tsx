"use client";

import { Link } from "@tanstack/react-router";

import { SITE_BRAND } from "@/lib/shared/config";
import { useQrCode } from "@/hooks/useQrCode";
import { ticketIcsPath } from "@/features/events/routes";
import {
  formatEventDate,
  formatEventTime,
  threeWordMapUrl,
  type EventAlbumView,
  type TicketHolderEvent,
} from "@/features/events/types";
import type { OrderTicketView, TicketPageTicket } from "../types";
import { RefundTicketButton } from "./RefundTicketButton";

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
  album,
}: {
  ticket: TicketPageTicket;
  event: TicketHolderEvent;
  qrPayload: string;
  orderTickets: OrderTicketView[];
  orderSize: number;
  orderPosition: number;
  canManageOrder: boolean;
  managerTicketId?: string;
  album: EventAlbumView;
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
  const threeWordUrl = threeWordMapUrl(event.threeWordHint);

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
              {orderSize} tickets in this order · choose a QR
            </p>
            <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
              {orderTickets.map((entry, index) => {
                const current = entry.id === ticket.id;
                return (
                  <Link
                    key={entry.id}
                    to="/ticket/$id"
                    params={{ id: entry.id }}
                    aria-current={current ? "page" : undefined}
                    className={`shrink-0 rounded-full border px-3 py-2 font-mono text-micro transition-opacity hover:opacity-70 ${
                      current
                        ? "border-foreground bg-foreground text-background"
                        : "theme-border-strong text-foreground"
                    }`}
                  >
                    {index + 1} · {entry.holderName}
                    {entry.redeemedAt ? " · in" : entry.status !== "valid" ? " · void" : ""}
                  </Link>
                );
              })}
            </div>
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

        {redeemed && !invalid && (
          <p className="mt-6 px-4 py-3 border theme-border rounded-lg font-mono text-xs theme-subtle">
            Already scanned in
            {ticket.redeemedAt ? ` at ${formatEventTime(ticket.redeemedAt, event.timezone)}` : ""}.
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
              <img
                src={qr}
                alt="Your ticket QR code. Show this at the door."
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
          <p className="mt-1 font-mono text-micro theme-muted tracking-widest uppercase">
            {ticket.kind === "comp"
              ? "complimentary"
              : ticket.kind === "free"
                ? "free entry"
                : "paid"}
          </p>
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
              {event.address && <span className="block theme-subtle">{event.address}</span>}
              {event.doorCode && (
                <span className="block font-mono text-xs mt-1">
                  venue door code <strong>{event.doorCode}</strong>
                </span>
              )}
              {event.threeWordHint &&
                (threeWordUrl ? (
                  <a
                    href={threeWordUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="block font-mono text-xs theme-muted mt-1 underline hover:opacity-70 transition-opacity"
                  >
                    {event.threeWordHint}
                  </a>
                ) : (
                  <span className="block font-mono text-xs theme-muted mt-1">
                    {event.threeWordHint}
                  </span>
                ))}
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

        <div className="mt-6 flex flex-wrap justify-center gap-5">
          <a
            href={ticketIcsPath(ticket.id)}
            className="font-mono text-xs theme-muted hover:text-foreground transition-colors underline"
          >
            add to calendar
          </a>
        </div>

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
