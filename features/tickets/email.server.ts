import QRCode from "qrcode";

import { sendEmail, type EmailAttachment } from "@/lib/platform/email.server";
import { log } from "@/lib/platform/logger.server";
import { buildEventUrl, buildTicketIcsUrl, buildTicketUrl } from "@/features/events/routes";
import { buildEventIcs, buildTicketHolderIcsOptions } from "@/features/events/ics";
import { formatEventDateTime, formatMoney, threeWordMapUrl } from "@/features/events/types";
import type { EventRecord } from "@/features/events/types";
import { buildTicketQrPayload } from "./qr.server";
import type { TicketRecord } from "./types";
import { BASE_URL } from "@/lib/shared/config";
import { buildAppUrl } from "@/lib/shared/app-url";
import { escapeEmailHtml as escapeHtml, renderBrandedEmail } from "@/lib/shared/email-design";
import { renderCommunicationMessage } from "@/features/communications/email.server";

/**
 * Ticket delivery email.
 *
 * Text-first with the ticket link as the primary affordance. The QR is
 * embedded as an inline attachment rather than a remote image because remote
 * images are blocked by default in most clients — but the link is what
 * actually gets someone through the door if the image never renders.
 */

/**
 * How many QRs ride along in the email.
 *
 * A group arriving together at a flat with no signal cannot load three ticket
 * pages, and redemption is per person — so every guest needs their own code in
 * the one thing that works offline. Beyond a small group the email becomes a
 * scroll, and the links carry the rest.
 */
const MAX_EMAILED_QRS = 6;

type TicketQr = {
  ticketId: string;
  holderName: string;
  contentId: string;
  managesOrder: boolean;
};

async function renderQrAttachment(
  ticket: TicketRecord,
  index: number,
): Promise<{ attachment: EmailAttachment; qr: TicketQr } | null> {
  try {
    const dataUrl = await QRCode.toDataURL(buildTicketQrPayload(ticket.id), {
      margin: 1,
      width: 480,
    });
    const base64 = dataUrl.split(",")[1];
    if (!base64) return null;
    const contentId = `ticketqr${index}`;
    return {
      attachment: {
        content: base64,
        filename: `ticket-${index + 1}-qr.png`,
        type: "image/png",
        disposition: "inline",
        contentId,
      },
      qr: {
        ticketId: ticket.id,
        holderName: ticket.holderName,
        contentId,
        managesOrder: !ticket.parentTicketId,
      },
    };
  } catch (error) {
    log.error("tickets.email", "QR render failed; sending link-only", {}, error);
    return null;
  }
}

/**
 * The night, as a calendar entry.
 *
 * Attached rather than linked because an attachment needs no cookie, no
 * network and no second device: one tap in Mail or Gmail and the address,
 * door code and ticket link are in their calendar for good. The link in the
 * body is the fallback for clients that strip attachments.
 */
function renderCalendarAttachment(
  event: EventRecord,
  ticket: TicketRecord,
  origin: string,
): EmailAttachment | null {
  try {
    const ics = buildEventIcs(
      event,
      buildTicketHolderIcsOptions(event, {
        eventUrl: buildEventUrl(origin, event.slug),
        ticketUrl: buildTicketUrl(origin, ticket.id),
      }),
    );
    return {
      content: Buffer.from(ics, "utf8").toString("base64"),
      filename: `${event.slug}.ics`,
      type: "text/calendar",
      disposition: "attachment",
    };
  } catch (error) {
    log.error("tickets.email", "Calendar render failed; sending without it", {}, error);
    return null;
  }
}

