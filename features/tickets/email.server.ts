import QRCode from "qrcode";

import { sendEmail, type EmailAttachment } from "@/lib/platform/email.server";
import { log } from "@/lib/platform/logger.server";
import { buildTicketUrl } from "@/features/events/routes";
import { formatEventDateTime, formatMoney } from "@/features/events/types";
import type { EventRecord } from "@/features/events/types";
import { buildTicketQrPayload } from "./qr.server";
import type { TicketRecord } from "./types";

/**
 * Ticket delivery email.
 *
 * Text-first with the ticket link as the primary affordance. The QR is
 * embedded as an inline attachment rather than a remote image because remote
 * images are blocked by default in most clients — but the link is what
 * actually gets someone through the door if the image never renders.
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function renderQrAttachment(payload: string): Promise<EmailAttachment | null> {
  try {
    const dataUrl = await QRCode.toDataURL(payload, { margin: 1, width: 480 });
    const base64 = dataUrl.split(",")[1];
    if (!base64) return null;
    return {
      content: base64,
      filename: "ticket-qr.png",
      type: "image/png",
      disposition: "inline",
      contentId: "ticketqr",
    };
  } catch (error) {
    log.error("tickets.email", "QR render failed; sending link-only", {}, error);
    return null;
  }
}

function buildText(event: EventRecord, tickets: TicketRecord[], origin: string): string {
  const when = formatEventDateTime(event.startsAt, event.timezone);
  const lines = [
    `You're in — ${event.title}`,
    "",
    when,
    event.doorsAt ? `Doors ${formatEventDateTime(event.doorsAt, event.timezone)}` : null,
    event.venueName ? event.venueName : null,
    event.address ? event.address : null,
    event.doorCode ? `Door code: ${event.doorCode}` : null,
    event.threeWordHint ? `Find it: ${event.threeWordHint}` : null,
    "",
    tickets.length === 1 ? "Your ticket:" : `Your ${tickets.length} tickets:`,
    ...tickets.map((ticket) => `  ${ticket.holderName} — ${buildTicketUrl(origin, ticket.id)}`),
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
  hasQr: boolean,
): string {
  const when = escapeHtml(formatEventDateTime(event.startsAt, event.timezone));
  const detail = [
    event.doorsAt
      ? `Doors ${escapeHtml(formatEventDateTime(event.doorsAt, event.timezone))}`
      : null,
    event.venueName ? escapeHtml(event.venueName) : null,
    event.address ? escapeHtml(event.address) : null,
    event.doorCode ? `Door code: <strong>${escapeHtml(event.doorCode)}</strong>` : null,
    event.threeWordHint ? `Find it: ${escapeHtml(event.threeWordHint)}` : null,
  ].filter((line): line is string => line !== null);

  const ticketRows = tickets
    .map(
      (ticket) =>
        `<p style="margin:0 0 8px"><a href="${escapeHtml(buildTicketUrl(origin, ticket.id))}" style="color:#b45309">${escapeHtml(ticket.holderName)} — open ticket</a></p>`,
    )
    .join("");

  return `<div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#fafaf9;color:#1c1917;padding:24px">
  <div style="max-width:520px;margin:0 auto">
    <h1 style="font-family:Georgia,serif;font-size:24px;margin:0 0 4px">${escapeHtml(event.title)}</h1>
    <p style="margin:0 0 16px;color:#78716c">${when}</p>
    ${detail.length > 0 ? `<p style="margin:0 0 20px;line-height:1.6">${detail.join("<br>")}</p>` : ""}
    ${hasQr ? `<div style="text-align:center;margin:24px 0"><img src="cid:ticketqr" width="240" height="240" alt="Ticket QR code" style="max-width:100%"></div>` : ""}
    <div style="border-top:1px solid #e7e5e4;padding-top:16px">${ticketRows}</div>
    <p style="margin:20px 0 0;color:#78716c;font-size:13px;line-height:1.6">
      Open the link at the door and we'll scan it. Screenshots work too.
      ${event.lastEntryAt ? `Last entry ${escapeHtml(formatEventDateTime(event.lastEntryAt, event.timezone))}.` : ""}
      ${event.ageLimit ? escapeHtml(event.ageLimit) + "." : ""}
    </p>
    <div style="border-top:1px solid #e7e5e4;margin-top:20px;padding-top:16px;color:#78716c;font-size:12px;line-height:1.6">
      <strong style="color:#1c1917">Ticket terms</strong><br>
      ${escapeHtml(event.terms ?? "Tickets are for this named, dated event. Entry is subject to the event details and house rules.")}<br><br>
      ${escapeHtml(event.refundPolicy ?? "Self-serve refunds are available before doors open while nobody on the order has checked in. After that, contact us so the door record can be reviewed.")}
    </div>
    <p style="margin:24px 0 0;color:#a8a29e;font-size:12px">milk &amp; henny</p>
  </div>
</div>`;
}

export type TicketEmailResult = { sent: boolean; error?: string };

/**
 * Send one order's tickets.
 *
 * Returns rather than throws: a ticket that exists but was not emailed is
 * recoverable through the resend flow, so delivery failure must never fail
 * the issuance that already took someone's money.
 */
