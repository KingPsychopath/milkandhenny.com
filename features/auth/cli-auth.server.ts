import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getRedis } from "@/lib/platform/redis.server";
import { issueAdminTokenForCli } from "./auth.server";
import { signStepUpToken } from "./internal/authorization.server";

const CLI_REQUEST_TTL_SECONDS = 5 * 60;
const CLI_CODE_TTL_SECONDS = 60;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const STATE_PATTERN = /^[A-Za-z0-9._~-]{16,256}$/;
const PKCE_VERIFIER_PATTERN = /^[A-Za-z0-9._~-]{43,128}$/;
const PKCE_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export type CliAuthorizationPurpose = "login" | "step-up";

type CliAuthorizationRecord = {
  redirectUri: string;
  codeChallenge: string;
  state: string;
  createdAt: number;
  ip: string;
  ua: string;
} & ({ purpose: "login"; parentJti?: never } | { purpose: "step-up"; parentJti: string });

type CliAuthorizationCode = {
  token: string;
  codeChallenge: string;
};

type CliAuthorizationApproval = {
  redirectUri: string;
};

function requestKey(requestId: string): string {
  return `auth:cli-request:${requestId}`;
}

function approvalKey(requestId: string): string {
  return `auth:cli-request-approved:${requestId}`;
}

function codeKey(code: string): string {
  return `auth:cli-code:${code}`;
}

function codeClaimKey(code: string): string {
  return `auth:cli-code-claimed:${code}`;
}

function newOpaqueValue(): string {
  return randomBytes(32).toString("base64url");
}

function isValidState(value: string): boolean {
  return STATE_PATTERN.test(value);
}

