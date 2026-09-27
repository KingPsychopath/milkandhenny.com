import { communicationsWorkspaceQuery } from "@/features/communications/admin-workspace.queries";
import { adminContentSummaryQuery } from "@/features/admin/content-summary.queries";
import { adminSystemHealthQuery } from "@/features/system/admin-health.queries";
import { adminOperationsInboxQuery } from "@/features/attendee-operations/admin-inbox.queries";
import { adminTokenSessionsQuery } from "@/features/auth/token-sessions.queries";
import { adminPollsQuery } from "@/features/polls/polls.queries";
import { adminCreditsQuery } from "@/features/credits/credits.queries";
import { adminEventsQuery } from "@/features/events/events.queries";
import { adminTransfersQuery } from "@/features/transfers/admin.queries";
import { adminUploadAccessQuery } from "@/features/auth/upload-access.queries";
import { adminGamePoolsQuery } from "@/features/things/pool/admin.queries";
import { adminBestDressedQuery } from "@/features/best-dressed/admin.queries";
import { adminSiteSettingsQuery } from "@/features/site/site-settings.queries";
import { adminReportsQuery } from "@/features/reports/admin-reports.queries";
import { adminAlbumsQuery } from "@/features/media/admin-albums.queries";
import { adminAlertSettingsQuery } from "@/features/attendee-operations/admin-alerts.queries";
import { adminEmailLedgerQuery } from "@/features/email-operations/admin-ledger.queries";
import { isEmailOutboxStatus } from "@/lib/shared/email-operations";
import {
  adminOperationsSettingsQuery,
  namedAdminGrantsQuery,
} from "@/features/attendee-operations/admin-settings.queries";
import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { AdminDraftProvider } from "@/features/admin/ui/hooks/useAdminDraftState";
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
    eventWorkspace?: "events" | "pitches";
    event?: string;
    ticket?: string;
    person?: string;
    emailStatus?: string;
    emailQuery?: string;
    auth?: AdminSignInState;
  } => ({
    view: isAdminSection(search.view) ? search.view : "overview",
    ...(search.eventWorkspace === "pitches" || search.eventWorkspace === "events"
      ? { eventWorkspace: search.eventWorkspace }
      : {}),
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
  loaderDeps: ({ search }) => ({
    view: search.view,
    tab: search.communicationTab,
    eventSlug: search.communicationEvent,
    eventWorkspace: search.eventWorkspace,
    emailStatus: search.emailStatus,
    emailQuery: search.emailQuery,
  }),
  loader: {
    handler: async ({ deps, context }) => {
      const access = await getAdminAccessFn();
      const communicationsPromise =
        access.isAuthed &&
        access.permissions?.manageCommunications &&
        deps.view === "communications"
          ? context.queryClient.prefetchQuery(
              communicationsWorkspaceQuery({
                tab: deps.tab ?? "event-plan",
                eventSlug: deps.eventSlug ?? "",
                query: "",
              }),
            )
          : null;
      const pollsPromise =
        access.isAuthed &&
        access.permissions?.manageCommunications &&
        deps.view === "communications" &&
        deps.tab === "polls"
          ? context.queryClient.prefetchQuery(adminPollsQuery)
          : null;
      const creditsPromise =
        access.isAuthed &&
        access.permissions?.manageCommunications &&
        deps.view === "communications" &&
        deps.tab === "credits"
          ? context.queryClient.prefetchQuery(adminCreditsQuery)
          : null;
      const alertsPromise =
        access.isAuthed &&
        access.permissions?.manageCommunications &&
        deps.view === "communications" &&
        deps.tab === "delivery"
          ? context.queryClient.prefetchQuery(adminAlertSettingsQuery)
          : null;
      const emailPromise =
        access.isAuthed &&
        access.permissions?.manageCommunications &&
        deps.view === "communications" &&
        deps.tab === "delivery"
          ? context.queryClient.prefetchQuery(
              adminEmailLedgerQuery({
                page: 1,
                limit: 40,
                sort: "newest",
                ...(isEmailOutboxStatus(deps.emailStatus ?? null)
                  ? {
                      status: deps.emailStatus as NonNullable<
                        Parameters<typeof adminEmailLedgerQuery>[0]["status"]
                      >,
                    }
                  : {}),
                ...(deps.emailQuery ? { query: deps.emailQuery } : {}),
              }),
            )
          : null;
      const eventsPromise =
        access.isAuthed &&
        access.permissions?.viewOperations &&
        deps.view === "events" &&
        (!deps.eventWorkspace || deps.eventWorkspace === "events")
          ? context.queryClient.prefetchQuery(adminEventsQuery)
          : null;
      const siteSettingsPromise =
        access.isAuthed &&
        access.permissions?.manageGlobalSettings &&
        deps.view === "events" &&
        (!deps.eventWorkspace || deps.eventWorkspace === "events")
          ? context.queryClient.prefetchQuery(adminSiteSettingsQuery)
          : null;
      const transfersPromise =
        access.isAuthed && access.permissions?.manageContent && deps.view === "transfers"
          ? context.queryClient.prefetchQuery(adminTransfersQuery)
          : null;
      const uploadAccessPromise =
        access.isAuthed && access.permissions?.manageContent && deps.view === "transfers"
          ? context.queryClient.prefetchQuery(adminUploadAccessQuery)
          : null;
      const gamePoolsPromise =
        access.isAuthed && access.permissions?.manageScoring && deps.view === "games"
          ? context.queryClient.prefetchQuery(adminGamePoolsQuery)
          : null;
      const bestDressedPromise =
        access.isAuthed && access.permissions?.manageScoring && deps.view === "best-dressed"
          ? context.queryClient.prefetchQuery(adminBestDressedQuery)
          : null;
      const settingsPromise =
        access.isAuthed && access.permissions?.manageGlobalSettings && deps.view === "settings"
          ? context.queryClient.prefetchQuery(adminOperationsSettingsQuery)
          : null;
      const adminGrantsPromise =
        access.isAuthed && access.permissions?.manageGlobalSettings && deps.view === "settings"
          ? context.queryClient.prefetchQuery(namedAdminGrantsQuery)
          : null;
      const summaryPromise =
        access.isAuthed &&
        access.permissions?.manageContent &&
        (deps.view === "overview" || deps.view === "content")
          ? context.queryClient.prefetchQuery(adminContentSummaryQuery)
          : null;
      const albumsPromise =
        access.isAuthed && access.permissions?.manageContent && deps.view === "content"
          ? context.queryClient.prefetchQuery(adminAlbumsQuery)
          : null;
      const healthPromise =
        access.isAuthed &&
        access.permissions?.viewOperations &&
        (deps.view === "overview" || deps.view === "system")
          ? context.queryClient.prefetchQuery(adminSystemHealthQuery)
          : null;
      const reportsPromise =
        access.isAuthed && access.permissions?.viewAudit && deps.view === "overview"
          ? context.queryClient.prefetchQuery(adminReportsQuery(false))
          : null;
      const sessionsPromise =
        access.isAuthed && access.permissions?.manageGlobalSettings && deps.view === "system"
          ? context.queryClient.prefetchQuery(adminTokenSessionsQuery)
          : null;
      if (
        access.isAuthed &&
        access.permissions?.viewOperations &&
        (deps.view === "overview" || deps.view === "operations")
      ) {
        // The notification summary is secondary. The SSR Query stream carries its pending result.
        void context.queryClient.prefetchQuery(adminOperationsInboxQuery);
      }
      await Promise.all([
        communicationsPromise,
        pollsPromise,
        creditsPromise,
        alertsPromise,
        emailPromise,
        eventsPromise,
        siteSettingsPromise,
        transfersPromise,
        uploadAccessPromise,
        gamePoolsPromise,
        bestDressedPromise,
        settingsPromise,
        adminGrantsPromise,
        summaryPromise,
        albumsPromise,
        healthPromise,
        reportsPromise,
        sessionsPromise,
      ]);
      return access;
    },
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
    draftScope,
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
    eventWorkspace,
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
      <AdminDraftProvider key={draftScope} scope={draftScope ?? "admin"}>
        <Suspense fallback={<AdminDashboardFallback />}>
          <AdminDashboard
            view={availableView}
            communicationTab={communicationTab ?? "event-plan"}
            communicationEvent={communicationEvent}
            operationsTab={availableOperationsTab}
            targetEvent={event}
            eventWorkspace={eventWorkspace ?? "events"}
            onEventWorkspaceChange={(workspace) =>
              void navigate({
                search: (current) => ({ ...current, eventWorkspace: workspace }),
                resetScroll: false,
              })
            }
            onSelectedEventChange={(slug) => {
              if (slug !== event)
                void navigate({
                  search: (current) => ({ ...current, event: slug }),
                  resetScroll: false,
                });
            }}
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
      </AdminDraftProvider>
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
