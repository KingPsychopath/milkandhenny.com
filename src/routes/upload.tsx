import { Link, createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { SITE_NAME } from "@/lib/shared/config";
import { UploadDashboard } from "@/features/transfers/ui/upload/UploadDashboard";
import { authenticateRequest } from "@/features/auth/auth.server";
import { signInUpload } from "@/features/auth/auth.functions";

const getUploadAccess = createServerFn({ method: "GET" }).handler(async () => {
  const request = getRequest();
  const [auth, adminAuth] = await Promise.all([
    authenticateRequest(request, "upload"),
    authenticateRequest(request, "admin"),
  ]);
  return { isAuthed: auth.ok, isAdmin: adminAuth.ok };
});

export const Route = createFileRoute("/upload")({
  validateSearch: (search: Record<string, unknown>) => ({
    auth: search.auth === "failed" ? ("failed" as const) : undefined,
  }),
  loader: () => getUploadAccess(),
  component: UploadPage,
  head: () => ({
    meta: [
      { title: `upload · ${SITE_NAME}` },
      { name: "description", content: "Upload files to transfers or words media." },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function UploadPage() {
  const { isAuthed, isAdmin } = Route.useLoaderData();
  const authFailed = Route.useSearch().auth === "failed";

  if (!isAuthed) {
    return (
      <main id="main" className="min-h-dvh flex items-center justify-center px-6">
        <form
          action={signInUpload.url}
          method="post"
          encType="multipart/form-data"
          className="w-full max-w-xs text-center"
        >
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
            <Link to="/" className="hover:text-[var(--foreground)] transition-colors">
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
