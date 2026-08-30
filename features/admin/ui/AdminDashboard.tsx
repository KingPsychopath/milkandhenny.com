"use client";

import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import type { SystemCapabilities } from "@/features/system/capabilities";
import type { MultiplayerTelemetrySnapshot } from "@/features/things/shared/multiplayer-telemetry";
import type { GlobalAdminPermissionSet } from "@/features/attendee-operations/types";
import { SITE_BRAND } from "@/lib/shared/config";
import { AdminCommandPalette } from "./components/AdminCommandPalette";
import {
  AdminSectionNav,
  OPERATIONS_TABS,
  type AdminDestination,
  type AdminSection,
  type CommunicationsTab,
  type OperationsTab,
} from "./components/AdminSectionNav";
import { useAdminAuth } from "@/features/auth/useAdminAuth";
import { useActionDialog } from "@/hooks/useActionDialog";
import { useAdminAutoRefresh } from "./hooks/useAdminAutoRefresh";
import { formatRemaining } from "./format";
import { AdminStatus } from "./components/AdminStatus";

const TokenSessionsPanel = lazy(() =>
  import("./components/TokenSessionsPanel").then((module) => ({
    default: module.TokenSessionsPanel,
  })),
);
const ContentPanel = lazy(() =>
  import("./components/ContentPanel").then((module) => ({ default: module.ContentPanel })),
);
const TransfersPanel = lazy(() =>
  import("./components/TransfersPanel").then((module) => ({ default: module.TransfersPanel })),
);
const ReportsPanel = lazy(() =>
  import("./components/ReportsPanel").then((module) => ({ default: module.ReportsPanel })),
);
const EventsPanel = lazy(() =>
  import("./components/EventsPanel").then((module) => ({ default: module.EventsPanel })),
);
const EventScoringPanel = lazy(() =>
  import("./components/EventScoringPanel").then((module) => ({
    default: module.EventScoringPanel,
  })),
);
const PitchesPanel = lazy(() =>
  import("./components/PitchesPanel").then((module) => ({ default: module.PitchesPanel })),
);
const GamePoolsPanel = lazy(() =>
  import("./components/GamePoolsPanel").then((module) => ({ default: module.GamePoolsPanel })),
);
const HotAndColdReviewPanel = lazy(() =>
  import("./components/HotAndColdReviewPanel").then((module) => ({
    default: module.HotAndColdReviewPanel,
  })),
);
const BestDressedPanel = lazy(() =>
  import("./components/BestDressedPanel").then((module) => ({
    default: module.BestDressedPanel,
  })),
);
const AdminOverviewPanel = lazy(() =>
  import("./components/AdminOverviewPanel").then((module) => ({
    default: module.AdminOverviewPanel,
  })),
);
const SystemHealthPanel = lazy(() =>
  import("./components/SystemHealthPanel").then((module) => ({
    default: module.SystemHealthPanel,
  })),
);
const CommunicationsPanel = lazy(() =>
  import("./components/CommunicationsPanel").then((module) => ({
    default: module.CommunicationsPanel,
  })),
);
const AttendeeOperationsPanel = lazy(() =>
  import("./components/AttendeeOperationsPanel").then((module) => ({
    default: module.AttendeeOperationsPanel,
  })),
);
const AttendeeSettingsPanel = lazy(() =>
  import("./components/AttendeeSettingsPanel").then((module) => ({
    default: module.AttendeeSettingsPanel,
  })),
);

type BlogSummary = {
  totalPosts: number;
  featuredPosts: number;
  postsWithImages: number;
  totalReadingMinutes: number;
  latestPostDate: string | null;
  recent: Array<{
    slug: string;
    title: string;
    date: string;
    readingTime: number;
    featured: boolean;
  }>;
};

type GallerySummary = {
  totalAlbums: number;
  totalPhotos: number;
  albumsWithoutDescription: number;
  invalidAlbumCount: number;
  latestAlbumDate: string | null;
  recent: Array<{
    slug: string;
    title: string;
    date: string;
    photoCount: number;
  }>;
};

type ContentSummaryResponse = {
  blog: BlogSummary;
  gallery: GallerySummary;
};

