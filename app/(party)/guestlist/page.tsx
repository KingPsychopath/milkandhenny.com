import Link from "next/link";
import { cookies } from "next/headers";
import { SITE_NAME } from "@/lib/shared/config";
import { getGuests } from "@/features/guests/store";
import { requireAuthFromServerContext } from "@/features/auth/server";
import { getAuthCookieName } from "@/features/auth/cookies";
import { signInStaffAction } from "@/features/auth/actions";
import { GuestListClient } from "./GuestListClient";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function GuestListPage({ searchParams }: PageProps) {
  const params = (await searchParams) ?? {};
  const authFailed = params.auth === "failed";

  const jar = await cookies();
  const staffCookie = jar.get(getAuthCookieName("staff"))?.value ?? "";
  const adminCookie = jar.get(getAuthCookieName("admin"))?.value ?? "";
  const hasAnyToken = !!staffCookie || !!adminCookie;

  const auth = hasAnyToken ? await requireAuthFromServerContext("staff") : null;
  const isAuthed = auth?.ok === true;

  if (!isAuthed) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-zinc-950 via-zinc-900 to-stone-900 flex items-center justify-center p-6">
        <main id="main" className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="w-16 h-16 rounded-2xl bg-amber-600 flex items-center justify-center mx-auto mb-4 shadow-lg">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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

          <form action={signInStaffAction} className="space-y-4">
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
            <Link href="/party" className="text-zinc-500 hover:text-amber-400 text-sm transition-colors">
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

  const initialGuests = await getGuests();

  return <GuestListClient initialGuests={initialGuests} />;
}

