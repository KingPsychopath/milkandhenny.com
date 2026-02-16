"use client";

import { useCallback, useRef } from "react";

type EnsureStepUpResult =
  | { ok: true; token: string }
  | { ok: false; cancelled: true }
  | { ok: false; error: string };

/**
 * Shared client-side admin step-up helpers.
 *
 * Used by:
 * - `app/admin/AdminDashboard.tsx`
 * - guest management (admin-only actions from `/guestlist`)
 */

export function useAdminAuth() {
  // Step-up is operational state; keep it in refs to avoid re-render churn.
  const stepUpTokenRef = useRef<string>("");
  const stepUpExpiryMsRef = useRef<number>(0);

  const authFetch = useCallback(
    async (url: string, options: RequestInit = {}) => {
      const res = await fetch(url, {
        ...options,
        headers: {
          ...(options.headers as Record<string, string>),
        },
      });
      if (res.status === 401) {
        // Auth is cookie-based (httpOnly). If the cookie is missing/expired,
        // bounce back to the server auth gate.
        window.location.assign("/admin");
      }
      return res;
    },
    []
  );

  const ensureStepUpToken = useCallback(async (): Promise<EnsureStepUpResult> => {
    if (stepUpTokenRef.current && Date.now() < stepUpExpiryMsRef.current - 5_000) {
      return { ok: true, token: stepUpTokenRef.current };
    }

    const password = window.prompt("Re-enter your admin password to confirm this action.");
    if (!password) return { ok: false, cancelled: true };

    const res = await authFetch("/api/admin/step-up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    const data = await res.json().catch(() => ({}));
    const token = typeof data.token === "string" ? (data.token as string) : "";
    if (!res.ok || !token) {
      return { ok: false, error: (data.error as string) || "Step-up verification failed" };
    }

    const expiresInSeconds =
      typeof data.expiresInSeconds === "number" && data.expiresInSeconds > 0 ? (data.expiresInSeconds as number) : 300;

    stepUpTokenRef.current = token;
    stepUpExpiryMsRef.current = Date.now() + expiresInSeconds * 1000;
    return { ok: true, token };
  }, [authFetch]);

  const withStepUpHeaders = useCallback(
    (token: string, extra?: Record<string, string>): Record<string, string> => ({
      ...(extra ?? {}),
      "x-admin-step-up": token,
    }),
    []
  );

  return {
    authFetch,
    ensureStepUpToken,
    withStepUpHeaders,
  };
}

