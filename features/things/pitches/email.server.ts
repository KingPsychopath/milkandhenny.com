import { createHash } from "node:crypto";

import { sendEmail, type SendEmailResult } from "@/lib/platform/email.server";
import { escapeEmailHtml, renderBrandedEmail } from "@/lib/shared/email-design";

function editUrl(origin: string, deckId: string, token: string): string {
  return `${origin}/things/pitches/${encodeURIComponent(deckId)}/edit#key=${encodeURIComponent(token)}`;
}

export async function sendPitchWelcomeEmail(input: {
  email: string;
  origin: string;
  deck: { id: string; title: string; ownerName: string };
  token: string;
}): Promise<SendEmailResult> {
  const url = editUrl(input.origin, input.deck.id, input.token);
  return sendEmail(
    {
      channel: "studio",
      to: input.email,
      subject: `Your pitch is ready — ${input.deck.title}`,
      text: [
        `Hello ${input.deck.ownerName},`,
        "",
        `Your pitch “${input.deck.title}” is ready. Open your private working copy:`,
        url,
        "",
        "Changes save on this device first and sync when you are online.",
        "Keep this link private. If you lose it, use “find my pitches” to request a new one.",
      ].join("\n"),
      html: renderBrandedEmail({
        origin: input.origin,
        label: "private working copy",
        title: `Your pitch is ready, ${input.deck.ownerName}.`,
        contentHtml:
          '<p style="margin:0">Open your private working copy to keep shaping it. Changes save on this device first and sync when you are online.</p>',
        action: { label: "open your pitch", url },
        note: "Keep this link private. If you lose it, use “find my pitches” to request a new one.",
      }),
    },
    { idempotencyKey: `pitches:welcome:${input.deck.id}` },
  );
}

export async function sendPitchPublishedEmail(input: {
  email: string;
  origin: string;
  deck: { id: string; title: string; ownerName: string; publishedVersion?: number };
  token: string;
}): Promise<SendEmailResult> {
  const publicUrl = `${input.origin}/things/pitches/${encodeURIComponent(input.deck.id)}`;
  const privateUrl = editUrl(input.origin, input.deck.id, input.token);
  return sendEmail(
    {
      channel: "studio",
      to: input.email,
      subject: `${input.deck.title} is on the wall`,
      text: [
        `Hello ${input.deck.ownerName},`,
        "",
        `You published “${input.deck.title}”. This edition is now on the pitch wall:`,
        publicUrl,
        "",
        "This published edition stays fixed. Your private working copy remains editable:",
        privateUrl,
      ].join("\n"),
      html: renderBrandedEmail({
        origin: input.origin,
        label: "published edition",
        title: `${input.deck.title} is on the wall.`,
        contentHtml:
          '<p style="margin:0">This published edition stays fixed. Your private working copy remains editable, so you can make changes and publish a new edition.</p>',
        action: { label: "see the sealed pitch", url: publicUrl },
        note: `Private working copy: ${privateUrl}`,
      }),
    },
    {
      idempotencyKey: `pitches:published:${input.deck.id}:${input.deck.publishedVersion ?? "current"}`,
    },
  );
}

export async function sendPitchRecoveryEmail(input: {
  email: string;
  origin: string;
  decks: Array<{ id: string; title: string; token: string }>;
}): Promise<SendEmailResult> {
  const links = input.decks.map((deck) => ({
    title: deck.title,
    url: editUrl(input.origin, deck.id, deck.token),
  }));
  const text = [
    "Your milk & henny pitches",
    "",
    "These private links let you keep editing your drafts. Do not forward them.",
    "",
    ...links.flatMap((link) => [`${link.title}`, link.url, ""]),
    "Published editions stay visible to everyone; only these links can change your working copies.",
  ].join("\n");
  const htmlLinks = links
    .map(
      (link) =>
        `<li style="margin:0 0 18px"><strong>${escapeEmailHtml(link.title)}</strong><br><a href="${escapeEmailHtml(link.url)}" style="color:#b45309;overflow-wrap:anywhere">open private working copy</a></li>`,
    )
    .join("");

  const recoveryKey = createHash("sha256")
    .update(
      input.decks
        .map((deck) => `${deck.id}:${deck.token}`)
        .sort()
        .join("\n"),
    )
    .digest("hex");
  return sendEmail(
    {
      channel: "studio",
      to: input.email,
      subject: input.decks.length === 1 ? "Your pitch editing link" : "Your pitch editing links",
      text,
      html: renderBrandedEmail({
        origin: input.origin,
        label: "private working copies",
        title: "Your pitch editing links",
        contentHtml: `<p style="margin:0 0 20px">Use these private links to keep editing your drafts.</p><ul style="margin:0;padding-left:20px">${htmlLinks}</ul>`,
        note: "Keep these links private. Published editions stay public; only these links can edit the working copies.",
      }),
    },
    { idempotencyKey: `pitches:recovery:${recoveryKey}` },
  );
}
