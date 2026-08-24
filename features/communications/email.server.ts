import { escapeEmailHtml, renderBrandedEmail } from "@/lib/shared/email-design";
import { BASE_URL } from "@/lib/shared/config";

export type CommunicationKind = "newsletter" | "event_update" | "pitch_nudge";
export type CommunicationMedia = {
  kind: "image" | "gif" | "video";
  url: string;
  alt: string;
  posterUrl?: string;
};

function safeUrl(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.startsWith("/")) return trimmed;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:" ? trimmed : null;
  } catch {
    return null;
  }
}

function mediaHtml(media: CommunicationMedia[]): string {
  return media.map((item) => {
    const url = safeUrl(item.url);
    if (!url) return "";
    const alt = escapeEmailHtml(item.alt || "shared media");
    if (item.kind === "video") {
      const poster = item.posterUrl ? safeUrl(item.posterUrl) : null;
      const image = poster
        ? `<img src="${escapeEmailHtml(poster)}" alt="${alt}" style="display:block;width:100%;height:auto;border:0">`
        : `<span style="display:block;padding:28px 16px;border:1px solid #e7e5e4;text-align:center">watch the video →</span>`;
      return `<p style="margin:0 0 20px"><a href="${escapeEmailHtml(url)}" style="color:#b45309;text-decoration:none">${image}</a></p>`;
    }
    return `<p style="margin:0 0 20px"><img src="${escapeEmailHtml(url)}" alt="${alt}" style="display:block;width:100%;height:auto;border:0"></p>`;
  }).join("");
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
}) {
  const origin = input.origin ?? BASE_URL;
  const greeting = input.recipientName ? `Hi ${input.recipientName},` : "";
  const paragraphs = input.body
    .trim()
    .split(/\n{2,}/)
    .map(
      (paragraph) =>
        `<p style="margin:0 0 14px;line-height:1.6">${escapeEmailHtml(paragraph).replace(/\n/g, "<br>")}</p>`,
    )
    .join("");
  const contentHtml = [
    greeting ? `<p style="margin:0 0 14px;line-height:1.6">${escapeEmailHtml(greeting)}</p>` : "",
    mediaHtml(input.media ?? []),
    paragraphs,
  ].join("");
  const label =
    input.kind === "newsletter"
      ? "news from milk & henny"
      : input.kind === "event_update"
        ? "event update"
        : "a note about your pitch";
  const footerLink = input.unsubscribeUrl
    ? { label: "stop marketing emails", url: input.unsubscribeUrl }
    : undefined;
  const rendered = renderBrandedEmail({
    origin,
    label,
    title: input.subject,
    meta: input.meta,
    contentHtml,
    footerLink,
  });
  return {
    subject: input.subject,
    text: [
      input.recipientName ? `Hi ${input.recipientName},` : "",
      input.body.trim(),
      ...(input.media?.length ? ["", "Media is included in the HTML version."] : []),
      ...(input.unsubscribeUrl ? ["", `Stop marketing emails: ${input.unsubscribeUrl}`] : []),
      "",
      "— milk & henny",
    ].filter(Boolean).join("\n"),
    html: rendered,
  };
}
