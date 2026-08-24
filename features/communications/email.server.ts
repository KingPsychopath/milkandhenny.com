import { escapeEmailHtml, renderBrandedEmail } from "@/lib/shared/email-design";
import { BASE_URL } from "@/lib/shared/config";
import { buildAppUrl } from "@/lib/shared/app-url";
import type { EventRecord } from "@/features/events/types";

export type CommunicationKind =
  | "newsletter"
  | "event_update"
  | "pitch_nudge"
  | "event_service"
  | "feedback";
export type CommunicationMedia = {
  kind: "image" | "gif" | "video";
  url: string;
  alt: string;
  posterUrl?: string;
};

function safeUrl(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return trimmed;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:" ? trimmed : null;
  } catch {
    return null;
  }
}

function safeLinkUrl(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.startsWith("mailto:")) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed.slice("mailto:".length)) ? trimmed : null;
  }
  return safeUrl(trimmed);
}

export type CommunicationEmailContext = {
  event?: EventRecord;
  surveyUrl?: string;
  recipientName?: string;
};

function replaceTokens(value: string, context: CommunicationEmailContext, origin: string): string {
  const event = context.event;
  const eventDate = event
    ? new Intl.DateTimeFormat("en-GB", {
        dateStyle: "full",
        timeZone: event.timezone,
      }).format(new Date(event.startsAt))
    : "";
  const eventTime = event
    ? new Intl.DateTimeFormat("en-GB", {
        timeStyle: "short",
        timeZone: event.timezone,
      }).format(new Date(event.startsAt))
    : "";
  const doorsTime = event?.doorsAt
    ? new Intl.DateTimeFormat("en-GB", {
        timeStyle: "short",
        timeZone: event.timezone,
      }).format(new Date(event.doorsAt))
    : "";
  const values: Record<string, string> = {
    "recipient.name": context.recipientName ?? "",
    "event.title": event?.title ?? "After School Club",
    "event.date": eventDate,
    "event.time": eventTime,
    "event.doors": doorsTime,
    "event.timing": event ? eventTiming(event) : "",
    "event.venue": event?.venueName ?? "",
    "event.address": event ? addressWithoutVenue(event) : "",
    "event.map": event?.mapUrl ?? buildAppUrl(origin, "/contact"),
    "links.spellingGame": buildAppUrl(origin, "/things/spelling-bee"),
    "links.pitch": buildAppUrl(origin, "/things/pitches/new"),
    "links.walkingVideo": buildAppUrl(
      origin,
      "/media/events/after-school-club-2026-09-01/walking.mp4",
      { search: { v: "1" } },
    ),
    "links.contact": buildAppUrl(origin, "/contact"),
    "links.email": "mailto:hello@milkandhenny.com",
    "survey.url": context.surveyUrl ?? "",
  };
  return value.replace(/\{\{([A-Za-z.]+)\}\}/g, (_, key: string) => values[key] ?? "");
}

