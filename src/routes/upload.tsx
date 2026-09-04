import { Link, createFileRoute } from "@tanstack/react-router";
import { SITE_NAME } from "@/lib/shared/config";
import { buildSeoHead } from "@/lib/shared/seo";
import { UploadDashboard } from "@/features/transfers/ui/upload/UploadDashboard";
import {
  getTransferAccountOwnerAccessFn,
  getTransferOwnerAccessFn,
} from "@/features/transfers/transfer.functions";
import { getUploadAccessFn, signInUpload } from "@/features/auth/auth.functions";

type UploadSearch = {
  auth?: "failed";
  transfer?: string;
  token?: string;
};

export const Route = createFileRoute("/upload")({
  validateSearch: (search: Record<string, unknown>): UploadSearch => ({
    ...(search.auth === "failed" ? { auth: "failed" as const } : {}),
    ...(typeof search.transfer === "string" && search.transfer.trim()
      ? { transfer: search.transfer.trim().slice(0, 128) }
      : {}),
    ...(typeof search.token === "string" && search.token.trim()
      ? { token: search.token.trim().slice(0, 512) }
      : {}),
  }),
  loaderDeps: ({ search }) => ({ transfer: search.transfer, token: search.token }),
  loader: {
    handler: async ({ deps }) => {
      const [access, ownerAccess, accountOwnerAccess] = await Promise.all([
        getUploadAccessFn(),
        deps.transfer && deps.token
          ? getTransferOwnerAccessFn({ data: { id: deps.transfer, token: deps.token } })
          : false,
        deps.transfer ? getTransferAccountOwnerAccessFn({ data: { id: deps.transfer } }) : false,
      ]);
      return { ...access, ownerAccess, accountOwnerAccess };
    },
    staleReloadMode: "blocking",
  },
  staleTime: 0,
  gcTime: 0,
  preload: false,
  component: UploadPage,
  head: () =>
    buildSeoHead({
      title: `Upload · ${SITE_NAME}`,
      description: "Upload files to a private, expiring Milk & Henny transfer.",
      path: "/upload",
      robots: "noindex, nofollow",
      referrer: "no-referrer",
    }),
});

function UploadPage() {
  const { isAuthed, isAdmin, uploadAccessExpiresAt, ownerAccess, accountOwnerAccess } =
    Route.useLoaderData();
  const { auth, transfer, token } = Route.useSearch();
  const authFailed = auth === "failed";

  if (!isAuthed && !ownerAccess) {
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

          <label htmlFor="upload-passphrase" className="sr-only">
            Upload passphrase
          </label>
          <input
            id="upload-passphrase"
            name="pin"
            type="password"
            placeholder="enter upload passphrase"
            autoFocus
            required
            aria-invalid={authFailed || undefined}
            aria-describedby={authFailed ? "upload-auth-error" : undefined}
            className={`min-h-11 w-full border-b border-[var(--stone-200)] bg-transparent py-2 text-center font-mono text-base tracking-wider outline-none transition-colors placeholder:text-[var(--stone-400)] focus:border-[var(--foreground)] ${
              authFailed ? "border-[var(--prose-hashtag)]" : ""
            }`}
          />

          {authFailed ? (
            <p
              id="upload-auth-error"
              className="mt-3 font-mono text-xs text-[var(--prose-hashtag)]"
              role="alert"
            >
              invalid passphrase
            </p>
          ) : null}

          <button
            type="submit"
            className="mt-6 min-h-11 w-full rounded-md bg-[var(--foreground)] py-2.5 font-mono text-sm lowercase tracking-wide text-[var(--background)] transition-opacity hover:opacity-90"
          >
            unlock
          </button>

          <Link
            to="/access"
            search={{ returnTo: "/upload" }}
            className="mt-4 inline-flex min-h-11 items-center font-mono text-xs underline underline-offset-4 theme-muted transition-colors hover:text-[var(--foreground)]"
          >
            sign in with an authorised account
          </Link>

          <p className="mt-4 font-mono text-xs theme-muted">
            <Link
              to="/"
              className="inline-flex min-h-11 items-center px-2 transition-colors hover:text-[var(--foreground)]"
            >
              ← home
            </Link>
          </p>
        </form>
      </main>
    );
  }

  return (
    <main id="main" className="min-h-dvh">
      <UploadDashboard
        isAdmin={isAdmin}
        accessExpiresAt={uploadAccessExpiresAt}
        initialAppendTransferId={
          ownerAccess || accountOwnerAccess || isAdmin ? transfer : undefined
        }
        initialAppendOwnerToken={ownerAccess ? token : undefined}
      />
    </main>
  );
}
