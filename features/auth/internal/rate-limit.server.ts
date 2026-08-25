import {
  clearRateLimit as clearSharedRateLimit,
  reserveRateLimit,
} from "@/lib/platform/rate-limit.server";
import type { AuthRole } from "./token-session.server";

/**
 * Auth-specific throttles, expressed on the shared limiter in
 * `lib/platform/rate-limit.server.ts`. Login attempts carry a global cap so a
 * distributed guessing run cannot sidestep the per-IP window; step-up
 * attempts are keyed to the parent session instead of the caller's address.
 */

export const MAX_ATTEMPTS = 5;
export const LOCKOUT_SECONDS = 900;

function loginLimitName(role: AuthRole): string {
  return `auth:${role}`;
}

export async function checkRateLimit(
  role: AuthRole,
  ip: string,
): Promise<{ allowed: boolean; remaining: number; backendAvailable: boolean }> {
  const decision = await reserveRateLimit({
    name: loginLimitName(role),
    identity: ip,
    limit: MAX_ATTEMPTS,
    windowSeconds: LOCKOUT_SECONDS,
    globalLimit: MAX_ATTEMPTS * 20,
  });
  return {
    allowed: decision.allowed,
    remaining: decision.remaining,
    backendAvailable: decision.backendAvailable,
  };
}

export async function clearRateLimit(role: AuthRole, ip: string): Promise<void> {
  await clearSharedRateLimit(loginLimitName(role), ip);
}

export async function reserveStepUpAttempt(
  parentJti: string,
): Promise<{ allowed: boolean; remaining: number; backendAvailable: boolean }> {
  const decision = await reserveRateLimit({
    name: "auth:step-up",
    identity: parentJti,
    limit: MAX_ATTEMPTS,
    windowSeconds: LOCKOUT_SECONDS,
  });
  return {
    allowed: decision.allowed,
    remaining: decision.remaining,
    backendAvailable: decision.backendAvailable,
  };
}

export async function clearStepUpFailures(parentJti: string): Promise<void> {
  await clearSharedRateLimit("auth:step-up", parentJti);
}
