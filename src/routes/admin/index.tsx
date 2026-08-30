import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { SITE_NAME } from "@/lib/shared/config";
import {
  ADMIN_SECTIONS,
  OPERATIONS_TABS,
  isAdminSection,
  isCommunicationsTab,
  isOperationsTab,
  type AdminSection,
  type AdminDestination,
  type CommunicationsTab,
  type OperationsTab,
} from "@/features/admin/ui/components/AdminSectionNav";
import {
  canAccessAdminDestination,
  canAccessAdminSection,
  canAccessOperationsTab,
  firstAccessibleAdminSection,
  firstAccessibleOperationsTab,
} from "@/features/admin/ui/admin-permissions";
import {
  getAdminAccessFn,
  signInAdmin,
  signInAdminDevelopment,
} from "@/features/auth/auth.functions";
import { buildSeoHead } from "@/lib/shared/seo";
import { PasskeySignIn } from "@/features/attendee-access/ui/PasskeySignIn";
import {
  adminSignInMessage,
  parseAdminSignInState,
  type AdminSignInState,
} from "@/features/admin/ui/admin-auth-state";

const AdminDashboard = lazy(() =>
  import("@/features/admin/ui/AdminDashboard").then((module) => ({
    default: module.AdminDashboard,
  })),
);

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
    auth?: AdminSignInState;
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
    ...(parseAdminSignInState(search.auth) ? { auth: parseAdminSignInState(search.auth) } : {}),
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
  const {
    isAuthed,
    permissions,
    localDevBypassAvailable,
    namedAdminPasskeyRequired,
    namedAdminHasPasskey,
  } = Route.useLoaderData();
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
    auth: signInState,
  } = Route.useSearch();
  const signInError = adminSignInMessage(signInState);
  const navigate = Route.useNavigate();

  if (!isAuthed || !permissions) {
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
              autoFocus={!namedAdminPasskeyRequired}
              required
              aria-invalid={signInError ? true : undefined}
              aria-describedby={signInError ? "admin-sign-in-error" : undefined}
              className="min-h-11 w-full bg-transparent border-b border-[var(--stone-200)] focus:border-[var(--foreground)] outline-none py-2 text-center font-mono text-base tracking-wider transition-colors placeholder:text-[var(--stone-400)] sm:text-sm"
            />

            {signInError ? (
              <p
                id="admin-sign-in-error"
                role="alert"
                className="mt-3 font-mono text-xs text-[var(--status-danger)]"
              >
                {signInError}
              </p>
            ) : null}

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

  const availableView = canAccessAdminSection(view, permissions)
    ? view
    : (firstAccessibleAdminSection(
        ADMIN_SECTIONS.map((section) => section.id),
        permissions,
      ) ?? "overview");
  const requestedOperationsTab = operationsTab ?? (ticket || person || event ? "people" : "inbox");
  const availableOperationsTab = canAccessOperationsTab(requestedOperationsTab, permissions)
    ? requestedOperationsTab
    : (firstAccessibleOperationsTab(OPERATIONS_TABS, permissions) ?? "inbox");

  return (
    <main id="main" className="min-h-dvh">
      <Suspense fallback={<AdminDashboardFallback />}>
        <AdminDashboard
          view={availableView}
          communicationTab={communicationTab ?? "event-plan"}
          communicationEvent={communicationEvent}
          operationsTab={availableOperationsTab}
          targetEvent={event}
          targetTicket={ticket}
          targetPerson={person}
          emailStatus={emailStatus}
          emailQuery={emailQuery}
          permissions={permissions}
          onNavigate={(destination: AdminDestination) => {
            if (!canAccessAdminDestination(destination, permissions)) return;
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
            });
          }}
          onViewChange={(nextView) => {
            if (!canAccessAdminSection(nextView, permissions)) return;
            void navigate({ search: { view: nextView }, resetScroll: false });
          }}
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
          onOperationsTabChange={(nextTab) => {
            if (!canAccessOperationsTab(nextTab, permissions)) return;
            void navigate({
              search: { view: "operations", operationsTab: nextTab },
              resetScroll: false,
            });
          }}
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
      </Suspense>
    </main>
  );
}

function AdminDashboardFallback() {
  return (
    <div className="mx-auto max-w-7xl px-6 py-12 lg:px-8" role="status">
      <h1 className="font-serif text-4xl font-semibold tracking-tight">
        {SITE_NAME} <span className="font-normal theme-muted">admin</span>
      </h1>
      <p className="mt-8 border-y theme-border py-6 font-mono text-xs theme-muted">
        loading admin workspace…
      </p>
    </div>
  );
}
