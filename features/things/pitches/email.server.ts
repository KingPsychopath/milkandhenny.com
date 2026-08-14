import { createHash } from "node:crypto";

import { sendEmail, type SendEmailResult } from "@/lib/platform/email.server";

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ??
      character,
  );
}

function editUrl(origin: string, deckId: string, token: string): string {
  return `${origin}/things/pitches/${encodeURIComponent(deckId)}/edit#key=${encodeURIComponent(token)}`;
}

function emailShell(input: {
  origin: string;
  eyebrow: string;
  title: string;
  intro: string;
  action: { label: string; url: string };
  after: string;
}): string {
  const logo = `${input.origin}/icon-192.png`;
  return `<div style="margin:0;background:#f7f4ef;padding:32px 16px;color:#211c18">
    <div style="margin:0 auto;max-width:560px;background:#fffdf9;padding:36px">
      <img src="${escapeHtml(logo)}" width="56" height="56" alt="milk &amp; henny" style="display:block;border:0;border-radius:14px">
      <p style="margin:28px 0 10px;font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:#8c7f72">${escapeHtml(input.eyebrow)}</p>
      <h1 style="margin:0;font:32px/1.08 Georgia,serif;font-weight:400">${escapeHtml(input.title)}</h1>
      <p style="margin:22px 0;font:18px/1.6 Georgia,serif;color:#554b43">${escapeHtml(input.intro)}</p>
      <p style="margin:28px 0">
        <a href="${escapeHtml(input.action.url)}" style="display:inline-block;background:#211c18;color:#fffdf9;padding:15px 20px;text-decoration:none;font:14px/1 ui-monospace,SFMono-Regular,Menlo,monospace">${escapeHtml(input.action.label)} →</a>
      </p>
      <p style="margin:0;font:13px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;color:#756a61">${escapeHtml(input.after)}</p>
      <p style="margin:24px 0 0;overflow-wrap:anywhere;font:11px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;color:#aaa097">${escapeHtml(input.action.url)}</p>
    </div>
  </div>`;
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
        `Your pitch “${input.deck.title}” has a private working copy.`,
        url,
        "",
        "Keep this link private. The studio also remembers this pitch on the device where you started it, and you can request a fresh link by email if you lose it.",
      ].join("\n"),
      html: emailShell({
        origin: input.origin,
        eyebrow: "your private working copy",
        title: `Hello ${input.deck.ownerName}. Your pitch has a home.`,
        intro:
          "Open the studio whenever you want to keep shaping it. Your work saves on this device first, then safely syncs when you are online.",
        action: { label: "open your pitch", url },
        after:
          "Keep this private link to yourself. Lose it? Use “find my pitches” on the wall and we’ll send a fresh one to this address.",
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
        `You sealed “${input.deck.title}”. This edition is now on the pitch wall:`,
        publicUrl,
        "",
        "Your working copy is still yours to edit:",
        privateUrl,
      ].join("\n"),
      html: emailShell({
        origin: input.origin,
        eyebrow: "sealed and saved",
        title: `${input.deck.title} is on the wall.`,
        intro:
          "That public edition cannot be changed underneath anyone. Your private working copy is still open, so you can make a better version and seal it again.",
        action: { label: "see the sealed pitch", url: publicUrl },
        after: `Private studio: ${privateUrl}`,
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
        `<li style="margin:0 0 18px"><strong>${escapeHtml(link.title)}</strong><br><a href="${escapeHtml(link.url)}" style="color:#211c18;overflow-wrap:anywhere">${escapeHtml(link.url)}</a></li>`,
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
      html: `<div style="margin:0;background:#f7f4ef;padding:32px 16px;color:#211c18">
      <div style="margin:0 auto;max-width:560px;background:#fffdf9;padding:36px">
        <img src="${escapeHtml(`${input.origin}/icon-192.png`)}" width="56" height="56" alt="milk &amp; henny" style="display:block;border:0;border-radius:14px">
        <p style="margin:28px 0 10px;font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:#8c7f72">private recovery links</p>
        <h1 style="margin:0 0 22px;font:32px/1.08 Georgia,serif;font-weight:400">Your pitches found their way home.</h1>
        <ul style="padding-left:20px;font:15px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace">${htmlLinks}</ul>
        <p style="margin:22px 0 0;font:13px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;color:#756a61">Keep these links private. Published editions stay public; only these links open the working copies.</p>
      </div>
    </div>`,
    },
    { idempotencyKey: `pitches:recovery:${recoveryKey}` },
  );
}
