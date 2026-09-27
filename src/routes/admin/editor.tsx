import { Link, createFileRoute } from "@tanstack/react-router";
import { SITE_NAME } from "@/lib/shared/config";
import { getAdminEditorAccessFn } from "@/features/auth/auth.functions";
import { EditorAdminClient } from "@/features/admin/ui/editor/EditorAdminClient";
import { buildSeoHead } from "@/lib/shared/seo";
import {
  adminEditorWordQuery,
  adminEditorWordsQuery,
  EMPTY_ADMIN_EDITOR_FILTERS,
} from "@/features/words/admin-editor.queries";
import { adminSharedWordsQuery } from "@/features/words/admin-shares.queries";

export const Route = createFileRoute("/admin/editor")({
  validateSearch: (search: Record<string, unknown>): { slug?: string } =>
    typeof search.slug === "string" ? { slug: search.slug } : {},
  loaderDeps: ({ search }) => ({ slug: search.slug }),
  loader: {
    handler: async ({ context, deps }) => {
      const access = await getAdminEditorAccessFn();
      if (access.ok)
        await Promise.all([
          context.queryClient.prefetchQuery(adminEditorWordsQuery(EMPTY_ADMIN_EDITOR_FILTERS)),
          context.queryClient.prefetchQuery(adminSharedWordsQuery),
          ...(deps.slug && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(deps.slug)
            ? [context.queryClient.prefetchQuery(adminEditorWordQuery(deps.slug))]
            : []),
        ]);
      return access;
    },
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
  const { slug } = Route.useSearch();
  if (!auth.ok) {
    return (
      <main id="main" className="min-h-dvh flex items-center justify-center px-6">
        <div className="text-center space-y-3">
          <p className="font-mono text-sm theme-muted">
            {auth.status === 403 ? "content access required." : "admin session required."}
          </p>
          <Link
            to="/admin"
            search={{ view: "overview" }}
            className="inline-flex min-h-11 items-center font-mono text-xs underline"
          >
            {auth.status === 403 ? "return to admin" : "go to admin login"}
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main id="main" className="min-h-dvh">
      <EditorAdminClient initialSlug={slug} />
    </main>
  );
}
