"use client";

import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import type { SystemCapabilities } from "@/features/system/capabilities";
import type { MultiplayerTelemetrySnapshot } from "@/features/things/shared/multiplayer-telemetry";
import { SITE_BRAND } from "@/lib/shared/config";
import { TokenSessionsPanel } from "./components/TokenSessionsPanel";
import { ContentPanel } from "./components/ContentPanel";
import { TransfersPanel } from "./components/TransfersPanel";
import { ReportsPanel } from "./components/ReportsPanel";
import { EventsPanel } from "./components/EventsPanel";
import { EventScoringPanel } from "./components/EventScoringPanel";
import { PitchesPanel } from "./components/PitchesPanel";
import { GamePoolsPanel } from "./components/GamePoolsPanel";
import { BestDressedPanel } from "./components/BestDressedPanel";
import { AdminOverviewPanel } from "./components/AdminOverviewPanel";
import { SystemHealthPanel } from "./components/SystemHealthPanel";
import { CommunicationsPanel } from "./components/CommunicationsPanel";
import {
  AdminSectionNav,
  type AdminSection,
  type CommunicationsTab,
} from "./components/AdminSectionNav";
import { useAdminAuth } from "@/features/auth/useAdminAuth";
import { useActionDialog } from "@/hooks/useActionDialog";
import { formatRemaining } from "./format";

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
    oldestPendingAt: string | null;
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

