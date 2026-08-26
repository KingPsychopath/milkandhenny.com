import { Link, createFileRoute } from "@tanstack/react-router";
import { SITE_NAME } from "@/lib/shared/config";
import { getAdminEditorAccessFn } from "@/features/auth/auth.functions";
import { EditorAdminClient } from "@/features/admin/ui/editor/EditorAdminClient";
import { buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/admin/editor")({
  validateSearch: (search: Record<string, unknown>): { slug?: string } =>
    typeof search.slug === "string" ? { slug: search.slug } : {},
  loader: {
    handler: () => getAdminEditorAccessFn(),
    staleReloadMode: "blocking",
  },
  staleTime: 0,
  gcTime: 0,
  preload: false,
  component: AdminEditorPage,
  head: () =>
    buildSeoHead({
      title: `Admin editor — ${SITE_NAME}`,
      description: "Private Milk & Henny editorial administration.",
      path: "/admin/editor",
      robots: "noindex, nofollow",
      referrer: "no-referrer",
    }),
});

function AdminEditorPage() {
  const auth = Route.useLoaderData();
  if (!auth.ok) {
    return (
      <main id="main" className="min-h-dvh flex items-center justify-center px-6">
        <div className="text-center space-y-3">
          <p className="font-mono text-sm theme-muted">admin session required.</p>
          <Link to="/admin" search={{ view: "overview" }} className="font-mono text-xs underline">
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