function buildText(event: EventRecord, tickets: TicketRecord[], origin: string): string {
  const calendarUrl = buildTicketIcsUrl(origin, tickets[0].id);
  const when = formatEventDateTime(event.startsAt, event.timezone);
  const threeWordUrl = threeWordMapUrl(event.threeWordHint);
  const lines = [
    `You're in — ${event.title}`,
    "",
    when,
    event.doorsAt ? `Doors ${formatEventDateTime(event.doorsAt, event.timezone)}` : null,
    event.venueName ? event.venueName : null,
    event.address ? event.address : null,
    event.doorCode ? `Venue door code: ${event.doorCode}` : null,
    event.threeWordHint
      ? `Find it: ${event.threeWordHint}${threeWordUrl ? ` — ${threeWordUrl}` : ""}`
      : null,
    "",
    tickets.length === 1 ? "Your ticket:" : `Your ${tickets.length} tickets:`,
    ...tickets.map(
      (ticket) =>
        `  ${ticket.holderName} — ${buildTicketUrl(origin, ticket.id)}${tickets.length > 1 && !ticket.parentTicketId ? " (manages the full order)" : ""}`,
    ),
    tickets.length > 1 ? "Everyone scans their own code — one per person at the door." : null,
    tickets.length > 1
      ? "Share each guest's own link. A shared link opens only that ticket."
      : null,
    "",
    `Add to calendar: ${calendarUrl}`,
    "The .ics attached to this email does the same thing offline.",
    "",
    "Open the link at the door and we'll scan it. Screenshots work too.",
    event.lastEntryAt
      ? `Last entry ${formatEventDateTime(event.lastEntryAt, event.timezone)}.`
      : null,
    event.ageLimit ? `${event.ageLimit}.` : null,
    "",
    "Ticket terms:",
    event.terms ??
      "Tickets are for this named, dated event. Entry is subject to the event details and house rules.",
    event.refundPolicy ??
      "Self-serve refunds are available before doors open while nobody on the order has checked in. After that, contact us so the door record can be reviewed.",
    "",
    "— milk & henny",
  ];
  return lines.filter((line) => line !== null).join("\n");
}

function buildHtml(
  event: EventRecord,
  tickets: TicketRecord[],
  origin: string,
  qrs: TicketQr[],
): string {
  const when = escapeHtml(formatEventDateTime(event.startsAt, event.timezone));
  const calendarUrl = escapeHtml(buildTicketIcsUrl(origin, tickets[0].id));
  const threeWordUrl = threeWordMapUrl(event.threeWordHint);
  const detail = [
    event.doorsAt
      ? `Doors ${escapeHtml(formatEventDateTime(event.doorsAt, event.timezone))}`
      : null,
    event.venueName ? escapeHtml(event.venueName) : null,
    event.address ? escapeHtml(event.address) : null,
    event.doorCode ? `Venue door code: <strong>${escapeHtml(event.doorCode)}</strong>` : null,
    event.threeWordHint
      ? `Find it: ${
          threeWordUrl
            ? `<a href="${escapeHtml(threeWordUrl)}" style="color:#b45309">${escapeHtml(event.threeWordHint)}</a>`
            : escapeHtml(event.threeWordHint)
        }`
      : null,
  ].filter((line): line is string => line !== null);

  // Every guest is named exactly once, under their own code, and that name is
  // the way into their ticket — a second list of the same names underneath
  // taught nobody anything.
  const covered = new Set(qrs.map((qr) => qr.ticketId));
  const withoutQr = tickets.filter((ticket) => !covered.has(ticket.id));

  const ticketRows = withoutQr
    .map((ticket) => {
      const label =
        tickets.length > 1 && !ticket.parentTicketId ? "open ticket · manage order" : "open ticket";
      return `<p style="margin:0 0 8px"><a href="${escapeHtml(buildTicketUrl(origin, ticket.id))}" style="color:#b45309">${escapeHtml(ticket.holderName)} — ${label}</a></p>`;
    })
    .join("");

  // One QR per guest, because the door admits one person per scan and a group
  // standing in a doorway should not have to work out whose is whose.
  const qrBlocks = qrs
    .map((qr) => {
      const size = qrs.length > 1 ? 200 : 240;
      const ticketUrl = escapeHtml(buildTicketUrl(origin, qr.ticketId));
      const label =
        qrs.length > 1 && qr.managesOrder ? "open ticket · manage order" : "open ticket";
      return `<div style="margin:0 0 24px"><img src="cid:${qr.contentId}" width="${size}" height="${size}" alt="Ticket QR code for ${escapeHtml(qr.holderName)}" style="max-width:100%">
      <p style="margin:8px 0 0"><a href="${ticketUrl}" style="color:#b45309;font:14px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace">${escapeHtml(qr.holderName)} — ${label}</a></p></div>`;
    })
    .join("");

  const missingQrs = withoutQr.length;

  const calendarDetail = event.doorCode
    ? "address, venue door code and your ticket"
    : "address and your ticket";
  const ticketMascotUrl = escapeHtml(
    buildAppUrl(origin, "/media/email/mascots/ticket-confirmation.png", {
      search: { v: "2" },
    }),
  );
  const contentHtml = `${detail.length > 0 ? `<p style="margin:0 0 20px">${detail.join("<br>")}</p>` : ""}
    ${qrs.length > 0 ? `<div style="text-align:center;margin:24px 0">${qrBlocks}</div>` : ""}
    ${missingQrs > 0 ? `<p style="margin:0 0 12px;text-align:center;color:#78716c;font:13px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace">The other ${missingQrs} ${missingQrs === 1 ? "ticket is" : "tickets are"} on the links below.</p>` : ""}
    <div style="border-top:1px solid #e7e5e4;padding-top:16px">${ticketRows}
      <p style="margin:0"><a href="${calendarUrl}" style="color:#b45309">add to calendar</a>
      <span style="color:#78716c;font:13px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace">— ${calendarDetail}, saved to your phone</span></p>
    </div>
    <p style="margin:20px 0 0;color:#78716c;font:13px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace">
      Open the link at the door and we'll scan it. Screenshots work too.
      ${tickets.length > 1 ? "Share each guest's own link; it opens only that ticket." : ""}
      ${event.lastEntryAt ? `Last entry ${escapeHtml(formatEventDateTime(event.lastEntryAt, event.timezone))}.` : ""}
      ${event.ageLimit ? escapeHtml(event.ageLimit) + "." : ""}
    </p>
    <div style="border-top:1px solid #e7e5e4;margin-top:20px;padding-top:16px;color:#78716c;font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace">
      <strong style="color:#1c1917">Ticket terms</strong><br>
      ${escapeHtml(event.terms ?? "Tickets are for this named, dated event. Entry is subject to the event details and house rules.")}<br><br>
      ${escapeHtml(event.refundPolicy ?? "Self-serve refunds are available before doors open while nobody on the order has checked in. After that, contact us so the door record can be reviewed.")}
    </div>
    <p style="margin:24px 0 0"><img src="${ticketMascotUrl}" width="480" height="132" alt="A little pixel character celebrates your ticket" style="display:block;width:100%;height:auto;border:0"></p>`;
  return renderBrandedEmail({
    origin,
    label: tickets.length === 1 ? "your ticket" : `your ${tickets.length} tickets`,
    title: event.title,
    meta: when,
    contentHtml,
  });
}

