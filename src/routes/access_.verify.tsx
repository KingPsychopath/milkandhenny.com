import { useEffect, useState } from "react";
import { createFileRoute, Link, redirect, useNavigate, useRouter } from "@tanstack/react-router";

import {
  inspectAttendeeAccessLinkFn,
  verifyAttendeeAccessFn,
} from "@/features/attendee-access/access.functions";
import { safeReturnTo } from "@/features/attendee-access/types";
import { SITE_NAME } from "@/lib/shared/config";
import { buildSeoHead } from "@/lib/shared/seo";

type AccessVerificationSearch = {
  returnTo: string;
  challenge?: string;
  token?: string;
};

export const Route = createFileRoute("/access_/verify")({
  validateSearch: (search: Record<string, unknown>): AccessVerificationSearch => ({
    returnTo: safeReturnTo(search.returnTo),
    challenge: typeof search.challenge === "string" ? search.challenge : undefined,
    token: typeof search.token === "string" ? search.token : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    const result = await inspectAttendeeAccessLinkFn({
      data: { challengeId: deps.challenge, token: deps.token },
    });
    if (!result.available) {
      throw redirect({
        to: "/access",
        search: { returnTo: deps.returnTo, issue: result.issue ?? "invalid" },
        replace: true,
      });
    }
    return { available: true as const };
  },
  staleTime: 0,
  gcTime: 0,
  preload: false,
  head: () =>
    buildSeoHead({
      title: `Confirm sign-in — ${SITE_NAME}`,
      description: "Confirm a private Milk & Henny access link.",
      path: "/access/verify",
      robots: "noindex, nofollow",
      referrer: "no-referrer",
    }),
  component: AccessVerificationPage,
});

function AccessVerificationPage() {
  const navigate = useNavigate();
  const router = useRouter();
  const search = Route.useSearch();
  const [hydrated, setHydrated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => setHydrated(true), []);

  async function confirm() {
    setBusy(true);
    setMessage("");
    try {
      const result = await verifyAttendeeAccessFn({
        data: { challengeId: search.challenge, token: search.token },
      });
      if (!result.ok) throw new Error(result.error);
      window.history.replaceState(null, "", "/access/verify");
      router.clearCache();
      await router.invalidate();
      await navigate({ to: result.value.returnTo ?? search.returnTo, replace: true });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "That link could not be verified");
      setBusy(false);
    }
  }

  return (
    <main id="main" className="mx-auto flex min-h-screen w-full max-w-md flex-col px-6 py-12">
      <Link to="/" className="w-fit font-mono text-micro theme-muted hover:opacity-60">
        milk &amp; henny
      </Link>
      <div className="my-auto py-14">
        <p className="font-mono text-micro theme-muted">private access</p>
        <h1 className="mt-3 font-serif text-5xl leading-tight">continue signing in</h1>
        <p className="mt-3 max-w-sm font-serif text-lg leading-relaxed theme-muted">
          This link is valid and has not been used. Continue only if you requested it.
        </p>
        <button
          type="button"
          disabled={!hydrated || busy}
          aria-busy={busy}
          onClick={() => void confirm()}
          className="mh-action mt-8 w-full disabled:opacity-45"
        >
          {busy ? "signing in…" : "continue securely"}
        </button>
        <Link
          to="/access"
          search={{ returnTo: search.returnTo }}
          replace
          className="mh-action mh-action--quiet mt-3"
        >
          cancel
        </Link>
        {message ? (
          <p role="alert" className="mt-5 font-mono text-xs theme-muted">
            {message}
          </p>
        ) : null}
      </div>
    </main>
  );
}
