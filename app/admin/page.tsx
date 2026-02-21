import type { Metadata } from "next";
import { SITE_NAME } from "@/lib/shared/config";
import { AdminDashboard } from "./AdminDashboard";
import { requireAuthFromServerContext } from "@/features/auth/server";
import { signInAdminAction } from "@/features/auth/actions";

export const metadata: Metadata = {
  title: `admin · ${SITE_NAME}`,
  description: "Admin dashboard for guestlist, votes, uploads, and editor tooling.",
  robots: { index: false, follow: false },
};

export default async function AdminPage() {
  const auth = await requireAuthFromServerContext("admin");
  const isAuthed = auth.ok;

  if (!isAuthed) {
    return (
      <main id="main" className="min-h-dvh flex items-center justify-center px-6">
        <form action={signInAdminAction} className="w-full max-w-xs text-center">
          <h1 className="font-mono font-bold tracking-tighter text-lg">{SITE_NAME}</h1>
          <p className="font-mono text-sm theme-muted mt-1 mb-8">admin</p>

          <input
            name="password"
            type="password"
            placeholder="admin password"
            autoFocus
            required
            className="w-full bg-transparent border-b border-[var(--stone-200)] focus:border-[var(--foreground)] outline-none font-mono text-sm text-center py-2 tracking-wider transition-colors placeholder:text-[var(--stone-400)]"
          />

          <button
            type="submit"
            className="mt-6 w-full bg-[var(--foreground)] text-[var(--background)] font-mono text-sm lowercase tracking-wide py-2.5 rounded-md hover:opacity-90 transition-opacity"
          >
            unlock
          </button>
        </form>
      </main>
    );
  }

  return (
    <main id="main" className="min-h-dvh">
      <AdminDashboard />
    </main>
  );
}
