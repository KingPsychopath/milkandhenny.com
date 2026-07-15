import { Link, createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getCookie, getRequest } from "@tanstack/react-start/server";
import { SITE_NAME } from "@/lib/shared/config";
import { getGuests } from "@/features/guests/store";
import { authenticateRequest } from "@/features/auth/auth.server";
import { getAuthCookieName } from "@/features/auth/cookies";
import { signInStaff } from "@/features/auth/auth.functions";
import { GuestListClient } from "@/features/guests/ui/GuestListClient";

const getGuestListPage = createServerFn({ method: "GET" }).handler(async () => {
  const request = getRequest();
  const hasAnyToken = Boolean(
    getCookie(getAuthCookieName("staff")) || getCookie(getAuthCookieName("admin")),
  );
  const auth = hasAnyToken ? await authenticateRequest(request, "staff") : null;
  if (!auth?.ok) return { isAuthed: false as const, guests: [] };
  return { isAuthed: true as const, guests: await getGuests() };
});

export const Route = createFileRoute("/guestlist")({
  validateSearch: (search: Record<string, unknown>) => ({
    auth: search.auth === "failed" ? ("failed" as const) : undefined,
  }),
  loader: () => getGuestListPage(),
  component: GuestListPage,
  head: () => ({ meta: [{ title: `Guest list — ${SITE_NAME}` }] }),
});

function GuestListPage() {
  const { isAuthed, guests } = Route.useLoaderData();
  const authFailed = Route.useSearch().auth === "failed";

  if (!isAuthed) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-zinc-950 via-zinc-900 to-stone-900 flex items-center justify-center p-6">
        <main id="main" className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="w-16 h-16 rounded-2xl bg-amber-600 flex items-center justify-center mx-auto mb-4 shadow-lg">
              <svg
                className="w-8 h-8 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-white mb-2">Staff Access</h1>
            <p className="text-zinc-400">Enter PIN to access guest list</p>
          </div>

          {authFailed && <p className="text-red-400 text-center text-sm mb-3">Incorrect PIN</p>}

          <form
            action={signInStaff.url}
            method="post"
            encType="multipart/form-data"
            className="space-y-4"
          >
            <input
              name="pin"
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={4}
              placeholder="••••"
              className={`w-full px-6 py-4 text-center text-3xl font-mono tracking-pin bg-white/10 border rounded-2xl text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-amber-500 transition-all ${
                authFailed ? "border-red-500 bg-red-500/10" : "border-white/20"
              }`}
              autoFocus
              required
            />

            <button
              type="submit"
              className="w-full py-4 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 disabled:opacity-50 text-zinc-950 font-bold text-lg rounded-2xl transition-all"
            >
              Enter
            </button>
          </form>

          <div className="mt-8 text-center">
            <Link
              to="/party"
              className="text-zinc-500 hover:text-amber-400 text-sm transition-colors"
            >
              ← Back to party
            </Link>
          </div>

          <p className="mt-6 text-center text-xs theme-muted font-mono tracking-wide">
            {SITE_NAME.toLowerCase()}
          </p>
        </main>
      </div>
    );
  }

  return <GuestListClient initialGuests={guests} />;
}
