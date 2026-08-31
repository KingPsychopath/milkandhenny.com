import type { EventRecord } from "@/features/events/types";
import { buildEventUrl } from "@/features/events/routes";
import { buildAppUrl } from "@/lib/shared/app-url";
import { escapeEmailHtml, renderBrandedEmail } from "@/lib/shared/email-design";
import type { EmailMessage } from "@/lib/platform/email.server";
import { waitlistPath } from "./types";

function scopedLabel(ticketTypeName: string | undefined): string {
  return ticketTypeName ? `${ticketTypeName} tickets` : "any ticket for the event";
}

export function buildWaitlistConfirmationEmail(input: {
  event: EventRecord;
  email: string;
  ticketTypeName?: string;
  managementToken: string;
  origin: string;
}): EmailMessage {
  const label = scopedLabel(input.ticketTypeName);
  const managementUrl = buildAppUrl(input.origin, waitlistPath(input.managementToken));
  const eventUrl = buildEventUrl(input.origin, input.event.slug);
  const title = `Confirm the waitlist for ${input.event.title}`;
  return {
    channel: "communications",
    to: input.email,
    subject: title,
    text: [
      title,
      "",
      `You asked for an alert when ${label} become available.`,
      `Confirm your email: ${managementUrl}`,
      "",
      "We send one availability alert. A place is not reserved, and joining this waitlist does not subscribe you to marketing.",
      `Event details: ${eventUrl}`,
      "",
      "If you did not request this, ignore this email and nothing will be activated.",
      "— milk & henny",
    ].join("\n"),
    html: renderBrandedEmail({
      origin: input.origin,
      label: "event waitlist",
      title,
      contentHtml: `<p style="margin:0">You asked for an alert when <strong>${escapeEmailHtml(label)}</strong> become available.</p>`,
      action: { label: "confirm waitlist place", url: managementUrl },
      note: "We send one availability alert. A place is not reserved, and this does not subscribe you to marketing. If you did not request it, ignore this email.",
      footerLink: { label: "view event", url: eventUrl },
    }),
  };
}

export function buildWaitlistAvailabilityEmail(input: {
  event: EventRecord;
  email: string;
  ticketTypeName?: string;
  origin: string;
}): EmailMessage {
  const label = scopedLabel(input.ticketTypeName);
  const eventUrl = buildEventUrl(input.origin, input.event.slug);
  const title = `${input.ticketTypeName ?? "Tickets"} available for ${input.event.title}`;
  return {
    channel: "communications",
    to: input.email,
    subject: title,
    text: [
      title,
      "",
      `${label} are available now.`,
      `See tickets: ${eventUrl}#tickets`,
      "",
      "Tickets are not held by this alert and may sell out again. We have now removed you from this waitlist so we do not send repeated alerts. Join again from the event page if you miss them.",
      "",
      "— milk & henny",
    ].join("\n"),
    html: renderBrandedEmail({
      origin: input.origin,
      label: "waitlist availability",
      title,
      contentHtml: `<p style="margin:0"><strong>${escapeEmailHtml(label)}</strong> are available now.</p>`,
      action: { label: "see tickets", url: `${eventUrl}#tickets` },
      note: "Tickets are not held by this alert and may sell out again. We removed you from this waitlist after this one alert; join again from the event page if you miss them.",
    }),
  };
}