export type TicketEmailResult = { queued: boolean; error?: string };

/**
 * Send one order's tickets.
 *
 * Returns rather than throws: a ticket that exists but was not queued is
 * recoverable through the resend flow, so queue failure must never fail
 * the issuance that already took someone's money.
 */
export async function sendTicketEmail(input: {
  event: EventRecord;
  tickets: TicketRecord[];
  origin: string;
  idempotencyKey: string;
}): Promise<TicketEmailResult> {
  const { event, tickets, origin } = input;
  const recipient = tickets.find((ticket) => ticket.email)?.email;
  if (!recipient) return { queued: false, error: "No email address on this order" };
  if (tickets.length === 0) return { queued: false, error: "No tickets to send" };

  const rendered = (
    await Promise.all(
      tickets.slice(0, MAX_EMAILED_QRS).map((ticket, index) => renderQrAttachment(ticket, index)),
    )
  ).filter((item): item is { attachment: EmailAttachment; qr: TicketQr } => item !== null);

  const qrs = rendered.map((item) => item.qr);
  const calendar = renderCalendarAttachment(event, tickets[0], origin);
  const attachments = [...rendered.map((item) => item.attachment), calendar].filter(
    (item): item is EmailAttachment => item !== null,
  );

  const result = await sendEmail(
    {
      channel: "tickets",
      to: recipient,
      subject: `You're in — ${event.title}`,
      text: buildText(event, tickets, origin),
      html: buildHtml(event, tickets, origin, qrs),
      attachments: attachments.length > 0 ? attachments : undefined,
    },
    { idempotencyKey: input.idempotencyKey },
  );

  if (!result.ok) {
    log.error("tickets.email", "Ticket email failed", {
      slug: event.slug,
      count: tickets.length,
      status: result.status,
    });
    return { queued: false, error: result.error };
  }

  log.info("tickets.email", "Ticket email queued", { slug: event.slug, count: tickets.length });
  return { queued: true };
}

