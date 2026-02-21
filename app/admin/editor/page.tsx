import type { Metadata } from "next";
import Link from "next/link";
import { SITE_NAME } from "@/lib/shared/config";
import { requireAuthFromServerContext } from "@/features/auth/server";
import { isNotesEnabled } from "@/features/notes/reader";
import { EditorAdminClient } from "./EditorAdminClient";

export const metadata: Metadata = {
  title: `admin editor · ${SITE_NAME}`,
  description: "Manage blogs, notes, recipes, reviews, and share links.",
  robots: { index: false, follow: false },
};

export default async function AdminEditorPage() {
  if (!isNotesEnabled()) {
    return (
      <main id="main" className="min-h-dvh flex items-center justify-center px-6">
        <p className="font-mono text-sm theme-muted">words feature is disabled (`NOTES_ENABLED=false`).</p>
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
      <EditorAdminClient />
    </main>
  );
}
