import { createFileRoute } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { SITE_NAME } from "@/lib/shared/config";
import { buildSeoHead } from "@/lib/shared/seo";
import {
  approveCliAuth,
  denyCliAuth,
  getCliAuthPage,
  signInAdminForCli,
} from "@/features/auth/cli-auth.functions";

export const Route = createFileRoute("/admin/cli-auth")({
  validateSearch: (search: Record<string, unknown>) => ({
    request: typeof search.request === "string" ? search.request : "",
    auth: typeof search.auth === "string" ? search.auth : undefined,
  }),
  loaderDeps: ({ search }) => ({ requestId: search.request }),
  loader: {
    handler: ({ deps }) => getCliAuthPage({ data: { requestId: deps.requestId } }),
    staleReloadMode: "blocking",
  },
  staleTime: 0,
  gcTime: 0,
  preload: false,
  component: CliAuthPage,
  head: () =>
    buildSeoHead({
      title: `CLI sign-in — ${SITE_NAME}`,
      description: "Approve a Milk & Henny command-line session.",
      path: "/admin/cli-auth",
      robots: "noindex, nofollow",
      referrer: "no-referrer",
    }),
});

function CliAuthPage() {
  const search = Route.useSearch();
  const page = Route.useLoaderData();
  const [pendingAction, setPendingAction] = useState<"sign-in" | "approve" | "deny" | null>(null);

  async function handleApprove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPendingAction("approve");
    try {
      const result = await approveCliAuth({ data: { requestId: search.request } });
      if (result.ok) {
        window.location.assign(result.redirectUri);
        return;
      }
      window.location.assign(
        `/admin/cli-auth?request=${encodeURIComponent(search.request)}&auth=${result.reason}`,
      );
    } catch {
      setPendingAction(null);
      window.location.assign(
        `/admin/cli-auth?request=${encodeURIComponent(search.request)}&auth=expired`,
      );
    }
  }

  if (!page.valid) {
    return (
      <main id="main" className="min-h-dvh flex items-center justify-center px-6">
        <div className="w-full max-w-sm text-center space-y-3">
          <h1 className="font-mono font-bold tracking-tighter text-lg">{SITE_NAME}</h1>
          <p className="font-mono text-sm theme-muted">
            This CLI sign-in link is invalid or expired.
          </p>
          <p className="font-mono text-xs theme-muted">
            Return to your terminal and start sign-in again.
          </p>
        </div>
      </main>
    );
  }

  const message =
    search.auth === "failed"
      ? "That password was not accepted."
      : search.auth === "required"
        ? "Sign in before approving the CLI session."
        : search.auth === "expired"
          ? "This CLI sign-in request has expired."
          : null;
  const isStepUp = page.purpose === "step-up";
  const actionLabel = isStepUp ? "approve protected CLI action" : "approve CLI sign-in";

  if (!page.authenticated) {
    return (
      <main id="main" className="min-h-dvh flex items-center justify-center px-6">
        <div className="w-full max-w-sm text-center">
          <h1 className="font-mono font-bold tracking-tighter text-lg">{SITE_NAME}</h1>
          <p className="font-mono text-sm theme-muted mt-1 mb-10">{actionLabel}</p>
          <p className="font-mono text-xs leading-relaxed theme-muted mb-6">
            {isStepUp
              ? "Sign in here to review a protected terminal action. Your password stays in this browser and is never sent to the CLI."
              : "The terminal is asking for a short-lived admin session. Your password stays in this browser and is never sent to the CLI."}
          </p>

          <form
            action={signInAdminForCli.url}
            method="post"
            encType="multipart/form-data"
            onSubmit={() => setPendingAction("sign-in")}
          >
            <input type="hidden" name="request" value={search.request} />
            <label htmlFor="cli-admin-password" className="sr-only">
              admin password
            </label>
            <input
              id="cli-admin-password"
              name="password"
              type="password"
              placeholder="admin password"
              autoFocus
              required
              aria-invalid={message ? "true" : undefined}
              className="w-full bg-transparent border-b border-[var(--stone-200)] focus:border-[var(--foreground)] outline-none font-mono text-sm text-center py-2 tracking-wider transition-colors placeholder:text-[var(--stone-400)]"
            />
            <button
              type="submit"
              className="mt-6 min-h-12 w-full rounded-md bg-[var(--foreground)] px-4 py-2.5 font-mono text-sm lowercase tracking-wide text-[var(--background)] hover:opacity-90 transition-opacity"
            >
              {pendingAction === "sign-in" ? "checking…" : "continue"}
            </button>
          </form>
          {message ? (
            <p className="mt-4 font-mono text-xs text-[var(--prose-hashtag)]">{message}</p>
          ) : null}
        </div>
      </main>
    );
  }

  return (
    <main id="main" className="min-h-dvh flex items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="font-mono font-bold tracking-tighter text-lg">{SITE_NAME}</h1>
        <p className="font-mono text-sm theme-muted mt-1 mb-8">{actionLabel}</p>
        <div className="border-t theme-border pt-5 space-y-3">
          <p className="font-mono text-sm">
            {page.client} is requesting {isStepUp ? "approval for a protected action" : "access"}.
          </p>
          <p className="font-mono text-xs leading-relaxed theme-muted">
            {isStepUp
              ? "This creates a one-time, short-lived approval bound to the terminal session that opened this page. It does not create another admin session."
              : "This creates one admin JWT for the terminal. It expires in one hour and can be revoked from the admin session list."}
          </p>
          <p className="font-mono text-xs theme-muted">
            Request expires at {new Date(page.expiresAt * 1000).toLocaleTimeString()}.
          </p>
        </div>

        <form method="post" onSubmit={handleApprove}>
          <input type="hidden" name="request" value={search.request} />
          <button
            type="submit"
            disabled={pendingAction !== null}
            aria-busy={pendingAction === "approve"}
            className="mt-8 min-h-12 w-full rounded-md bg-[var(--foreground)] px-4 py-2.5 font-mono text-sm lowercase tracking-wide text-[var(--background)] hover:opacity-90 transition-opacity disabled:cursor-wait disabled:opacity-60"
          >
            {pendingAction === "approve"
              ? "approving…"
              : isStepUp
                ? "approve protected action"
                : "approve terminal"}
          </button>
        </form>
        <form action={denyCliAuth.url} method="post" onSubmit={() => setPendingAction("deny")}>
          <input type="hidden" name="request" value={search.request} />
          <button
            type="submit"
            disabled={pendingAction !== null}
            aria-busy={pendingAction === "deny"}
            className="mt-3 min-h-12 w-full rounded-md border border-[var(--stone-300)] px-4 py-2.5 font-mono text-sm lowercase tracking-wide hover:opacity-70 transition-opacity disabled:cursor-wait disabled:opacity-60"
          >
            {pendingAction === "deny" ? "cancelling…" : "cancel"}
          </button>
        </form>
      </div>
    </main>
  );
}
