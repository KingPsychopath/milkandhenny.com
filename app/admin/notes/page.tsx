import type { Metadata } from "next";
import Link from "next/link";
import { SITE_NAME } from "@/lib/shared/config";
import { requireAuthFromServerContext } from "@/features/auth/server";
import { isNotesEnabled } from "@/features/notes/reader";
import { NotesAdminClient } from "./NotesAdminClient";

export const metadata: Metadata = {
  title: `admin notes · ${SITE_NAME}`,
  description: "Manage private markdown notes and share links.",
  robots: { index: false, follow: false },
};

export default async function AdminNotesPage() {
  if (!isNotesEnabled()) {
    return (
      <main id="main" className="min-h-dvh flex items-center justify-center px-6">
        <p className="font-mono text-sm theme-muted">notes feature is disabled (`NOTES_ENABLED=true`).</p>
      </main>
    );
  }

  const auth = await requireAuthFromServerContext("admin");
  if (!auth.ok) {
    return (
      <main id="main" className="min-h-dvh flex items-center justify-center px-6">
        <div className="text-center space-y-3">
          <p className="font-mono text-sm theme-muted">admin session required.</p>
          <Link href="/admin" className="font-mono text-xs underline">
            go to admin login
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main id="main" className="min-h-dvh">
      <NotesAdminClient />
    </main>
  );
}