export async function sendTicketEmail(input: {
  event: EventRecord;
  tickets: TicketRecord[];
  origin: string;
}): Promise<TicketEmailResult> {
  const { event, tickets, origin } = input;
  const recipient = tickets.find((ticket) => ticket.email)?.email;
  if (!recipient) return { sent: false, error: "No email address on this order" };
  if (tickets.length === 0) return { sent: false, error: "No tickets to send" };

  // One QR per email: the first ticket. Plus-ones each have their own link,
  // and the door can scan any of them from the ticket page.
  const attachment = await renderQrAttachment(buildTicketQrPayload(tickets[0].id));

  const result = await sendEmail({
    channel: "tickets",
    to: recipient,
    subject: `You're in — ${event.title}`,
    text: buildText(event, tickets, origin),
    html: buildHtml(event, tickets, origin, attachment !== null),
    attachments: attachment ? [attachment] : undefined,
  });

  if (!result.ok) {
    log.error("tickets.email", "Ticket email failed", {
      slug: event.slug,
      count: tickets.length,
      status: result.status,
    });
    return { sent: false, error: result.error };
  }

  log.info("tickets.email", "Ticket email sent", { slug: event.slug, count: tickets.length });
  return { sent: true };
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
  if (!recipient) return { sent: false, error: "No email address on this order" };
  if (tickets.length === 0) return { sent: false, error: "No refunded tickets to confirm" };

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
  const html = `<div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#fafaf9;color:#1c1917;padding:24px">
  <div style="max-width:520px;margin:0 auto">
    <h1 style="font-family:Georgia,serif;font-size:24px;margin:0 0 4px">Refund confirmed</h1>
    <p style="margin:0 0 20px;color:#78716c">${escapeHtml(event.title)} · ${escapeHtml(when)}</p>
    <p style="margin:0 0 12px;line-height:1.6">${amount ? `${escapeHtml(amount)} for ` : ""}${ticketLabel} is on its way back to the original payment method. It usually arrives within a few working days.</p>
    <ul style="margin:0 0 20px;padding-left:20px">${rows}</ul>
    <p style="margin:0;color:#78716c;font-size:13px;line-height:1.6">The ${count === 1 ? "QR code is" : "QR codes are"} cancelled and will no longer work at the door.</p>
    <p style="margin:24px 0 0;color:#a8a29e;font-size:12px">milk &amp; henny</p>
  </div>
</div>`;

  const result = await sendEmail({
    channel: "tickets",
    to: recipient,
    subject: `Refund confirmed — ${event.title}`,
    text,
    html,
  });

  if (!result.ok) {
    log.error("tickets.email", "Refund email failed", {
      slug: event.slug,
      count,
      status: result.status,
    });
    return { sent: false, error: result.error };
  }

  log.info("tickets.email", "Refund email sent", { slug: event.slug, count });
  return { sent: true };
}
