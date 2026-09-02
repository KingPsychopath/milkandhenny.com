import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { buildAppUrl } from "@/lib/shared/app-url";
import { isDatabaseConfigured, query } from "@/lib/platform/postgres.server";
import { log } from "@/lib/platform/logger.server";
import {
  communicationLinkKey,
  extractCommunicationLinks,
  resolveCommunicationTokens,
  type CommunicationEmailContext,
  type CommunicationMedia,
} from "./email.server";

const LINK_LIFETIME_MS = 90 * 24 * 60 * 60 * 1_000;
const TOKEN_VERSION = 1;

type LinkSource = {
  sourceType: "message" | "stage" | "test";
  sourceId: string;
  recipientHash: string;
};

type SignedLinkPayload = {
  v: number;
  id: string;
  destination: string;
  expiresAt: number;
};

function linkSecret(): string | null {
  const secret = process.env.AUTH_SECRET?.trim();
  return secret || null;
}

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decode(value: string): string | null {
  try {
    return Buffer.from(value, "base64url").toString("utf8");
  } catch {
    return null;
  }
}

function safeDestination(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) return trimmed;
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:" ? trimmed : null;
  } catch {
    return null;
  }
}

function isPrivateCreditDestination(value: string): boolean {
  try {
    const url = new URL(value, "https://milkandhenny.invalid");
    return /^\/credit\/mhc_[A-Za-z0-9_-]{40,60}$/.test(url.pathname);
  } catch {
    return false;
  }
}

function sign(encodedPayload: string, secret: string): string {
  return createHmac("sha256", secret)
    .update(`milk-henny-email-link:${encodedPayload}`)
    .digest("base64url");
}

function signedToken(tokenId: string, destination: string, expiresAt: Date): string | null {
  const secret = linkSecret();
  if (!secret) return null;
  const payload: SignedLinkPayload = {
    v: TOKEN_VERSION,
    id: tokenId,
    destination,
    expiresAt: expiresAt.getTime(),
  };
  const encodedPayload = encode(JSON.stringify(payload));
  return `${encodedPayload}.${sign(encodedPayload, secret)}`;
}

function verifyToken(value: string): SignedLinkPayload | null {
  const secret = linkSecret();
  if (!secret) return null;
  const [encodedPayload, suppliedSignature, extra] = value.split(".");
  if (!encodedPayload || !suppliedSignature || extra) return null;
  const expectedSignature = sign(encodedPayload, secret);
  const expectedBytes = Buffer.from(expectedSignature, "utf8");
  const suppliedBytes = Buffer.from(suppliedSignature, "utf8");
  if (
    expectedBytes.length !== suppliedBytes.length ||
    !timingSafeEqual(expectedBytes, suppliedBytes)
  ) {
    return null;
  }
  const decoded = decode(encodedPayload);
  if (!decoded) return null;
  try {
    const payload = JSON.parse(decoded) as Partial<SignedLinkPayload>;
    if (
      payload.v !== TOKEN_VERSION ||
      typeof payload.id !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(payload.id) ||
      typeof payload.destination !== "string" ||
      !safeDestination(payload.destination) ||
      typeof payload.expiresAt !== "number" ||
      !Number.isFinite(payload.expiresAt) ||
      payload.expiresAt <= Date.now()
    ) {
      return null;
    }
    return payload as SignedLinkPayload;
  } catch {
    return null;
  }
}

/**
 * Create first-party redirects for a sent communication. The destination is
 * signed into the URL so a database outage does not turn a useful email link
 * into a dead page; the database row is only needed for the click count.
 */
export async function prepareCommunicationLinkMap(input: {
  body: string;
  context: CommunicationEmailContext;
  origin: string;
  media: CommunicationMedia[];
  source: LinkSource;
}): Promise<ReadonlyMap<string, string>> {
  const secret = linkSecret();
  if (
    !secret ||
    !isDatabaseConfigured() ||
    !/^[0-9a-f-]{36}$/i.test(input.source.sourceId) ||
    !/^[a-f0-9]{64}$/.test(input.source.recipientHash)
  ) {
    return new Map();
  }

  const resolvedBody = resolveCommunicationTokens(input.body, input.context, input.origin);
  const definitions = new Map<string, string>();
  for (const link of extractCommunicationLinks(resolvedBody)) {
    const destination = safeDestination(link.url);
    if (destination && isPrivateCreditDestination(destination)) continue;
    const key = destination ? communicationLinkKey(destination) : null;
    if (key && destination) definitions.set(key, destination);
  }
  for (const item of input.media) {
    if (item.kind !== "video") continue;
    const destination = safeDestination(item.url);
    const key = destination ? communicationLinkKey(destination) : null;
    if (key && destination) definitions.set(key, destination);
  }
  if (definitions.size === 0) return new Map();

  const expiresAt = new Date(Date.now() + LINK_LIFETIME_MS);
  const rows = [...definitions.entries()];
  const values: unknown[] = [];
  const placeholders = rows.map(([linkKey, destination], index) => {
    const offset = index * 7;
    const tokenId = randomUUID();
    values.push(
      tokenId,
      input.source.sourceType,
      input.source.sourceId,
      input.source.recipientHash,
      linkKey,
      destination,
      expiresAt,
    );
    return `($${offset + 1},$${offset + 2},$${offset + 3},$${offset + 4},$${offset + 5},$${offset + 6},$${offset + 7})`;
  });
  const persisted = await query<{ token_id: string; link_key: string; destination: string }>(
    `insert into communication_links (
       token_id, source_type, source_id, recipient_hash, link_key, destination, expires_at
     ) values ${placeholders.join(",")}
     on conflict (source_type, source_id, recipient_hash, link_key) do update
       set destination = excluded.destination,
           expires_at = excluded.expires_at
     returning token_id, link_key, destination`,
    values,
  );

  const tracked = new Map<string, string>();
  for (const row of persisted) {
    const token = signedToken(row.token_id, row.destination, expiresAt);
    if (token) {
      tracked.set(
        row.link_key,
        buildAppUrl(input.origin, "/api/communications/click", { search: { token } }),
      );
    }
  }
  return tracked;
}

/** Return a safe destination for the redirect route and record one click. */
export async function recordCommunicationLinkClick(token: string): Promise<string | null> {
  const payload = verifyToken(token);
  if (!payload) return null;

  try {
    await query(
      `update communication_links
          set click_count = click_count + 1,
              first_clicked_at = coalesce(first_clicked_at, now()),
              last_clicked_at = now()
        where token_id = $1
          and expires_at > now()`,
      [payload.id],
    );
  } catch (error) {
    // The URL is independently signed. A metrics outage must not break a
    // useful destination in an email that has already reached someone.
    log.warn("email.engagement", "Could not record email link click", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return payload.destination;
}

export async function cleanupExpiredCommunicationLinks(): Promise<{ deleted: number }> {
  if (!isDatabaseConfigured()) return { deleted: 0 };
  const rows = await query<{ deleted: string }>(
    `with removed as (
       delete from communication_links
        where expires_at < now()
        returning token_id
     )
     select count(*)::text as deleted from removed`,
  );
  return { deleted: Number(rows[0]?.deleted) || 0 };
}

export const __emailLinksTesting = { signedToken, verifyToken, safeDestination };