function eventTiming(event: EventRecord): string {
  const eventTime = new Intl.DateTimeFormat("en-GB", {
    timeStyle: "short",
    timeZone: event.timezone,
  }).format(new Date(event.startsAt));
  const doorsTime = event.doorsAt
    ? new Intl.DateTimeFormat("en-GB", {
        timeStyle: "short",
        timeZone: event.timezone,
      }).format(new Date(event.doorsAt))
    : "";
  return [
    doorsTime ? "Doors open: **" + doorsTime + "**" : "",
    eventTime && eventTime !== doorsTime ? "Starts: **" + eventTime + "**" : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function addressWithoutVenue(event: EventRecord): string {
  const address = event.address?.trim() ?? "";
  const venue = event.venueName?.trim().toLowerCase();
  if (!address || !venue) return address;
  return address
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part && part.toLowerCase() !== venue)
    .join(", ");
}

function replaceMarkdownLinks(
  value: string,
  replace: (label: string, url: string) => string,
): string {
  let output = "";
  let cursor = 0;
  while (cursor < value.length) {
    const open = value.indexOf("[", cursor);
    if (open < 0) {
      output += value.slice(cursor);
      break;
    }
    const labelEnd = value.indexOf("](", open + 1);
    if (labelEnd < 0) {
      output += value.slice(cursor);
      break;
    }
    let depth = 1;
    let end = labelEnd + 2;
    for (; end < value.length; end += 1) {
      if (value[end] === "(") depth += 1;
      if (value[end] === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) {
      output += value.slice(cursor);
      break;
    }
    output += value.slice(cursor, open);
    output += replace(value.slice(open + 1, labelEnd), value.slice(labelEnd + 2, end));
    cursor = end + 1;
  }
  return output;
}

function inlineHtml(value: string): string {
  const escaped = escapeEmailHtml(value);
  const withLinks = replaceMarkdownLinks(escaped, (label, url) => {
    const safe = safeLinkUrl(url);
    return safe
      ? `<a href="${escapeEmailHtml(safe)}" style="color:#a16207;text-decoration:underline;text-underline-offset:3px">${label}</a>`
      : label;
  });
  return withLinks.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function richBodyHtml(value: string): string {
  const lines = value.trim().split("\n");
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(
      `<p style="margin:0 0 18px;line-height:1.7">${paragraph.map(inlineHtml).join("<br>")}</p>`,
    );
    paragraph = [];
  };
  const flushList = () => {
    if (list.length === 0) return;
    blocks.push(
      `<ul style="margin:0 0 20px;padding-left:22px">${list.map((item) => `<li style="margin:0 0 8px;padding-left:4px">${inlineHtml(item)}</li>`).join("")}</ul>`,
    );
    list = [];
  };

  for (const line of lines) {
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    if (line.startsWith("- ")) {
      flushParagraph();
      list.push(line.slice(2).trim());
      continue;
    }
    if (line.startsWith("## ")) {
      flushParagraph();
      flushList();
      blocks.push(
        `<h2 style="margin:24px 0 10px;font:600 20px/1.25 Georgia,serif">${inlineHtml(line.slice(3).trim())}</h2>`,
      );
      continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  return blocks.join("");
}

function plainTextBody(value: string): string {
  return replaceMarkdownLinks(value, (label, url) => {
    const safe = safeLinkUrl(url);
    return safe && !safe.startsWith("mailto:") ? `${label} (${safe})` : label;
  })
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/^##\s+/gm, "")
    .replace(/^- /gm, "• ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function mediaHtml(media: CommunicationMedia[]): string {
  return media
    .map((item) => {
      const url = safeUrl(item.url);
      if (!url) return "";
      const alt = escapeEmailHtml(item.alt || "shared media");
      if (item.kind === "video") {
        const poster = item.posterUrl ? safeUrl(item.posterUrl) : null;
        const image = poster
          ? `<img src="${escapeEmailHtml(poster)}" alt="${alt}" style="display:block;width:100%;height:auto;border:0">`
          : `<span style="display:block;padding:28px 16px;border:1px solid #e7e5e4;text-align:center">watch the video →</span>`;
        return `<p style="margin:24px 0"><a href="${escapeEmailHtml(url)}" style="color:#b45309;text-decoration:none">${image}</a></p>`;
      }
      return `<p style="margin:24px 0"><img src="${escapeEmailHtml(url)}" alt="${alt}" style="display:block;width:100%;height:auto;border:0"></p>`;
    })
    .join("");
}

export function renderCommunicationMessage(input: {
  kind: CommunicationKind;
  subject: string;
  body: string;
  media?: CommunicationMedia[];
  recipientName?: string;
  unsubscribeUrl?: string;
  origin?: string;
  meta?: string;
  context?: CommunicationEmailContext;
}) {
  const origin = input.origin ?? BASE_URL;
  const context = {
    ...input.context,
    recipientName: input.recipientName ?? input.context?.recipientName,
  };
  const subject = replaceTokens(input.subject, context, origin);
  const body = replaceTokens(input.body, context, origin);
  const greeting = input.recipientName ? `Hi ${input.recipientName},` : "";
  const paragraphs = richBodyHtml(body);
  const contentHtml = [
    greeting ? `<p style="margin:0 0 14px;line-height:1.6">${escapeEmailHtml(greeting)}</p>` : "",
    paragraphs,
    mediaHtml(input.media ?? []),
  ].join("");
  const label =
    input.kind === "newsletter"
      ? "news from milk & henny"
      : input.kind === "event_update"
        ? "event update"
        : input.kind === "pitch_nudge"
          ? "a note about your pitch"
          : input.kind === "feedback"
            ? "a small question from milk & henny"
            : "after school club details";
  const footerLink = input.unsubscribeUrl
    ? { label: "stop marketing emails", url: input.unsubscribeUrl }
    : undefined;
  const rendered = renderBrandedEmail({
    origin,
    label,
    title: subject,
    meta: input.kind === "event_service" || input.kind === "feedback" ? undefined : input.meta,
    contentHtml,
    footerLink,
  });
  return {
    subject,
    text: [
      input.recipientName ? `Hi ${input.recipientName},` : "",
      plainTextBody(body),
      ...(input.media?.length ? ["", "Media is included in the HTML version."] : []),
      ...(input.unsubscribeUrl ? ["", `Stop marketing emails: ${input.unsubscribeUrl}`] : []),
      "",
      "— milk & henny · hello@milkandhenny.com",
    ]
      .filter(Boolean)
      .join("\n"),
    html: rendered,
  };
}
