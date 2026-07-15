import { Link, createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { SITE_NAME } from "@/lib/shared/config";
import { authenticateRequest } from "@/features/auth/auth.server";
import { EditorAdminClient } from "@/features/admin/ui/editor/EditorAdminClient";

const getEditorAccess = createServerFn({ method: "GET" }).handler(() =>
  authenticateRequest(getRequest(), "admin"),
);

export const Route = createFileRoute("/admin/editor")({
  validateSearch: (search: Record<string, unknown>) => ({
    slug: typeof search.slug === "string" ? search.slug : undefined,
  }),
  loader: () => getEditorAccess(),
  component: AdminEditorPage,
  head: () => ({
    meta: [
      { title: `admin editor · ${SITE_NAME}` },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function AdminEditorPage() {
  const auth = Route.useLoaderData();
  if (!auth.ok) {
    return (
      <main id="main" className="min-h-dvh flex items-center justify-center px-6">
        <div className="text-center space-y-3">
          <p className="font-mono text-sm theme-muted">admin session required.</p>
          <Link to="/admin" className="font-mono text-xs underline">
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