type DebugResponse = SystemCapabilities & {
  emailOutbox: {
    available: boolean;
    pending: number;
    processing: number;
    accepted: number;
    failed: number;
    cancelled: number;
    delivered: number;
    awaitingProviderFeedback: number;
    oldestPendingAt: string | null;
    latestDeliveryEventAt: string | null;
  };
  mediaQueue: {
    available: boolean;
    enabled: boolean;
    queued: number;
    leased: number;
    permanentFailures: number;
    backlogAgeMs: number | null;
    reason?: string;
  };
  multiplayer: MultiplayerTelemetrySnapshot;
  gamePools: {
    activeAssignments: number;
    openRooms: number;
    openRuns: number;
    allocation: {
      attempts: number;
      failures: number;
      contention: number;
      averageMs: number | null;
      maxMs: number | null;
    };
  };
  securityWarnings: string[];
  help?: {
    forceReload?: string;
    bootstrap?: string;
  };
};

type SessionRevokeResponse = {
  error?: string;
  revoked?: Array<{ role?: string; tokenVersion?: number }>;
};

type EventWorkspace = "events" | "scoring" | "pitches";

export function AdminDashboard({
  view,
  communicationTab,
  communicationEvent,
  operationsTab,
  targetEvent,
  targetTicket,
  targetPerson,
  emailStatus,
  emailQuery,
  onNavigate,
  onViewChange,
  onCommunicationTabChange,
  onCommunicationEventChange,
  onOperationsTabChange,
  onOperationsPersonChange,
  permissions,
}: {
  view: AdminSection;
  communicationTab: CommunicationsTab;
  communicationEvent?: string;
  operationsTab: OperationsTab;
  targetEvent?: string;
  targetTicket?: string;
  targetPerson?: string;
  emailStatus?: string;
  emailQuery?: string;
  onNavigate: (destination: AdminDestination) => void;
  onViewChange: (section: AdminSection) => void;
  onCommunicationTabChange: (tab: CommunicationsTab) => void;
  onCommunicationEventChange: (eventSlug: string) => void;
  onOperationsTabChange: (tab: OperationsTab) => void;
  onOperationsPersonChange: (personId?: string) => void;
  permissions: GlobalAdminPermissionSet;
}) {
  const { confirm: confirmAction, dialog: actionDialog } = useActionDialog();
  const [loading, setLoading] = useState(
    view === "overview" || view === "content" || view === "system",
  );
  const [dashboardLoaded, setDashboardLoaded] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [content, setContent] = useState<ContentSummaryResponse | null>(null);
  const [revokeLoading, setRevokeLoading] = useState<"admin" | "all" | null>(null);
  const [debugData, setDebugData] = useState<DebugResponse | null>(null);
  const [operationsUnread, setOperationsUnread] = useState(0);
  const [operationsUnresolvedByCategory, setOperationsUnresolvedByCategory] = useState<
    Record<string, number>
  >({});
  const [operationsRecent, setOperationsRecent] = useState<
    Array<{
      id: string;
      title: string;
      body: string;
      status: string;
      severity: string;
      category: string;
      deepLink: string;
      unread: boolean;
    }>
  >([]);
  const [attentionOpen, setAttentionOpen] = useState(false);
  const [eventWorkspace, setEventWorkspace] = useState<EventWorkspace>("events");
  const [systemRefreshHalted, setSystemRefreshHalted] = useState(false);
  const [inboxRefreshHalted, setInboxRefreshHalted] = useState(false);

  const {
    authFetch,
    ensureStepUpToken: ensureStepUpTokenResult,
    withStepUpHeaders,
    authDialog,
  } = useAdminAuth();

  const refreshDashboard = useCallback(async () => {
    setLoading(true);
    setErrorMessage("");
    const errors: string[] = [];
    try {
      const [contentResult, debugResult] = await Promise.allSettled([
        permissions.manageContent ? authFetch("/api/admin/content-summary") : Promise.resolve(null),
        permissions.viewOperations ? authFetch("/api/debug") : Promise.resolve(null),
      ]);

      if (
        permissions.manageContent &&
        contentResult.status === "fulfilled" &&
        contentResult.value?.ok
      ) {
        try {
          setContent((await contentResult.value.json()) as ContentSummaryResponse);
        } catch {
          errors.push("The content summary returned an unreadable response.");
        }
      } else if (permissions.manageContent) {
        errors.push("The content summary could not be loaded.");
      }

      if (
        permissions.viewOperations &&
        debugResult.status === "fulfilled" &&
        debugResult.value?.ok
      ) {
        try {
          setDebugData((await debugResult.value.json()) as DebugResponse);
          setSystemRefreshHalted(false);
        } catch {
          errors.push("The system check returned an unreadable response.");
        }
      } else if (permissions.viewOperations) {
        errors.push("The system check could not be loaded.");
      }

      setErrorMessage(errors.join(" "));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to refresh dashboard";
      setErrorMessage(msg);
    } finally {
      setLoading(false);
      setDashboardLoaded(true);
    }
  }, [authFetch, permissions.manageContent, permissions.viewOperations]);

  useEffect(() => {
    if (view === "overview" || view === "content" || view === "system") void refreshDashboard();
  }, [refreshDashboard, view]);

  useEffect(() => {
    if (targetEvent) setEventWorkspace("events");
  }, [targetEvent]);

  useEffect(() => {
    setStatusMessage("");
    setErrorMessage("");
    setAttentionOpen(false);
  }, [view]);

  const refreshSystemSnapshot = useCallback(async () => {
    const response = await authFetch("/api/debug");
    if (!response.ok) {
      if (response.status >= 400 && response.status < 500) setSystemRefreshHalted(true);
      throw new Error("Could not refresh system status");
    }
    setSystemRefreshHalted(false);
    setDebugData((await response.json()) as DebugResponse);
  }, [authFetch]);

  useAdminAutoRefresh({
    enabled: view === "system" && !systemRefreshHalted,
    cadence: "monitoring",
    identity: "admin-system",
    refreshOnEnable: false,
    refresh: () => refreshSystemSnapshot(),
  });

  const refreshOperationsInbox = useCallback(async () => {
    const response = await authFetch("/api/admin/operations/inbox?active=1");
    if (!response.ok) {
      if (response.status >= 400 && response.status < 500) setInboxRefreshHalted(true);
      throw new Error("Could not refresh operations inbox");
    }
    const inbox = (await response.json()) as {
      unread?: number;
      unresolvedByCategory?: Record<string, number>;
      items?: Array<{
        id: string;
        title: string;
        body: string;
        status: string;
        severity: string;
        category: string;
        deepLink: string;
        unread: boolean;
      }>;
    };
    setInboxRefreshHalted(false);
    setOperationsUnread(inbox.unread ?? 0);
    setOperationsUnresolvedByCategory(inbox.unresolvedByCategory ?? {});
    setOperationsRecent(inbox.items?.slice(0, 3) ?? []);
  }, [authFetch]);

  useEffect(() => {
    if (!permissions.viewOperations) return;
    void refreshOperationsInbox().catch(() => undefined);
  }, [permissions.viewOperations, refreshOperationsInbox]);

  useAdminAutoRefresh({
    enabled: permissions.viewOperations && !inboxRefreshHalted,
    cadence: "monitoring",
    identity: "admin-operations-inbox",
    refreshOnEnable: false,
    refresh: () => refreshOperationsInbox(),
  });

  const handleAttendeeOperationsStatus = useCallback(
    (message: string) => {
      setStatusMessage(message);
      void refreshOperationsInbox().catch(() => undefined);
    },
    [refreshOperationsInbox],
  );

  const handleNavigate = useCallback(
    (destination: AdminDestination) => {
      setStatusMessage("");
      setErrorMessage("");
      onNavigate(destination);
    },
    [onNavigate],
  );

  const handleViewChange = useCallback(
    (section: AdminSection) => {
      setStatusMessage("");
      setErrorMessage("");
      onViewChange(section);
    },
    [onViewChange],
  );

  const openNotification = async (item: (typeof operationsRecent)[number]) => {
    if (item.unread) {
      await authFetch("/api/admin/operations/inbox", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: item.id, read: true }),
      }).catch(() => undefined);
    }
    window.location.assign(item.deepLink);
  };

  const ensureStepUpToken = async (): Promise<string | null> => {
    const result = await ensureStepUpTokenResult();
    if (!result.ok) {
      // A dismissed dialog is a decision; a failed verification is news. The
      // panels consuming this wrapper bail out silently on null, so a real
      // failure must surface here or the click does nothing at all.
      if (!("cancelled" in result)) setErrorMessage(result.error);
      return null;
    }
    return result.token;
  };

  const handleRevokeSessions = async (role: "admin" | "all") => {
    const label = role === "admin" ? "admin sessions" : "all sessions";
    if (
      !(await confirmAction({
        eyebrow: "session security",
        title: `Revoke ${label}?`,
        description: "This immediately invalidates every affected active token.",
        confirmLabel: "revoke sessions",
        intent: "danger",
      }))
    ) {
      return;
    }
    setRevokeLoading(role);
    setErrorMessage("");
    setStatusMessage("");
    try {
      const stepToken = await ensureStepUpToken();
      if (!stepToken) return;
      const res = await authFetch("/api/admin/tokens/revoke", {
        method: "POST",
        headers: withStepUpHeaders(stepToken, { "Content-Type": "application/json" }),
        body: JSON.stringify({ role }),
      });
      const data = (await res.json().catch(() => ({}))) as SessionRevokeResponse;
      if (!res.ok) {
        throw new Error((data.error as string) || "Failed to revoke sessions");
      }

      const revoked = Array.isArray(data.revoked)
        ? (data.revoked as Array<{ role?: string; tokenVersion?: number }>)
        : [];
      const summary = revoked
        .map((item) =>
          typeof item?.role === "string" ? `${item.role}@v${item.tokenVersion ?? "?"}` : null,
        )
        .filter(Boolean)
        .join(", ");

      if (role === "admin" || role === "all") {
        // Admin session was revoked; reload to force the server auth gate.
        window.location.assign("/admin");
      } else {
        setStatusMessage(`Revoked sessions: ${summary || role}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to revoke sessions";
      setErrorMessage(msg);
    } finally {
      setRevokeLoading(null);
    }
  };

  const availableEventWorkspaces: Array<{ id: EventWorkspace; label: string }> = [
    ...(permissions.viewOperations ? [{ id: "events" as const, label: "events & tickets" }] : []),
    ...(permissions.manageScoring ? [{ id: "scoring" as const, label: "scoring" }] : []),
    ...(permissions.manageContent ? [{ id: "pitches" as const, label: "pitch night" }] : []),
  ];
  const activeEventWorkspace = availableEventWorkspaces.some(
    (workspace) => workspace.id === eventWorkspace,
  )
    ? eventWorkspace
    : availableEventWorkspaces[0]?.id;

  return (
    <div className="mx-auto max-w-7xl px-6 pt-12 pb-24 lg:px-8">
      <header className="mb-6">
        <div className="flex items-center justify-end gap-4">
          <div className="flex items-center gap-4">
            {permissions.viewOperations ? (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setAttentionOpen((current) => !current)}
                  aria-expanded={attentionOpen}
                  aria-controls="operations-attention-popover"
                  aria-label={`${operationsUnread} unread admin notification${operationsUnread === 1 ? "" : "s"}`}
                  className="relative inline-flex min-h-11 items-center gap-2 font-mono text-xs theme-muted hover:opacity-70"
                >
                  <NotificationBell />
                  <span className="hidden sm:inline">notifications</span>
                  {operationsUnread ? (
                    <AdminStatus tone="attention" className="font-bold">
                      {operationsUnread}
                    </AdminStatus>
                  ) : null}
                </button>
                {attentionOpen ? (
                  <section
                    id="operations-attention-popover"
                    aria-label="Recent admin notifications"
                    className="absolute right-0 z-30 mt-2 w-[min(22rem,calc(100vw-3rem))] border theme-border bg-background p-4 shadow-lg"
                  >
                    <p className="font-mono text-micro uppercase tracking-widest theme-muted">
                      notifications
                    </p>
                    {operationsRecent.length ? (
                      <ul className="mt-2 divide-y theme-border">
                        {operationsRecent.map((item) => (
                          <li key={item.id} className="py-3">
                            <button
                              type="button"
                              onClick={() => void openNotification(item)}
                              className="block w-full min-h-11 py-1 text-left hover:opacity-70"
                            >
                              <span className="block font-serif">{item.title}</span>
                              <span className="mt-1 block font-mono text-micro theme-muted">
                                <AdminStatus
                                  tone={
                                    item.severity === "critical"
                                      ? "danger"
                                      : item.status === "resolved"
                                        ? "positive"
                                        : item.unread ||
                                            item.severity === "warning" ||
                                            item.severity === "prompt"
                                          ? "attention"
                                          : "neutral"
                                  }
                                >
                                  {item.unread ? "unread · " : ""}
                                  {item.status} · {item.severity}
                                </AdminStatus>{" "}
                                · {item.category}
                              </span>
                              <span className="mt-1 block font-mono text-micro leading-relaxed theme-faint">
                                {item.body}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-3 font-mono text-xs theme-muted">Nothing needs attention.</p>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setAttentionOpen(false);
                        window.location.assign("/admin?view=overview#notifications");
                      }}
                      className="mt-3 min-h-11 font-mono text-xs underline hover:opacity-70"
                    >
                      open notification inbox →
                    </button>
                  </section>
                ) : null}
              </div>
            ) : null}
            <AdminCommandPalette onNavigate={handleNavigate} permissions={permissions} />
          </div>
        </div>
        <h1 className="mt-2 font-serif text-4xl font-semibold tracking-tight">
          <Link to="/" className="hover:opacity-80 transition-opacity">
            {SITE_BRAND}
          </Link>{" "}
          <span className="theme-muted font-normal">admin</span>
        </h1>
        <AdminSectionNav active={view} onChange={handleViewChange} permissions={permissions} />
      </header>

      {statusMessage || errorMessage ? (
        <div className="mb-4 font-mono text-xs" aria-live="polite">
          {statusMessage ? (
            <p role="status">
              <AdminStatus tone="positive">{statusMessage}</AdminStatus>
            </p>
          ) : null}
          {errorMessage ? (
            <p role="alert">
              <AdminStatus tone="danger">{errorMessage}</AdminStatus>
            </p>
          ) : null}
        </div>
      ) : null}

      {view === "events" ? (
        <section aria-label="Events and tickets" className="space-y-10">
          {availableEventWorkspaces.length > 1 ? (
            <div
              className="flex flex-wrap gap-x-5 gap-y-2 border-y theme-border py-3"
              role="tablist"
              aria-label="Event workspaces"
            >
              {availableEventWorkspaces.map((workspace) => (
                <button
                  key={workspace.id}
                  type="button"
                  role="tab"
                  aria-selected={activeEventWorkspace === workspace.id}
                  aria-controls="event-workspace-panel"
                  onClick={() => setEventWorkspace(workspace.id)}
                  className={`min-h-11 border-b font-mono text-xs hover:opacity-70 ${
                    activeEventWorkspace === workspace.id
                      ? "theme-border-strong text-foreground"
                      : "border-transparent theme-muted"
                  }`}
                >
                  {workspace.label}
                </button>
              ))}
            </div>
          ) : null}
          <PanelBoundary label="event tools">
            <div id="event-workspace-panel" role="tabpanel">
              {activeEventWorkspace === "events" && permissions.viewOperations ? (
                <EventsPanel
                  authFetch={authFetch}
                  onError={setErrorMessage}
                  onStatus={setStatusMessage}
                  ensureStepUpToken={ensureStepUpTokenResult}
                  withStepUpHeaders={withStepUpHeaders}
                  initialEventSlug={targetEvent}
                  permissions={permissions}
                />
              ) : null}
              {activeEventWorkspace === "scoring" && permissions.manageScoring ? (
                <EventScoringPanel
                  authFetch={authFetch}
                  onError={setErrorMessage}
                  onStatus={setStatusMessage}
                  ensureStepUpToken={ensureStepUpTokenResult}
                  withStepUpHeaders={withStepUpHeaders}
                />
              ) : null}
              {activeEventWorkspace === "pitches" && permissions.manageContent ? (
                <PitchesPanel
                  authFetch={authFetch}
                  onError={setErrorMessage}
                  onStatus={setStatusMessage}
                  ensureStepUpToken={ensureStepUpTokenResult}
                  withStepUpHeaders={withStepUpHeaders}
                />
              ) : null}
            </div>
          </PanelBoundary>
        </section>
      ) : null}

      {view === "communications" ? (
        <section aria-label="Communications" className="space-y-10">
          <PanelBoundary label="communications">
            <CommunicationsPanel
              authFetch={authFetch}
              onError={setErrorMessage}
              onStatus={setStatusMessage}
              communicationTab={communicationTab}
              communicationEvent={communicationEvent}
              onCommunicationTabChange={onCommunicationTabChange}
              onCommunicationEventChange={onCommunicationEventChange}
              ensureStepUpToken={ensureStepUpTokenResult}
              withStepUpHeaders={withStepUpHeaders}
              initialEmailStatus={emailStatus}
              initialEmailQuery={emailQuery}
            />
          </PanelBoundary>
        </section>
      ) : null}

      {view === "games" ? (
        <section aria-label="Games" className="space-y-10">
          <PanelBoundary label="game operations">
            <GamePoolsPanel
              authFetch={authFetch}
              onError={setErrorMessage}
              onStatus={setStatusMessage}
            />
            <HotAndColdReviewPanel authFetch={authFetch} onError={setErrorMessage} />
          </PanelBoundary>
        </section>
      ) : null}

      {view === "operations" ? (
        <PanelBoundary label="people and support">
          <AttendeeOperationsPanel
            authFetch={authFetch}
            onError={setErrorMessage}
            onStatus={handleAttendeeOperationsStatus}
            ensureStepUpToken={ensureStepUpTokenResult}
            withStepUpHeaders={withStepUpHeaders}
            tab={operationsTab}
            onTabChange={onOperationsTabChange}
            initialEvent={targetEvent}
            initialTicket={targetTicket}
            initialPerson={targetPerson}
            onPersonChange={onOperationsPersonChange}
            availableTabs={OPERATIONS_TABS.filter((tab) =>
              tab === "people" ? permissions.managePeople : permissions.viewOperations,
            )}
          />
        </PanelBoundary>
      ) : null}

      {view === "settings" ? (
        <PanelBoundary label="access policies">
          <AttendeeSettingsPanel
            authFetch={authFetch}
            onError={setErrorMessage}
            onStatus={setStatusMessage}
            ensureStepUpToken={ensureStepUpTokenResult}
            withStepUpHeaders={withStepUpHeaders}
          />
        </PanelBoundary>
      ) : null}

      <section className="space-y-10">
        {view === "overview" ? (
          <>
            <PanelBoundary label="overview">
              <AdminOverviewPanel
                content={content}
                system={debugData}
                loading={loading || !dashboardLoaded}
                unresolvedByCategory={operationsUnresolvedByCategory}
                onRefresh={() => void Promise.all([refreshDashboard(), refreshOperationsInbox()])}
                onNavigate={handleNavigate}
                permissions={permissions}
              />
            </PanelBoundary>

            {permissions.viewAudit ? (
              <PanelBoundary label="reports">
                <ReportsPanel
                  authFetch={authFetch}
                  onError={setErrorMessage}
                  onStatus={setStatusMessage}
                />
              </PanelBoundary>
            ) : null}

            {permissions.viewOperations ? (
              <div className="border-t theme-border pt-8">
                <PanelBoundary label="support inbox">
                  <AttendeeOperationsPanel
                    authFetch={authFetch}
                    onError={setErrorMessage}
                    onStatus={handleAttendeeOperationsStatus}
                    ensureStepUpToken={ensureStepUpTokenResult}
                    withStepUpHeaders={withStepUpHeaders}
                    tab="inbox"
                    onTabChange={onOperationsTabChange}
                    onPersonChange={onOperationsPersonChange}
                    inboxOnly
                    availableTabs={["inbox"]}
                  />
                </PanelBoundary>
              </div>
            ) : null}
          </>
        ) : null}

        {view === "system" ? (
          <>
            <PanelBoundary label="system health">
              <SystemHealthPanel
                snapshot={debugData}
                loading={loading || !dashboardLoaded}
                onRefresh={() => void refreshDashboard()}
              />
            </PanelBoundary>

            <div className="border-t theme-border pt-6 space-y-3">
              <div className="flex items-center justify-between gap-4">
                <p className="font-mono text-xs theme-muted">multiplayer runtime</p>
                <p className="font-mono text-micro theme-faint truncate">
                  {debugData?.multiplayer.backplane.mode ?? "—"} fan-out · replica{" "}
                  {debugData?.multiplayer.replica ?? "not checked"}
                </p>
              </div>
              <div className="grid sm:grid-cols-2 gap-3 font-mono text-sm">
                {debugData
                  ? Object.entries(debugData.multiplayer.games).map(([game, metrics]) => (
                      <div key={game} className="border theme-border rounded-md p-3 space-y-1">
                        <div className="flex items-center justify-between gap-3">
                          <p className="theme-muted text-xs">{game}</p>
                          <p className="text-xs">
                            <AdminStatus tone={metrics.activeSockets > 0 ? "positive" : "neutral"}>
                              {metrics.activeSockets} active
                            </AdminStatus>{" "}
                            · {metrics.unauthenticatedSockets} pending
                          </p>
                        </div>
                        <p className="text-lg">{metrics.operations} operations</p>
                        <p className="theme-faint text-micro">
                          {metrics.operationFailures > 0 ? (
                            <AdminStatus tone="danger">
                              {metrics.operationFailures} failed
                            </AdminStatus>
                          ) : (
                            <span>0 failed</span>
                          )}{" "}
                          ·{" "}
                          {metrics.rateLimited > 0 ? (
                            <AdminStatus tone="attention">
                              {metrics.rateLimited} rate limited
                            </AdminStatus>
                          ) : (
                            <span>0 rate limited</span>
                          )}
                        </p>
                        <p className="theme-faint text-micro">
                          {metrics.connections} socket connections · {metrics.reconnects} reconnects
                        </p>
                        <p className="theme-faint text-micro">
                          reconciliation {metrics.reconciliation.averageMs ?? "—"}ms avg ·{" "}
                          {metrics.reconciliation.maxMs ?? "—"}ms max
                        </p>
                        <p className="theme-faint text-micro">
                          socket closes{" "}
                          {Object.entries(metrics.socketTerminations)
                            .map(([reason, count]) => `${reason} ${count}`)
                            .join(" · ") || "none"}
                        </p>
                      </div>
                    ))
                  : null}
                <div className="border theme-border rounded-md p-3 space-y-1">
                  <p className="theme-muted text-xs">room locks</p>
                  <p className="text-lg">
                    {debugData?.multiplayer.roomLock.acquisitions ?? "—"} acquisitions
                  </p>
                  <p className="theme-faint text-micro">
                    {(debugData?.multiplayer.roomLock.contention ?? 0) > 0 ? (
                      <AdminStatus tone="attention">
                        {debugData?.multiplayer.roomLock.contention} contended
                      </AdminStatus>
                    ) : (
                      <span>{debugData?.multiplayer.roomLock.contention ?? "—"} contended</span>
                    )}{" "}
                    ·{" "}
                    {(debugData?.multiplayer.roomLock.failures ?? 0) > 0 ? (
                      <AdminStatus tone="danger">
                        {debugData?.multiplayer.roomLock.failures} failed
                      </AdminStatus>
                    ) : (
                      <span>{debugData?.multiplayer.roomLock.failures ?? "—"} failed</span>
                    )}
                  </p>
                  <p className="theme-faint text-micro">
                    wait {debugData?.multiplayer.roomLock.wait.averageMs ?? "—"}ms avg ·{" "}
                    {debugData?.multiplayer.roomLock.wait.maxMs ?? "—"}ms max
                  </p>
                </div>
              </div>
              <p className="font-mono text-micro theme-faint">
                Backplane {debugData?.multiplayer.backplane.published ?? "—"} published ·{" "}
                {debugData?.multiplayer.backplane.received ?? "—"} received ·{" "}
                {(debugData?.multiplayer.backplane.failures ?? 0) > 0 ? (
                  <AdminStatus tone="danger">
                    {debugData?.multiplayer.backplane.failures} failed
                  </AdminStatus>
                ) : (
                  <span>{debugData?.multiplayer.backplane.failures ?? "—"} failed</span>
                )}
                . Per-replica counters reset on deploy; Railway logs retain operational history.
              </p>
              <p className="font-mono text-micro theme-faint">
                Pools {debugData?.gamePools.openRuns ?? "—"} open runs ·{" "}
                {debugData?.gamePools.openRooms ?? "—"} rooms ·{" "}
                {debugData?.gamePools.activeAssignments ?? "—"} assignments · allocation{" "}
                {debugData?.gamePools.allocation.averageMs ?? "—"}ms average ·{" "}
                {(debugData?.gamePools.allocation.contention ?? 0) > 0 ? (
                  <AdminStatus tone="attention">
                    {debugData?.gamePools.allocation.contention} contended
                  </AdminStatus>
                ) : (
                  <span>{debugData?.gamePools.allocation.contention ?? "—"} contended</span>
                )}
              </p>
            </div>

            {permissions.manageGlobalSettings ? (
              <div className="border-t theme-border pt-6 space-y-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p className="font-mono text-xs theme-muted">session security</p>
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      disabled={revokeLoading !== null}
                      onClick={() => void handleRevokeSessions("admin")}
                      className="inline-flex min-h-11 items-center font-mono text-xs text-[var(--prose-hashtag)] hover:opacity-80 transition-opacity disabled:opacity-50"
                      title="Invalidates every active admin token immediately."
                    >
                      {revokeLoading === "admin" ? "revoking..." : "revoke admin sessions"}
                    </button>
                    <button
                      type="button"
                      disabled={revokeLoading !== null}
                      onClick={() => void handleRevokeSessions("all")}
                      className="inline-flex min-h-11 items-center font-mono text-xs text-[var(--prose-hashtag)] hover:opacity-80 transition-opacity disabled:opacity-50"
                      title="Invalidates upload and admin tokens globally."
                    >
                      {revokeLoading === "all" ? "revoking..." : "revoke all sessions"}
                    </button>
                  </div>
                </div>
                <PanelBoundary label="token sessions">
                  <TokenSessionsPanel
                    isAuthed={true}
                    authFetch={authFetch}
                    formatRemaining={formatRemaining}
                    ensureStepUpToken={ensureStepUpToken}
                    onError={(msg) => setErrorMessage(msg)}
                    onStatus={(msg) => setStatusMessage(msg)}
                  />
                </PanelBoundary>
                {debugData?.securityWarnings.length ? (
                  <ul className="space-y-1">
                    {debugData.securityWarnings.map((warning) => (
                      <li key={warning} className="font-mono text-xs">
                        <AdminStatus tone="danger">{warning}</AdminStatus>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="font-mono text-xs theme-muted">
                    No critical auth-secret warnings detected.
                  </p>
                )}
              </div>
            ) : null}
          </>
        ) : null}

        {view === "content" ? (
          <PanelBoundary label="content tools">
            <ContentPanel
              authFetch={authFetch}
              ensureStepUpToken={ensureStepUpTokenResult}
              withStepUpHeaders={withStepUpHeaders}
              onError={setErrorMessage}
              onStatus={setStatusMessage}
              content={content}
              onContentChanged={() => void refreshDashboard()}
            />
          </PanelBoundary>
        ) : null}

        {view === "transfers" ? (
          <PanelBoundary label="file delivery">
            <TransfersPanel
              authFetch={authFetch}
              ensureStepUpToken={ensureStepUpToken}
              withStepUpHeaders={withStepUpHeaders}
              onError={setErrorMessage}
              onStatus={setStatusMessage}
            />
          </PanelBoundary>
        ) : null}

        {view === "best-dressed" ? (
          <PanelBoundary label="best dressed voting">
            <BestDressedPanel
              authFetch={authFetch}
              ensureStepUpToken={ensureStepUpToken}
              onError={setErrorMessage}
              onStatus={setStatusMessage}
            />
          </PanelBoundary>
        ) : null}
      </section>
      {actionDialog}
      {authDialog}
    </div>
  );
}

function PanelBoundary({ children, label }: { children: ReactNode; label: string }) {
  return <Suspense fallback={<PanelFallback label={label} />}>{children}</Suspense>;
}

function PanelFallback({ label }: { label: string }) {
  return (
    <p className="border-y theme-border py-6 font-mono text-xs theme-muted" role="status">
      loading {label}…
    </p>
  );
}

function NotificationBell() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="size-4"
    >
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" />
      <path d="M10 21h4" />
    </svg>
  );
}
