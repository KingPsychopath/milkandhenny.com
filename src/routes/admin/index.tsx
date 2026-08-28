import { createFileRoute } from "@tanstack/react-router";
import { SITE_NAME } from "@/lib/shared/config";
import { AdminDashboard } from "@/features/admin/ui/AdminDashboard";
import {
  isAdminSection,
  isCommunicationsTab,
  isOperationsTab,
  type AdminSection,
  type AdminDestination,
  type CommunicationsTab,
  type OperationsTab,
} from "@/features/admin/ui/components/AdminSectionNav";
import {
  getAdminAccessFn,
  signInAdmin,
  signInAdminDevelopment,
} from "@/features/auth/auth.functions";
import { buildSeoHead } from "@/lib/shared/seo";
import { PasskeySignIn } from "@/features/attendee-access/ui/PasskeySignIn";

export const Route = createFileRoute("/admin/")({
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    view: AdminSection;
    communicationTab?: CommunicationsTab;
    communicationEvent?: string;
    operationsTab?: OperationsTab;
    event?: string;
    ticket?: string;
    person?: string;
    emailStatus?: string;
    emailQuery?: string;
  } => ({
    view: isAdminSection(search.view) ? search.view : "overview",
    ...(isCommunicationsTab(search.communicationTab)
      ? { communicationTab: search.communicationTab }
      : {}),
    ...(typeof search.communicationEvent === "string" && search.communicationEvent.trim()
      ? { communicationEvent: search.communicationEvent }
      : {}),
    ...(isOperationsTab(search.operationsTab) ? { operationsTab: search.operationsTab } : {}),
    ...(typeof search.event === "string" && search.event.trim()
      ? { event: search.event.trim().slice(0, 160) }
      : {}),
    ...(typeof search.ticket === "string" && search.ticket.trim()
      ? { ticket: search.ticket.trim().slice(0, 160) }
      : {}),
    ...(typeof search.person === "string" && search.person.trim()
      ? { person: search.person.trim().slice(0, 160) }
      : {}),
    ...(typeof search.emailStatus === "string" && search.emailStatus.trim()
      ? { emailStatus: search.emailStatus.trim().slice(0, 40) }
      : {}),
    ...(typeof search.emailQuery === "string" && search.emailQuery.trim()
      ? { emailQuery: search.emailQuery.trim().slice(0, 200) }
      : {}),
  }),
  component: AdminPage,
  loader: {
    handler: () => getAdminAccessFn(),
    staleReloadMode: "blocking",
  },
  staleTime: 0,
  gcTime: 0,
  preload: false,
  head: () =>
    buildSeoHead({
      title: `Admin — ${SITE_NAME}`,
      description: "Private Milk & Henny administration.",
      path: "/admin",
      robots: "noindex, nofollow",
      referrer: "no-referrer",
    }),
});

function AdminPage() {
  const { auth, localDevBypassAvailable, namedAdminPasskeyRequired, namedAdminHasPasskey } =
    Route.useLoaderData();
  const {
    view,
    communicationTab,
    communicationEvent,
    operationsTab,
    event,
    ticket,
    person,
    emailStatus,
    emailQuery,
  } = Route.useSearch();
  const navigate = Route.useNavigate();
  const isAuthed = auth.ok;

  if (!isAuthed) {
    return (
      <main id="main" className="min-h-dvh flex items-center justify-center px-6">
        <div className="w-full max-w-sm text-center">
          <h1 className="font-mono font-bold tracking-tighter text-lg">{SITE_NAME}</h1>
          <p className="font-mono text-sm theme-muted mt-1 mb-10">admin workspace</p>

          {namedAdminPasskeyRequired ? (
            <div className="mb-8 border-y theme-border py-5 text-left">
              <p className="font-mono text-xs leading-relaxed">
                Administrator access requires a passkey.
              </p>
              {namedAdminHasPasskey ? (
                <PasskeySignIn
                  returnTo="/admin"
                  conditional={false}
                  className="mt-4"
                  label="continue with passkey"
                  onAuthenticated={async () => {
                    window.location.assign("/admin");
                  }}
                />
              ) : (
                <a href="/my" className="mh-action mh-action--secondary mt-4">
                  add a passkey in account security
                </a>
              )}
            </div>
          ) : null}

          <form action={signInAdmin.url} method="post" encType="multipart/form-data">
            <label htmlFor="admin-password" className="sr-only">
              admin password
            </label>
            <input
              id="admin-password"
              name="password"
              type="password"
              placeholder="admin password"
              autoFocus
              required
              className="w-full bg-transparent border-b border-[var(--stone-200)] focus:border-[var(--foreground)] outline-none font-mono text-sm text-center py-2 tracking-wider transition-colors placeholder:text-[var(--stone-400)]"
            />

            <button
              type="submit"
              className="mt-6 min-h-12 w-full rounded-md bg-[var(--foreground)] px-4 py-2.5 font-mono text-sm lowercase tracking-wide text-[var(--background)] hover:opacity-90 transition-opacity"
            >
              unlock
            </button>
          </form>

          {localDevBypassAvailable ? (
            <div className="mt-8 border-t border-[var(--stone-200)] pt-6">
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] theme-muted">
                local workspace
              </p>
              <p className="mt-2 font-mono text-xs leading-relaxed theme-muted">
                Skip the password while auditing the admin tools on this machine.
              </p>
              <form action={signInAdminDevelopment.url} method="post">
                <button
                  type="submit"
                  className="mt-4 min-h-12 w-full rounded-md border border-[var(--stone-300)] px-4 py-2.5 font-mono text-sm lowercase tracking-wide hover:opacity-70 transition-opacity"
                >
                  continue in local dev
                </button>
              </form>
            </div>
          ) : null}
        </div>
      </main>
    );
  }

  return (
    <main id="main" className="min-h-dvh">
      <AdminDashboard
        view={view}
        communicationTab={communicationTab ?? "event-plan"}
        communicationEvent={communicationEvent}
        operationsTab={operationsTab ?? (ticket || person || event ? "people" : "inbox")}
        targetEvent={event}
        targetTicket={ticket}
        targetPerson={person}
        emailStatus={emailStatus}
        emailQuery={emailQuery}
        onNavigate={(destination: AdminDestination) =>
          void navigate({
            search: {
              view: destination.section,
              communicationTab: destination.communicationTab,
              operationsTab: destination.operationsTab,
              event: destination.event,
              ticket: destination.ticket,
              person: destination.person,
              emailStatus: destination.emailStatus,
              emailQuery: destination.emailQuery,
            },
            resetScroll: false,
          })
        }
        onViewChange={(nextView) =>
          void navigate({ search: { view: nextView }, resetScroll: false })
        }
        onCommunicationTabChange={(nextTab) =>
          void navigate({
            search: (current) => ({
              ...current,
              view: "communications",
              communicationTab: nextTab,
            }),
            resetScroll: false,
          })
        }
        onCommunicationEventChange={(nextEvent) =>
          void navigate({
            search: (current) => ({
              ...current,
              view: "communications",
              communicationEvent: nextEvent,
            }),
            resetScroll: false,
          })
        }
        onOperationsTabChange={(nextTab) =>
          void navigate({
            search: { view: "operations", operationsTab: nextTab },
            resetScroll: false,
          })
        }
        onOperationsPersonChange={(nextPerson) =>
          void navigate({
            search: (current) => ({
              ...current,
              view: "operations",
              operationsTab: "people",
              person: nextPerson,
              ticket: undefined,
            }),
            resetScroll: false,
          })
        }
      />
    </main>
  );
}
