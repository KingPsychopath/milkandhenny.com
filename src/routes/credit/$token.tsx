import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";

import {
  claimCreditFn,
  creditClaimAccountStateFn,
  inspectCreditClaimFn,
} from "@/features/credits/credits.functions";
import type { CreditClaim } from "@/features/credits/types";
import { SITE_NAME } from "@/lib/shared/config";
import { buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/credit/$token")({
  loader: {
    handler: async ({ params }) => {
      const [claim, accountState] = await Promise.all([
        inspectCreditClaimFn({ data: { token: params.token } }),
        creditClaimAccountStateFn({ data: { token: params.token } }),
      ]);
      return { claim, accountState };
    },
  },
  staleTime: 0,
  gcTime: 0,
  preload: false,
  component: CreditClaimPage,
  head: () =>
    buildSeoHead({
      title: `Your credit — ${SITE_NAME}`,
      description: "Claim a private Milk & Henny event credit.",
      path: "/credit",
      robots: "noindex, nofollow",
      referrer: "no-referrer",
    }),
});

function money(amountMinor: number, currency: string) {
  return new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amountMinor / 100);
}

function CreditClaimPage() {
  const initial = Route.useLoaderData();
  const { token } = Route.useParams();
  const [claim, setClaim] = useState<CreditClaim | null>(initial.claim);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function saveCredit() {
    setBusy(true);
    setError("");
    try {
      const result = await claimCreditFn({ data: { token } });
      if (!result) setError("This private link is not available.");
      else setClaim(result);
    } catch {
      setError("We could not save the credit. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const total = claim ? money(claim.totalMinor, claim.currency) : null;
  return (
    <main id="main" className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col px-6 py-14">
      <Link to="/" className="inline-flex min-h-11 items-center font-mono text-micro theme-muted">
        ← milk &amp; henny
      </Link>
      <section className="my-auto border-y theme-border py-10">
        <p className="font-mono text-micro uppercase tracking-widest theme-muted">
          a little thank you
        </p>
        <h1 className="mt-3 max-w-xl font-serif text-4xl leading-tight sm:text-5xl">
          {claim?.state === "claimed" ? `${total} is yours.` : "Credit for the next one."}
        </h1>
        {!claim ? (
          <p className="mt-5 font-serif text-lg">This private link is not available.</p>
        ) : claim.state === "available" ? (
          <>
            <p className="mt-5 max-w-lg font-serif text-lg leading-relaxed">
              Save {total} for a future Milk &amp; Henny event. That is {claim.units} ×{" "}
              {money(claim.amountMinor, claim.currency)}—one credit for each eligible ticket.
            </p>
            <p className="mt-4 font-mono text-xs leading-relaxed theme-muted">
              It will be kept against {claim.emailHint}. No code to remember and no account setup
              now.
            </p>
            <button
              type="button"
              onClick={() => void saveCredit()}
              disabled={busy}
              className="mt-7 min-h-12 rounded-md bg-foreground px-5 py-3 font-mono text-sm text-background transition-opacity hover:opacity-85 disabled:opacity-50"
            >
              {busy
                ? "saving…"
                : claim.units === 1
                  ? `save my ${total} credit`
                  : `save my ${claim.units} × ${money(claim.amountMinor, claim.currency)} credits`}
            </button>
          </>
        ) : claim.state === "claimed" ? (
          <>
            <p className="mt-5 max-w-lg font-serif text-lg leading-relaxed">
              Your credit is saved against {claim.emailHint}. We’ll put it on your private booking
              link when the next eligible event opens.
            </p>
            <p className="mt-4 font-mono text-xs theme-muted">
              {claim.units} {claim.units === 1 ? "credit" : "credits"} · one per admission ticket ·
              no code needed
            </p>
            {initial.accountState === "linked" ? (
              <Link to="/my" className="mh-action mh-action--secondary mt-7">
                view it in your account →
              </Link>
            ) : (
              <div className="mt-7 border-t theme-border pt-5">
                <p className="max-w-lg font-mono text-xs leading-relaxed theme-muted">
                  {initial.accountState === "different-account"
                    ? `This belongs to ${claim.emailHint}. Sign in with that address to see it in your account.`
                    : `Want it visible in your account? Sign in or create one with ${claim.emailHint}. Your credit is already safe if you skip this.`}
                </p>
                <Link
                  to="/access"
                  search={{ returnTo: "/my" }}
                  className="mh-action mh-action--secondary mt-4"
                >
                  keep it with my account →
                </Link>
              </div>
            )}
          </>
        ) : (
          <p className="mt-5 max-w-lg font-serif text-lg leading-relaxed">
            {claim.state === "expired"
              ? "The claim window for this credit has ended."
              : "This credit is no longer available."}
          </p>
        )}
        {error ? (
          <p role="alert" className="mt-5 font-mono text-xs text-[var(--status-danger)]">
            {error}
          </p>
        ) : null}
      </section>
      <p className="font-mono text-micro leading-relaxed theme-faint">
        Credits are not cash and cannot reduce more admission tickets than the number shown.
      </p>
    </main>
  );
}
