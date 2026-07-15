import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { SITE_NAME } from "@/lib/shared/config";
import { AdminDashboard } from "@/features/admin/ui/AdminDashboard";
import { authenticateRequest } from "@/features/auth/auth.server";
import { signInAdmin } from "@/features/auth/auth.functions";

const getAdminAccess = createServerFn({ method: "GET" }).handler(() =>
  authenticateRequest(getRequest(), "admin"),
);

export const Route = createFileRoute("/admin/")({
  component: AdminPage,
  loader: () => getAdminAccess(),
  head: () => ({
    meta: [{ title: `admin · ${SITE_NAME}` }, { name: "robots", content: "noindex, nofollow" }],
  }),
});

function AdminPage() {
  const auth = Route.useLoaderData();
  const isAuthed = auth.ok;

  if (!isAuthed) {
    return (
      <main id="main" className="min-h-dvh flex items-center justify-center px-6">
        <form
          action={signInAdmin.url}
          method="post"
          encType="multipart/form-data"
          className="w-full max-w-xs text-center"
        >
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
