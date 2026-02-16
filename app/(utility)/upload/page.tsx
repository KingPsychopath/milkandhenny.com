import type { Metadata } from "next";
import { SITE_NAME } from "@/lib/shared/config";
import { UploadDashboard } from "./UploadDashboard";
import { requireAuthFromServerContext } from "@/features/auth/server";
import { signInUploadAction } from "@/features/auth/actions";
import Link from "next/link";

export const metadata: Metadata = {
  title: `upload · ${SITE_NAME}`,
  description: "Upload files to transfers or blog.",
  robots: { index: false, follow: false },
};

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function UploadPage({ searchParams }: PageProps) {
  const params = (await searchParams) ?? {};
  const authFailed = params.auth === "failed";

  // Gate: upload or admin can access the page.
  const auth = await requireAuthFromServerContext("upload");
  // Blog tab is admin-only; check admin separately so we don't use "upload" token when both cookies exist.
  const adminAuth = await requireAuthFromServerContext("admin");
  const isAdmin = adminAuth.ok;

  if (!auth.ok) {
    return (
      <main id="main" className="min-h-dvh flex items-center justify-center px-6">
        <form action={signInUploadAction} className="w-full max-w-xs text-center">
          <h1 className="font-mono font-bold tracking-tighter text-lg">milk & henny</h1>
          <p className="font-mono text-sm theme-muted mt-1 mb-8">upload</p>

          <input
            name="pin"
            type="password"
            placeholder="enter pin"
            autoFocus
            required
            className={`w-full bg-transparent border-b border-[var(--stone-200)] focus:border-[var(--foreground)] outline-none font-mono text-sm text-center py-2 tracking-wider transition-colors placeholder:text-[var(--stone-400)] ${
              authFailed ? "border-[var(--prose-hashtag)]" : ""
            }`}
          />

          {authFailed ? (
            <p className="font-mono text-xs mt-3 text-[var(--prose-hashtag)]">invalid pin</p>
          ) : null}

          <button
            type="submit"
            className="mt-6 w-full bg-[var(--foreground)] text-[var(--background)] font-mono text-sm lowercase tracking-wide py-2.5 rounded-md hover:opacity-90 transition-opacity"
          >
            unlock
          </button>

          <p className="mt-8 font-mono text-xs theme-muted">
            <Link href="/" className="hover:text-[var(--foreground)] transition-colors">
              ← home
            </Link>
          </p>
        </form>
      </main>
    );
  }

  return (
    <main id="main" className="min-h-dvh">
      <UploadDashboard isAdmin={isAdmin} />
    </main>
  );
}