function validateRedirectUri(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" || !LOOPBACK_HOSTS.has(url.hostname)) return null;
    if (!url.port || url.username || url.password || url.search || url.hash) return null;
    if (url.pathname !== "/callback") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function loadRedis() {
  return getRedis();
}

async function getCompletedApproval(
  redis: ReturnType<typeof loadRedis>,
  requestId: string,
): Promise<{ redirectUri: string } | null> {
  if (!redis) return null;
  const result = await redis.get<CliAuthorizationApproval>(approvalKey(requestId));
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  return typeof result.redirectUri === "string" ? result : null;
}

export async function createCliAuthorizationRequest(input: {
  redirectUri: string;
  codeChallenge: string;
  state: string;
  ip: string;
  ua: string;
  browserUrlOrigin: string;
  purpose: CliAuthorizationPurpose;
  parentJti?: string;
}): Promise<{ requestId: string; browserUrl: string } | null> {
  const redis = loadRedis();
  if (!redis) return null;

  const redirectUri = validateRedirectUri(input.redirectUri);
  if (!redirectUri || !PKCE_CHALLENGE_PATTERN.test(input.codeChallenge)) return null;
  if (!isValidState(input.state)) return null;
  if (input.purpose === "step-up" && !input.parentJti) return null;

  const requestId = newOpaqueValue();
  const baseRecord = {
    redirectUri,
    codeChallenge: input.codeChallenge,
    state: input.state,
    createdAt: Math.floor(Date.now() / 1000),
    ip: input.ip.slice(0, 128),
    ua: input.ua.slice(0, 256),
  };
  const record: CliAuthorizationRecord =
    input.purpose === "step-up"
      ? { ...baseRecord, purpose: "step-up", parentJti: input.parentJti as string }
      : { ...baseRecord, purpose: "login" };

  try {
    await redis.set(requestKey(requestId), record, { ex: CLI_REQUEST_TTL_SECONDS, nx: true });
    const origin = new URL(input.browserUrlOrigin).origin;
    return {
      requestId,
      browserUrl: `${origin}/admin/cli-auth?request=${encodeURIComponent(requestId)}`,
    };
  } catch {
    return null;
  }
}

export async function getCliAuthorizationRequest(
  requestId: string,
): Promise<CliAuthorizationRecord | null> {
  if (!REQUEST_ID_PATTERN.test(requestId)) return null;
  const redis = loadRedis();
  if (!redis) return null;
  try {
    const record = await redis.get<CliAuthorizationRecord>(requestKey(requestId));
    if (!record || typeof record !== "object") return null;
    return record;
  } catch {
    return null;
  }
}

function callbackRedirect(record: CliAuthorizationRecord, values: Record<string, string>): string {
  const url = new URL(record.redirectUri);
  for (const [key, value] of Object.entries(values)) url.searchParams.set(key, value);
  url.searchParams.set("state", record.state);
  return url.toString();
}

export async function approveCliAuthorization(
  requestId: string,
): Promise<{ redirectUri: string } | null> {
  const redis = loadRedis();
  if (!redis || !REQUEST_ID_PATTERN.test(requestId)) return null;

  let completed = false;
  try {
    const record = await redis.get<CliAuthorizationRecord>(requestKey(requestId));
    if (!record) return getCompletedApproval(redis, requestId);

    const claimed = await redis.set(approvalKey(requestId), "1", {
      ex: CLI_CODE_TTL_SECONDS,
      nx: true,
    });
    if (!claimed) return getCompletedApproval(redis, requestId);

    const token =
      record.purpose === "step-up"
        ? signStepUpToken(record.parentJti)
        : await issueAdminTokenForCli({ ip: record.ip, ua: record.ua });
    if (!token) {
      await redis.del(approvalKey(requestId));
      return null;
    }

    const code = newOpaqueValue();
    const stored = await redis.set(
      codeKey(code),
      { token, codeChallenge: record.codeChallenge } satisfies CliAuthorizationCode,
      { ex: CLI_CODE_TTL_SECONDS, nx: true },
    );
    if (!stored) throw new Error("Could not store CLI authorization code");

    const redirectUri = callbackRedirect(record, { code });
    await redis.set(approvalKey(requestId), { redirectUri } satisfies CliAuthorizationApproval, {
      ex: CLI_CODE_TTL_SECONDS,
    });
    completed = true;
    await redis.del(requestKey(requestId));
    return { redirectUri };
  } catch {
    if (!completed) await redis.del(approvalKey(requestId)).catch(() => undefined);
    return null;
  }
}

export async function denyCliAuthorization(
  requestId: string,
): Promise<{ redirectUri: string } | null> {
  const redis = loadRedis();
  if (!redis || !REQUEST_ID_PATTERN.test(requestId)) return null;

  try {
    const record = await redis.get<CliAuthorizationRecord>(requestKey(requestId));
    if (!record) return getCompletedApproval(redis, requestId);

    const claimed = await redis.set(approvalKey(requestId), "1", {
      ex: CLI_CODE_TTL_SECONDS,
      nx: true,
    });
    if (!claimed) return getCompletedApproval(redis, requestId);

    const redirectUri = callbackRedirect(record, { error: "access_denied" });
    await redis.set(approvalKey(requestId), { redirectUri } satisfies CliAuthorizationApproval, {
      ex: CLI_CODE_TTL_SECONDS,
    });
    await redis.del(requestKey(requestId));
    return { redirectUri };
  } catch {
    return null;
  }
}

function pkceMatches(verifier: string, challenge: string): boolean {
  if (!PKCE_VERIFIER_PATTERN.test(verifier)) return false;
  const actual = createHash("sha256").update(verifier).digest("base64url");
  const expected = Buffer.from(challenge);
  const received = Buffer.from(actual);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export async function exchangeCliAuthorizationCode(input: {
  code: string;
  codeVerifier: string;
}): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(input.code)) return null;
  const redis = loadRedis();
  if (!redis) return null;

  try {
    const record = await redis.get<CliAuthorizationCode>(codeKey(input.code));
    if (!record || !pkceMatches(input.codeVerifier, record.codeChallenge)) return null;

    const claimed = await redis.set(codeClaimKey(input.code), "1", {
      ex: CLI_CODE_TTL_SECONDS,
      nx: true,
    });
    if (!claimed) return null;
    await redis.del(codeKey(input.code));
    return record.token;
  } catch {
    return null;
  }
}
