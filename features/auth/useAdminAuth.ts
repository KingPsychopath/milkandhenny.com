"use client";

import { useCallback, useRef } from "react";
import { useActionDialog } from "@/hooks/useActionDialog";

type EnsureStepUpResult =
  | { ok: true; token: string }
  | { ok: false; cancelled: true }
  | { ok: false; error: string };

/**
 * Shared client-side admin step-up helpers.
 *
 * Used by:
 * - `app/admin/AdminDashboard.tsx`
 */

export function useAdminAuth() {
  // Step-up is operational state; keep it in refs to avoid re-render churn.
  const stepUpTokenRef = useRef<string>("");
  const stepUpExpiryMsRef = useRef<number>(0);
  const { prompt: promptStepUp, dialog: authDialog, isOpen: authDialogOpen } = useActionDialog();

  const authFetch = useCallback(async (url: string, options: RequestInit = {}) => {
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
  }, []);

  const ensureStepUpToken = useCallback(async (): Promise<EnsureStepUpResult> => {
    if (stepUpTokenRef.current && Date.now() < stepUpExpiryMsRef.current - 5_000) {
      return { ok: true, token: stepUpTokenRef.current };
    }

    if (import.meta.env.DEV) {
      return { ok: true, token: "local-dev-step-up" };
    }

    const password = await promptStepUp({
      eyebrow: "security check",
      title: "Confirm it’s you",
      description: "Re-enter your admin password to continue with this protected action.",
      label: "Admin password",
      inputType: "password",
      autoComplete: "current-password",
      confirmLabel: "verify",
      required: true,
    });
    if (!password) return { ok: false, cancelled: true };

    const res = await authFetch("/api/admin/step-up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    const data = (await res.json().catch(() => ({}))) as {
      token?: unknown;
      error?: unknown;
      expiresInSeconds?: unknown;
    };
    const token = typeof data.token === "string" ? data.token : "";
    if (!res.ok || !token) {
      return {
        ok: false,
        error: typeof data.error === "string" ? data.error : "Step-up verification failed",
      };
    }

    const expiresInSeconds =
      typeof data.expiresInSeconds === "number" && data.expiresInSeconds > 0
        ? data.expiresInSeconds
        : 300;

    stepUpTokenRef.current = token;
    stepUpExpiryMsRef.current = Date.now() + expiresInSeconds * 1000;
    return { ok: true, token };
  }, [authFetch, promptStepUp]);

  const withStepUpHeaders = useCallback(
    (token: string, extra?: Record<string, string>): Record<string, string> => ({
      ...(extra ?? {}),
      "x-admin-step-up": token,
    }),
    [],
  );

  return {
    authFetch,
    ensureStepUpToken,
    withStepUpHeaders,
    authDialog,
    authDialogOpen,
  };
}
