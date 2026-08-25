import { FormEvent, useCallback, useEffect, useState } from "react";

import {
  GLOBAL_ADMIN_ROLE_PRESETS,
  type GlobalAdminRole,
} from "@/features/attendee-operations/types";

const ADMIN_ROLE_PRESETS = Object.keys(GLOBAL_ADMIN_ROLE_PRESETS) as GlobalAdminRole[];

type AuthFetch = (input: string, init?: RequestInit) => Promise<Response>;
type Grant = {
  id: string;
  personId: string;
  name?: string;
  emailHint?: string;
  rolePreset: GlobalAdminRole;
  status: string;
  expiresAt?: string;
  activatedAt?: string;
  createdAt: string;
};

export function AdminAccessSettings({
  authFetch,
  onError,
  onStatus,
  ensureStepUpToken,
  withStepUpHeaders,
}: {
  authFetch: AuthFetch;
  onError: (message: string) => void;
  onStatus: (message: string) => void;
  ensureStepUpToken: () => Promise<{ ok: true; token: string } | { ok: false }>;
  withStepUpHeaders: (token: string, headers?: Record<string, string>) => Record<string, string>;
}) {
  const [grants, setGrants] = useState<Grant[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [rolePreset, setRolePreset] = useState<Grant["rolePreset"]>("admin");
  const [expiresAt, setExpiresAt] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const response = await authFetch("/api/admin/operations/access");
    const body = (await response.json().catch(() => ({}))) as {
      grants?: Grant[];
      error?: string;
    };
    if (!response.ok) throw new Error(body.error ?? "Admin access could not be loaded");
    setGrants(body.grants ?? []);
  }, [authFetch]);

  useEffect(() => {
    void load().catch((error) =>
      onError(error instanceof Error ? error.message : "Admin access could not be loaded"),
    );
  }, [load, onError]);

  async function invite(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const step = await ensureStepUpToken();
      if (!step.ok) return;
      const response = await authFetch("/api/admin/operations/access", {
        method: "POST",
        headers: withStepUpHeaders(step.token, { "content-type": "application/json" }),
        body: JSON.stringify({
          name,
          email,
          rolePreset,
          reason,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        emailQueued?: boolean;
      };
      if (!response.ok) throw new Error(body.error ?? "Admin invitation could not be created");
      onStatus(
        body.emailQueued
          ? "Admin invitation queued. Access remains pending until the mailbox accepts it."
          : "Invitation created, but its email needs attention.",
      );
      setName("");
      setEmail("");
      setReason("");
      setExpiresAt("");
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Admin invitation could not be created");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(grant: Grant) {
    const revocationReason = window
      .prompt(`Why are you revoking ${grant.emailHint ?? grant.name ?? "this grant"}?`)
      ?.trim();
    if (!revocationReason) return;
    setBusy(true);
    try {
      const step = await ensureStepUpToken();
      if (!step.ok) return;
      const response = await authFetch("/api/admin/operations/access", {
        method: "DELETE",
        headers: withStepUpHeaders(step.token, { "content-type": "application/json" }),
        body: JSON.stringify({ grantId: grant.id, reason: revocationReason }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Admin access could not be revoked");
      onStatus("Admin access revoked immediately.");
      await load();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Admin access could not be revoked");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="border-t theme-border pt-8" aria-labelledby="named-admin-heading">
      <p className="font-mono text-micro uppercase tracking-widest theme-muted">
        people and access
      </p>
      <h3 id="named-admin-heading" className="mt-2 font-serif text-2xl">
        Named administrators
      </h3>
      <p className="mt-3 max-w-2xl font-mono text-xs leading-relaxed theme-muted">
        Personal authority follows a verified person. The root password remains the recovery and
        step-up authority for issuing or revoking it.
      </p>
      <form onSubmit={(event) => void invite(event)} className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="font-mono text-xs">
          name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
            className="mt-2 min-h-11 w-full border theme-border bg-background px-3"
          />
        </label>
        <label className="font-mono text-xs">
          verified email
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            autoComplete="email"
            className="mt-2 min-h-11 w-full border theme-border bg-background px-3"
          />
        </label>
        <label className="font-mono text-xs">
          role
          <select
            value={rolePreset}
            onChange={(event) => setRolePreset(event.target.value as Grant["rolePreset"])}
            className="mt-2 min-h-11 w-full border theme-border bg-background px-3"
          >
            {ADMIN_ROLE_PRESETS.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </label>
        <label className="font-mono text-xs">
          invitation expires
          <input
            type="datetime-local"
            value={expiresAt}
            onChange={(event) => setExpiresAt(event.target.value)}
            className="mt-2 min-h-11 w-full border theme-border bg-background px-3"
          />
        </label>
        <label className="font-mono text-xs sm:col-span-2">
          reason
          <input
            required
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="mt-2 min-h-11 w-full border theme-border bg-background px-3"
          />
        </label>
        <button
          disabled={busy}
          className="min-h-11 border border-foreground px-4 font-mono text-xs hover:opacity-70 disabled:opacity-50"
        >
          invite administrator
        </button>
      </form>
      <ul className="mt-6 divide-y border-y theme-border">
        {grants.map((grant) => (
          <li key={grant.id} className="flex flex-wrap items-center gap-3 py-4">
            <div className="min-w-0 flex-1">
              <p className="font-serif">{grant.name ?? grant.emailHint ?? "Unnamed person"}</p>
              <p className="mt-1 font-mono text-micro theme-muted">
                {grant.rolePreset} · {grant.status}
                {grant.emailHint ? ` · ${grant.emailHint}` : ""}
              </p>
            </div>
            {grant.status !== "revoked" && grant.rolePreset !== "owner" ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void revoke(grant)}
                className="min-h-11 font-mono text-xs underline hover:opacity-70 disabled:opacity-50"
              >
                revoke
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
