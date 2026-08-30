import { useEffect, useRef, useState } from "react";
import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";

import {
  inspectAttendeeAccessLinkFn,
  verifyAttendeeAccessFn,
} from "@/features/attendee-access/access.functions";
import { safeReturnTo } from "@/features/attendee-access/types";
import { SITE_NAME } from "@/lib/shared/config";
import { buildSeoHead } from "@/lib/shared/seo";

type AccessVerificationSearch = {
  returnTo: string;
};

export const Route = createFileRoute("/access_/verify")({
  validateSearch: (search: Record<string, unknown>): AccessVerificationSearch => ({
    returnTo: safeReturnTo(search.returnTo),
  }),
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
  const credential = useRef<{ challengeId: string; token: string } | null>(null);
  const inspectionStarted = useRef(false);
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (inspectionStarted.current) return;
    inspectionStarted.current = true;
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const challengeId = fragment.get("challenge");
    const token = fragment.get("token");

    // Fragments never reach the server. Remove the bearer credential from browser history before
    // sending it to the inspection endpoint or presenting the deliberate confirmation action.
    window.history.replaceState(null, "", "/access/verify");
    if (!challengeId || !token) {
      void navigate({
        to: "/access",
        search: { returnTo: search.returnTo, issue: "invalid" },
        replace: true,
      });
      return;
    }
    credential.current = { challengeId, token };
    let cancelled = false;
    void inspectAttendeeAccessLinkFn({ data: credential.current })
      .then((result) => {
        if (cancelled) return;
        if (result.available) {
          setAvailable(true);
          return;
        }
        credential.current = null;
        void navigate({
          to: "/access",
          search: { returnTo: search.returnTo, issue: result.issue ?? "invalid" },
          replace: true,
        });
      })
      .catch(() => {
        if (!cancelled)
          setMessage("Couldn’t check this link. Open it from the email again to retry.");
      });
    return () => {
      cancelled = true;
    };
  }, [navigate, search.returnTo]);

  async function confirm() {
    if (!credential.current) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await verifyAttendeeAccessFn({
        data: credential.current,
      });
      if (!result.ok) throw new Error(result.error);
      credential.current = null;
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
      <Link
        to="/"
        className="inline-flex min-h-11 w-fit items-center font-mono text-micro theme-muted hover:opacity-60"
      >
        milk &amp; henny
      </Link>
      <div className="my-auto py-14">
        <p className="font-mono text-micro theme-muted">private access</p>
        <h1 className="mt-3 font-serif text-5xl leading-tight">continue signing in</h1>
        <p className="mt-3 max-w-sm font-serif text-lg leading-relaxed theme-muted">
          {available
            ? "This link is valid and has not been used. Continue only if you requested it."
            : "Checking this private link…"}
        </p>
        <button
          type="button"
          disabled={!available || busy}
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
