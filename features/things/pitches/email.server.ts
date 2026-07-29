import { sendEmail, type SendEmailResult } from "@/lib/platform/email.server";

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ??
      character,
  );
}

export async function sendPitchRecoveryEmail(input: {
  email: string;
  origin: string;
  decks: Array<{ id: string; title: string; token: string }>;
}): Promise<SendEmailResult> {
  const links = input.decks.map((deck) => ({
    title: deck.title,
    url: `${input.origin}/things/pitches/${encodeURIComponent(deck.id)}/edit#key=${encodeURIComponent(deck.token)}`,
  }));
  const text = [
    "Your milk & henny pitches",
    "",
    "These private links let this browser keep editing your drafts. Do not forward them.",
    "",
    ...links.flatMap((link) => [`${link.title}`, link.url, ""]),
    "Published pitches remain visible to everyone, but only these links can change your working copies.",
  ].join("\n");
  const htmlLinks = links
    .map(
      (link) =>
        `<li style="margin:0 0 18px"><strong>${escapeHtml(link.title)}</strong><br><a href="${escapeHtml(link.url)}">${escapeHtml(link.url)}</a></li>`,
    )
    .join("");

  return sendEmail({
    to: input.email,
    subject: input.decks.length === 1 ? "Your pitch editing link" : "Your pitch editing links",
    text,
    html: `<div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;line-height:1.55;color:#211c18">
      <h1 style="font-family:Georgia,serif;font-size:28px">Your milk &amp; henny pitches</h1>
      <p>These private links let this browser keep editing your drafts. Do not forward them.</p>
      <ul style="padding-left:20px">${htmlLinks}</ul>
      <p>Published pitches remain visible to everyone, but only these links can change your working copies.</p>
    </div>`,
  });
}
