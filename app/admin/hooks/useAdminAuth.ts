"use client";

import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import { getStored, removeStored, setStored, type StorageKeyName } from "@/lib/client/storage";

type SignInResult =
  | { ok: true; token: string }
  | { ok: false; error: string; status?: number };

type EnsureStepUpResult =
  | { ok: true; token: string }
  | { ok: false; cancelled: true }
  | { ok: false; error: string };

/**
 * Shared client-side admin session + step-up helpers.
 *
 * Used by:
 * - `app/admin/AdminDashboard.tsx`
 * - guest management (admin-only actions from `/guestlist`)
 */

const STORAGE_CHANGE_EVENT = "mah:storage-change";

function emitStorageChange() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(STORAGE_CHANGE_EVENT));
}

function useHydrated(): boolean {
  // Server snapshot: false (matches SSR HTML).
  // Client snapshot: true (flips immediately after hydration without effects).
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
}

function useStoredString(name: StorageKeyName): string {
  return useSyncExternalStore(
    (onStoreChange) => {
      if (typeof window === "undefined") return () => {};
      const handler = () => onStoreChange();
      window.addEventListener("storage", handler);
      window.addEventListener(STORAGE_CHANGE_EVENT, handler);
      return () => {
        window.removeEventListener("storage", handler);
        window.removeEventListener(STORAGE_CHANGE_EVENT, handler);
      };
    },
    () => getStored(name) ?? "",
    () => ""
  );
}

export function useAdminAuth() {
  const mounted = useHydrated();
  const adminToken = useStoredString("adminToken");

  // Step-up is operational state; keep it in refs to avoid re-render churn.
  const stepUpTokenRef = useRef<string>("");
  const stepUpExpiryMsRef = useRef<number>(0);

  const isAuthed = useMemo(() => !!adminToken, [adminToken]);

  const signOut = useCallback(() => {
    removeStored("adminToken");
    emitStorageChange();
    stepUpTokenRef.current = "";
    stepUpExpiryMsRef.current = 0;
  }, []);

  const authFetch = useCallback(
    async (url: string, options: RequestInit = {}) => {
      const res = await fetch(url, {
        ...options,
        headers: {
          ...(options.headers as Record<string, string>),
          Authorization: `Bearer ${adminToken}`,
        },
      });
      if (res.status === 401) {
        signOut();
      }
      return res;
    },
    [adminToken, signOut]
  );

  const signIn = useCallback(async (password: string): Promise<SignInResult> => {
    const trimmed = password.trim();
    if (!trimmed) return { ok: false, error: "Password required" };

    try {
      const res = await fetch("/api/admin/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: trimmed }),
      });

      const data = await res.json().catch(() => ({}));
      const token = typeof data.token === "string" ? (data.token as string) : "";
      if (!res.ok || !token) {
        return {
          ok: false,
          status: res.status,
          error: res.status === 429 ? "Too many attempts. Please try again in 15 minutes." : "Incorrect password",
        };
      }

      setStored("adminToken", token);
      emitStorageChange();
      return { ok: true, token };
    } catch {
      return { ok: false, error: "Connection error" };
    }
  }, []);

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
    mounted,
    adminToken,
    isAuthed,
    authFetch,
    signIn,
    signOut,
    ensureStepUpToken,
    withStepUpHeaders,
  };
}