export type RenderedEmail = { subject: string; text: string; html: string };

/**
 * An update from the organiser to attendees, in the same clothes as the
 * ticket email. Plain paragraphs in, branded email out — the admin panel
 * previews exactly this output before anything sends.
 */
export function renderEventMessage(input: {
  event: EventRecord;
  subject: string;
  body: string;
  origin?: string;
}): RenderedEmail {
  const { event, subject, body, origin = BASE_URL } = input;
  return renderCommunicationMessage({
    kind: "event_update",
    subject,
    body,
    origin,
    meta: event.title,
    context: { event },
  });
}

function refundAmount(tickets: TicketRecord[]): string | null {
  const currency = tickets.find((ticket) => ticket.currency)?.currency;
  if (!currency) return null;
  const amount = tickets.reduce((sum, ticket) => sum + (ticket.amountPaidMinor ?? 0), 0);
  return amount > 0 ? formatMoney(amount, currency) : null;
}

/** Confirm that money is going back and every affected QR has been cancelled. */
export async function sendRefundEmail(input: {
  event: EventRecord;
  tickets: TicketRecord[];
}): Promise<TicketEmailResult> {
  const { event, tickets } = input;
  const recipient = tickets.find((ticket) => ticket.email)?.email;
  if (!recipient) return { queued: false, error: "No email address on this order" };
  if (tickets.length === 0) return { queued: false, error: "No refunded tickets to confirm" };

  const amount = refundAmount(tickets);
  const count = tickets.length;
  const ticketLabel = `${count} ticket${count === 1 ? "" : "s"}`;
  const when = formatEventDateTime(event.startsAt, event.timezone);
  const text = [
    `Refund confirmed — ${event.title}`,
    "",
    `${amount ? `${amount} for ` : ""}${ticketLabel} is on its way back to the original payment method.`,
    "It usually arrives within a few working days.",
    "",
    `${event.title} · ${when}`,
    ...tickets.map((ticket) => `  ${ticket.holderName} — ${ticket.id}`),
    "",
    `The ${count === 1 ? "QR code is" : "QR codes are"} cancelled and will no longer work at the door.`,
    "",
    "— milk & henny",
  ].join("\n");
  const rows = tickets
    .map(
      (ticket) =>
        `<li style="margin:0 0 6px">${escapeHtml(ticket.holderName)} <span style="color:#78716c">${escapeHtml(ticket.id)}</span></li>`,
    )
    .join("");
  const html = renderBrandedEmail({
    origin: BASE_URL,
    label: "refund confirmed",
    title: "Your refund is on its way",
    meta: `${event.title} · ${when}`,
    contentHtml: `<p style="margin:0 0 12px">${amount ? `${escapeHtml(amount)} for ` : ""}${ticketLabel} is on its way back to the original payment method. It usually arrives within a few working days.</p>
    <ul style="margin:0 0 20px;padding-left:20px">${rows}</ul>
    <p style="margin:0;color:#78716c;font:13px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace">The ${count === 1 ? "QR code is" : "QR codes are"} cancelled and will no longer work at the door.</p>`,
  });

  const refundKey = [...new Set(tickets.map((ticket) => ticket.refundRef ?? "refund"))]
    .sort()
    .join(":");
  const result = await sendEmail(
    {
      channel: "tickets",
      to: recipient,
      subject: `Refund confirmed — ${event.title}`,
      text,
      html,
    },
    { idempotencyKey: `tickets:refund:${tickets[0].orderId}:${refundKey}` },
  );

  if (!result.ok) {
    log.error("tickets.email", "Refund email failed", {
      slug: event.slug,
      count,
      status: result.status,
    });
    return { queued: false, error: result.error };
  }

  log.info("tickets.email", "Refund email queued", { slug: event.slug, count });
  return { queued: true };
}