export function AdminDashboard({
  view,
  communicationTab,
  communicationEvent,
  onViewChange,
  onCommunicationTabChange,
  onCommunicationEventChange,
}: {
  view: AdminSection;
  communicationTab: CommunicationsTab;
  communicationEvent?: string;
  onViewChange: (section: AdminSection) => void;
  onCommunicationTabChange: (tab: CommunicationsTab) => void;
  onCommunicationEventChange: (eventSlug: string) => void;
}) {
  const { confirm: confirmAction, dialog: actionDialog } = useActionDialog();
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [content, setContent] = useState<ContentSummaryResponse | null>(null);
  const [revokeLoading, setRevokeLoading] = useState<"admin" | "all" | null>(null);
  const [debugData, setDebugData] = useState<DebugResponse | null>(null);

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
        authFetch("/api/admin/content-summary"),
        authFetch("/api/debug"),
      ]);

      if (contentResult.status === "fulfilled" && contentResult.value.ok) {
        try {
          setContent((await contentResult.value.json()) as ContentSummaryResponse);
        } catch {
          errors.push("The content summary returned an unreadable response.");
        }
      } else {
        errors.push("The content summary could not be loaded.");
      }

      if (debugResult.status === "fulfilled" && debugResult.value.ok) {
        try {
          setDebugData((await debugResult.value.json()) as DebugResponse);
        } catch {
          errors.push("The system check returned an unreadable response.");
        }
      } else {
        errors.push("The system check could not be loaded.");
      }

      setErrorMessage(errors.join(" "));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to refresh dashboard";
      setErrorMessage(msg);
    } finally {
      setLoading(false);
    }
  }, [authFetch]);

  useEffect(() => {
    if (view === "overview" || view === "system") void refreshDashboard();
  }, [refreshDashboard, view]);

  const ensureStepUpToken = async (): Promise<string | null> => {
    const result = await ensureStepUpTokenResult();
    if (!result.ok) return null;
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

  return (
    <div className="mx-auto max-w-7xl px-6 pt-12 pb-24 lg:px-8">
      <header className="mb-10">
        <p className="font-mono text-micro font-bold uppercase tracking-widest theme-muted">
          private workspace
        </p>
        <h1 className="mt-2 font-serif text-4xl font-semibold tracking-tight">
          <Link to="/" className="hover:opacity-80 transition-opacity">
            {SITE_BRAND}
          </Link>{" "}
          <span className="theme-muted font-normal">admin</span>
        </h1>
        <p className="mt-3 max-w-lg font-mono text-xs leading-relaxed theme-muted">
          Choose a purpose. Each area contains only the information and actions needed for that job.
        </p>
        <AdminSectionNav active={view} onChange={onViewChange} />
      </header>

      {statusMessage || errorMessage ? (
        <div className="mb-8 border-y theme-border py-3 font-mono text-xs" aria-live="polite">
          {statusMessage ? <p role="status">{statusMessage}</p> : null}
          {errorMessage ? (
            <p role="alert" className="text-[var(--prose-hashtag)]">
              {errorMessage}
            </p>
          ) : null}
        </div>
      ) : null}

      {view === "events" ? (
        <section aria-labelledby="events-view-heading" className="space-y-10">
          <div className="border-b theme-border pb-6">
            <p className="font-mono text-micro font-bold uppercase tracking-widest theme-muted">
              live operations
            </p>
            <h2
              id="events-view-heading"
              className="mt-2 font-serif text-3xl font-semibold tracking-tight"
            >
              Events and tickets
            </h2>
            <p className="mt-2 font-mono text-xs leading-relaxed theme-muted">
              Create events, issue and manage tickets, and make revocable scanner links for each
              worker.
            </p>
          </div>
          <EventsPanel
            authFetch={authFetch}
            onError={setErrorMessage}
            onStatus={setStatusMessage}
            ensureStepUpToken={ensureStepUpTokenResult}
            withStepUpHeaders={withStepUpHeaders}
          />
          <EventScoringPanel
            authFetch={authFetch}
            onError={setErrorMessage}
            onStatus={setStatusMessage}
            ensureStepUpToken={ensureStepUpTokenResult}
            withStepUpHeaders={withStepUpHeaders}
          />
          <div className="border-t theme-border pt-8">
            <PitchesPanel
              authFetch={authFetch}
              onError={setErrorMessage}
              onStatus={setStatusMessage}
            />
          </div>
        </section>
      ) : null}

      {view === "communications" ? (
        <section aria-labelledby="communications-view-heading" className="space-y-10">
          <div className="border-b theme-border pb-6">
            <p className="font-mono text-micro font-bold uppercase tracking-widest theme-muted">
              people and outreach
            </p>
            <h2
              id="communications-view-heading"
              className="mt-2 font-serif text-3xl font-semibold tracking-tight"
            >
              Communications
            </h2>
            <p className="mt-2 font-mono text-xs leading-relaxed theme-muted">
              Prepare newsletters and useful updates, choose the right people, and schedule them
              through the durable email outbox.
            </p>
          </div>
          <CommunicationsPanel
            authFetch={authFetch}
            onError={setErrorMessage}
            onStatus={setStatusMessage}
            communicationTab={communicationTab}
            communicationEvent={communicationEvent}
            onCommunicationTabChange={onCommunicationTabChange}
            onCommunicationEventChange={onCommunicationEventChange}
          />
        </section>
      ) : null}

      {view === "games" ? (
        <section aria-labelledby="games-view-heading" className="space-y-10">
          <div className="border-b theme-border pb-6">
            <p className="font-mono text-micro font-bold uppercase tracking-widest theme-muted">
              shared multiplayer
            </p>
            <h2
              id="games-view-heading"
              className="mt-2 font-serif text-3xl font-semibold tracking-tight"
            >
              Game-night entrances
            </h2>
            <p className="mt-2 font-mono text-xs leading-relaxed theme-muted">
              Set the experience once, share one QR code, and let the server fill rooms.
            </p>
          </div>
          <GamePoolsPanel
            authFetch={authFetch}
            onError={setErrorMessage}
            onStatus={setStatusMessage}
          />
        </section>
      ) : null}

      <section className="space-y-10">
        {view === "overview" ? (
          <>
            <AdminOverviewPanel
              content={content}
              system={debugData}
              loading={loading}
              onRefresh={() => void refreshDashboard()}
              onViewChange={onViewChange}
            />

            <ReportsPanel
              authFetch={authFetch}
              onError={setErrorMessage}
              onStatus={setStatusMessage}
            />
          </>
        ) : null}

        {view === "system" ? (
          <>
            <SystemHealthPanel
              snapshot={debugData}
              loading={loading}
              onRefresh={() => void refreshDashboard()}
            />

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
                            {metrics.activeSockets} active · {metrics.unauthenticatedSockets}{" "}
                            pending
                          </p>
                        </div>
                        <p className="text-lg">{metrics.operations} operations</p>
                        <p className="theme-faint text-micro">
                          {metrics.operationFailures} failed · {metrics.rateLimited} rate limited
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
                    {debugData?.multiplayer.roomLock.contention ?? "—"} contended ·{" "}
                    {debugData?.multiplayer.roomLock.failures ?? "—"} failed
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
                {debugData?.multiplayer.backplane.failures ?? "—"} failed. Per-replica counters
                reset on deploy; Railway logs retain operational history.
              </p>
              <p className="font-mono text-micro theme-faint">
                Pools {debugData?.gamePools.openRuns ?? "—"} open runs ·{" "}
                {debugData?.gamePools.openRooms ?? "—"} rooms ·{" "}
                {debugData?.gamePools.activeAssignments ?? "—"} assignments · allocation{" "}
                {debugData?.gamePools.allocation.averageMs ?? "—"}ms average ·{" "}
                {debugData?.gamePools.allocation.contention ?? "—"} contended
              </p>
            </div>

            <div className="border-t theme-border pt-6 space-y-3">
              <div className="flex items-center justify-between">
                <p className="font-mono text-xs theme-muted">session security</p>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    disabled={revokeLoading !== null}
                    onClick={() => void handleRevokeSessions("admin")}
                    className="font-mono text-xs text-[var(--prose-hashtag)] hover:opacity-80 transition-opacity disabled:opacity-50"
                    title="Invalidates every active admin token immediately."
                  >
                    {revokeLoading === "admin" ? "revoking..." : "revoke admin sessions"}
                  </button>
                  <button
                    type="button"
                    disabled={revokeLoading !== null}
                    onClick={() => void handleRevokeSessions("all")}
                    className="font-mono text-xs text-[var(--prose-hashtag)] hover:opacity-80 transition-opacity disabled:opacity-50"
                    title="Invalidates upload and admin tokens globally."
                  >
                    {revokeLoading === "all" ? "revoking..." : "revoke all sessions"}
                  </button>
                </div>
              </div>
              <TokenSessionsPanel
                isAuthed={true}
                authFetch={authFetch}
                formatRemaining={formatRemaining}
                ensureStepUpToken={ensureStepUpToken}
                onError={(msg) => setErrorMessage(msg)}
                onStatus={(msg) => setStatusMessage(msg)}
              />
              {debugData?.securityWarnings.length ? (
                <ul className="space-y-1">
                  {debugData.securityWarnings.map((warning) => (
                    <li key={warning} className="font-mono text-xs text-[var(--prose-hashtag)]">
                      {warning}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="font-mono text-xs theme-muted">
                  No critical auth-secret warnings detected.
                </p>
              )}
            </div>
          </>
        ) : null}

        {view === "content" ? (
          <ContentPanel
            authFetch={authFetch}
            ensureStepUpToken={ensureStepUpTokenResult}
            withStepUpHeaders={withStepUpHeaders}
            onError={setErrorMessage}
            onStatus={setStatusMessage}
            content={content}
            onContentChanged={() => void refreshDashboard()}
          />
        ) : null}

        {view === "transfers" ? (
          <TransfersPanel
            authFetch={authFetch}
            ensureStepUpToken={ensureStepUpToken}
            withStepUpHeaders={withStepUpHeaders}
            onError={setErrorMessage}
            onStatus={setStatusMessage}
          />
        ) : null}

        {view === "best-dressed" ? (
          <BestDressedPanel
            authFetch={authFetch}
            ensureStepUpToken={ensureStepUpToken}
            onError={setErrorMessage}
            onStatus={setStatusMessage}
          />
        ) : null}
      </section>
      {actionDialog}
      {authDialog}
    </div>
  );
}
