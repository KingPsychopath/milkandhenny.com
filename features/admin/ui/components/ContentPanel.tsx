"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";

import { useActionDialog } from "@/hooks/useActionDialog";
import { formatBytes, formatDate } from "../format";
import { AlbumManagerPanel } from "./AlbumManagerPanel";
import { AdminStatus } from "./AdminStatus";

type AuthFetch = (url: string, options?: RequestInit) => Promise<Response>;
type StepUp = () => Promise<
  { ok: true; token: string } | { ok: false; cancelled: true } | { ok: false; error: string }
>;
type StepUpHeaders = (token: string, extra?: Record<string, string>) => Record<string, string>;

/** The slice of the dashboard content summary this panel renders. */
type ContentRecents = {
  blog: { recent: Array<{ slug: string; title: string; readingTime: number }> };
  gallery: { recent: Array<{ slug: string; title: string; photoCount: number }> };
};

type SharedWordSummary = {
  slug: string;
  title: string;
  type: "blog" | "note" | "recipe" | "review";
  visibility: "public" | "unlisted" | "private";
  activeShareCount: number;
  pinProtectedCount: number;
  nextExpiryAt: string;
};

type WordMediaOrphanFolder = {
  slug: string;
  objectCount: number;
  totalBytes: number;
  latestModifiedAt: string | null;
};

type WordMediaOrphanSummary = {
  r2Configured: boolean;
  scannedFolders: number;
  linkedWords: number;
  orphanFolders: number;
  orphanObjects: number;
  orphanBytes: number;
  orphans: WordMediaOrphanFolder[];
};

type AlbumValidationIssue = {
  slug: string;
  errors: string[];
};

type BrokenBlogRef = {
  postSlug: string;
  line: number;
  ref: string;
  key: string;
};

type ContentAuditResponse = {
  albumValidation: {
    invalidCount: number;
    invalidAlbums: AlbumValidationIssue[];
  };
  blogAudit:
    | {
        r2Configured: false;
        checkedPosts: number;
        checkedRefs: number;
        brokenRefs: BrokenBlogRef[];
        reason: string;
      }
    | {
        r2Configured: true;
        checkedPosts: number;
        checkedRefs: number;
        brokenRefs: BrokenBlogRef[];
      };
  auditedAt: string;
};

type SharedWordsResponse = {
  error?: string;
  items?: SharedWordSummary[];
};

type SharedWordsActionResponse = {
  error?: string;
  revoked?: number;
  removedExpired?: number;
  removedRevoked?: number;
  staleIndexRemoved?: number;
  deletedLinks?: number;
  scannedSlugs?: number;
};

type WordMediaCleanupResponse = {
  error?: string;
  deletedFolders?: number;
  deletedObjects?: number;
  deletedBytes?: number;
  deletedIncomingObjects?: number;
  deletedIncomingBytes?: number;
};

type AuditView = "all" | "broken-refs" | "invalid-albums";
type ContentWorkspace = "albums" | "sharing" | "recent" | "maintenance";

export function ContentPanel({
  authFetch,
  ensureStepUpToken,
  withStepUpHeaders,
  onError,
  onStatus,
  content,
  onContentChanged,
}: {
  authFetch: AuthFetch;
  ensureStepUpToken: StepUp;
  withStepUpHeaders: StepUpHeaders;
  onError: (message: string) => void;
  onStatus: (message: string) => void;
  content: ContentRecents | null;
  onContentChanged: () => void;
}) {
  const { confirm: confirmAction, dialog: actionDialog } = useActionDialog();
  const [workspace, setWorkspace] = useState<ContentWorkspace>("albums");
  const [audit, setAudit] = useState<ContentAuditResponse | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditView, setAuditView] = useState<AuditView>("all");
  const [showAllBrokenRefs, setShowAllBrokenRefs] = useState(false);
  const [sharedWords, setSharedWords] = useState<SharedWordSummary[]>([]);
  const [sharedWordsLoading, setSharedWordsLoading] = useState(false);
  const [sharedWordsLoaded, setSharedWordsLoaded] = useState(false);
  const [sharedWordsError, setSharedWordsError] = useState<string | null>(null);
  const [sharedWordQuery, setSharedWordQuery] = useState("");
  const [showAllSharedWords, setShowAllSharedWords] = useState(false);
  const [wordMediaOrphans, setWordMediaOrphans] = useState<WordMediaOrphanSummary | null>(null);
  const [wordMediaOrphansLoading, setWordMediaOrphansLoading] = useState(false);
  const [wordMediaOrphansError, setWordMediaOrphansError] = useState<string | null>(null);
  const [wordMediaCleanupLoading, setWordMediaCleanupLoading] = useState(false);
  const [showAllMediaOrphans, setShowAllMediaOrphans] = useState(false);
  const [sharedWordActionLoading, setSharedWordActionLoading] = useState<string | null>(null);
  const [sharedWordCleanupLoading, setSharedWordCleanupLoading] = useState(false);
  const [sharedWordPurgeLoading, setSharedWordPurgeLoading] = useState(false);

  const auditResultsRef = useRef<HTMLDivElement | null>(null);

  const requireStepUpToken = async (): Promise<string | null> => {
    const result = await ensureStepUpToken();
    if (!result.ok) {
      if ("error" in result) onError(result.error);
      return null;
    }
    return result.token;
  };

  const loadSharedWords = useCallback(async () => {
    setSharedWordsLoading(true);
    setSharedWordsError(null);
    onError("");
    try {
      const res = await authFetch("/api/admin/word-shares");
      const data = (await res.json().catch(() => ({}))) as SharedWordsResponse;
      if (!res.ok) {
        throw new Error((data.error as string) || "Failed to load shared pages");
      }
      setSharedWords((data.items as SharedWordSummary[]) ?? []);
      setSharedWordsLoaded(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load shared pages";
      setSharedWordsError(msg);
      onError(msg);
    } finally {
      setSharedWordsLoading(false);
    }
  }, [authFetch, onError]);

  const loadWordMediaOrphans = useCallback(async () => {
    setWordMediaOrphansLoading(true);
    setWordMediaOrphansError(null);
    onError("");
    try {
      const res = await authFetch("/api/admin/word-media/orphans?limit=100");
      const data = (await res.json().catch(() => ({}))) as WordMediaOrphanSummary & {
        error?: string;
      };
      if (!res.ok) {
        throw new Error((data.error as string) || "Failed to load orphan media stats");
      }
      setWordMediaOrphans(data as WordMediaOrphanSummary);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load orphan media stats";
      setWordMediaOrphansError(msg);
      onError(msg);
    } finally {
      setWordMediaOrphansLoading(false);
    }
  }, [authFetch, onError]);

  useEffect(() => {
    if (workspace === "sharing" || workspace === "maintenance") void loadSharedWords();
  }, [loadSharedWords, workspace]);

  useEffect(() => {
    if (workspace === "maintenance") void loadWordMediaOrphans();
  }, [loadWordMediaOrphans, workspace]);

  const runContentAudit = async (refresh = false) => {
    setAuditLoading(true);
    onError("");
    onStatus("");
    try {
      const res = await authFetch(`/api/admin/content-audit${refresh ? "?refresh=1" : ""}`);
      const data = (await res.json().catch(() => ({}))) as Partial<ContentAuditResponse> & {
        error?: string;
        cached?: boolean;
      };
      if (!res.ok) {
        throw new Error((data.error as string) || "Failed to run content audit");
      }
      setAudit(data as ContentAuditResponse);
      setAuditView("all");
      setShowAllBrokenRefs(false);
      onStatus(data.cached ? "Loaded cached content audit." : "Content audit completed.");
      // Defer so the results section exists in the DOM.
      setTimeout(() => {
        auditResultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 0);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Content audit failed";
      onError(msg);
    } finally {
      setAuditLoading(false);
    }
  };

  const handleRevokeSharedWord = async (slug: string) => {
    if (
      !(await confirmAction({
        eyebrow: "shared pages",
        title: `Revoke links for “${slug}”?`,
        description: "Every active share URL for this page will immediately stop working.",
        confirmLabel: "revoke links",
        intent: "danger",
      }))
    ) {
      return;
    }
    setSharedWordActionLoading(slug);
    onError("");
    onStatus("");
    try {
      const stepToken = await requireStepUpToken();
      if (!stepToken) return;
      const res = await authFetch("/api/admin/word-shares", {
        method: "POST",
        headers: withStepUpHeaders(stepToken, { "Content-Type": "application/json" }),
        body: JSON.stringify({ slug }),
      });
      const data = (await res.json().catch(() => ({}))) as SharedWordsActionResponse;
      if (!res.ok) {
        throw new Error((data.error as string) || "Failed to revoke shared links");
      }
      onStatus(`Revoked ${data.revoked ?? 0} active share link(s) for "${slug}".`);
      await loadSharedWords();
      onContentChanged();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to revoke shared links";
      onError(msg);
    } finally {
      setSharedWordActionLoading(null);
    }
  };

  const handlePurgeStaleSharedWords = async () => {
    if (
      !(await confirmAction({
        eyebrow: "shared pages",
        title: "Purge stale share links?",
        description:
          "This removes expired and revoked records plus stale index entries. Active links remain untouched.",
        confirmLabel: "purge stale links",
        intent: "danger",
      }))
    ) {
      return;
    }
    setSharedWordCleanupLoading(true);
    onError("");
    onStatus("");
    try {
      const stepToken = await requireStepUpToken();
      if (!stepToken) return;
      const res = await authFetch("/api/admin/word-shares/cleanup", {
        method: "POST",
        headers: withStepUpHeaders(stepToken, { "Content-Type": "application/json" }),
        body: JSON.stringify({ mode: "cleanup" }),
      });
      const data = (await res.json().catch(() => ({}))) as SharedWordsActionResponse;
      if (!res.ok) {
        throw new Error((data.error as string) || "Failed to purge stale share links");
      }
      const msg = `Purge stale complete: expired ${data.removedExpired ?? 0}, revoked ${data.removedRevoked ?? 0}, stale ${data.staleIndexRemoved ?? 0}.`;
      onStatus(msg);
      await loadSharedWords();
      onContentChanged();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to purge stale share links";
      onError(msg);
    } finally {
      setSharedWordCleanupLoading(false);
    }
  };

  const handleNukeSharedWords = async () => {
    if (
      !(await confirmAction({
        eyebrow: "shared pages",
        title: "Delete every shared-page link?",
        description:
          "This permanently deletes all active, expired, and revoked share records across the site.",
        confirmLabel: "delete all links",
        intent: "danger",
      }))
    ) {
      return;
    }
    setSharedWordPurgeLoading(true);
    onError("");
    onStatus("");
    try {
      const stepToken = await requireStepUpToken();
      if (!stepToken) return;
      const res = await authFetch("/api/admin/word-shares/cleanup", {
        method: "POST",
        headers: withStepUpHeaders(stepToken, { "Content-Type": "application/json" }),
        body: JSON.stringify({ mode: "reset" }),
      });
      const data = (await res.json().catch(() => ({}))) as SharedWordsActionResponse;
      if (!res.ok) {
        throw new Error((data.error as string) || "Failed to nuke share links");
      }
      onStatus(
        `Nuke complete: removed ${data.deletedLinks ?? 0} share link(s) across ${data.scannedSlugs ?? 0} slug(s).`,
      );
      await loadSharedWords();
      onContentChanged();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to nuke share links";
      onError(msg);
    } finally {
      setSharedWordPurgeLoading(false);
    }
  };

  const handlePurgeStaleWordMedia = async () => {
    if (
      !(await confirmAction({
        eyebrow: "word media",
        title: "Purge orphaned word media?",
        description: "This deletes stored media folders whose slug no longer has a word page.",
        confirmLabel: "purge media",
        intent: "danger",
      }))
    ) {
      return;
    }

    setWordMediaCleanupLoading(true);
    onError("");
    onStatus("");
    try {
      const stepToken = await requireStepUpToken();
      if (!stepToken) return;
      const res = await authFetch("/api/admin/word-media/orphans", {
        method: "POST",
        headers: withStepUpHeaders(stepToken, { "Content-Type": "application/json" }),
      });
      const data = (await res.json().catch(() => ({}))) as WordMediaCleanupResponse;
      if (!res.ok) {
        throw new Error((data.error as string) || "Failed to purge stale media");
      }
      onStatus(
        `Purge stale media complete: deleted ${data.deletedFolders ?? 0} orphan folder(s), ${data.deletedObjects ?? 0} orphan object(s), ${formatBytes(data.deletedBytes ?? 0)}. Incoming cleanup: ${data.deletedIncomingObjects ?? 0} temp object(s), ${formatBytes(data.deletedIncomingBytes ?? 0)}.`,
      );
      await loadWordMediaOrphans();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to purge stale media";
      onError(msg);
    } finally {
      setWordMediaCleanupLoading(false);
    }
  };

  const filteredSharedWords = useMemo(() => {
    const q = sharedWordQuery.trim().toLowerCase();
    if (!q) return sharedWords;
    return sharedWords.filter(
      (word) =>
        word.slug.toLowerCase().includes(q) ||
        word.title.toLowerCase().includes(q) ||
        word.type.toLowerCase().includes(q),
    );
  }, [sharedWords, sharedWordQuery]);
  const visibleSharedWords = showAllSharedWords
    ? filteredSharedWords
    : filteredSharedWords.slice(0, 12);
  const visibleWordMediaOrphans = showAllMediaOrphans
    ? (wordMediaOrphans?.orphans ?? [])
    : (wordMediaOrphans?.orphans ?? []).slice(0, 12);

  return (
    <>
      <div id="editorial-tools" className="border-t theme-border pt-6 scroll-mt-6">
        <div className="mb-5 border-b theme-border pb-5">
          <p className="font-mono text-micro font-bold uppercase tracking-widest theme-muted">
            publishing
          </p>
          <h2 className="mt-2 font-serif text-3xl font-semibold tracking-tight">Content</h2>
          <p className="mt-2 font-mono text-xs leading-relaxed theme-muted">
            Write, publish, share, and keep media tidy.
          </p>
        </div>
        <p className="font-mono text-xs theme-muted mb-2">common actions</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Link
            to="/admin/editor"
            search={{ slug: undefined }}
            className="border theme-border rounded-md px-3 py-2 font-mono text-sm hover:border-[var(--stone-400)] transition-colors"
          >
            open editor
          </Link>
          <Link
            to="/upload"
            search={{ auth: undefined }}
            className="border theme-border rounded-md px-3 py-2 font-mono text-sm hover:border-[var(--stone-400)] transition-colors"
          >
            open upload
          </Link>
        </div>
        <div
          className="mt-6 flex flex-wrap gap-x-5 gap-y-2 border-y theme-border py-3"
          role="tablist"
          aria-label="Content tools"
        >
          {(
            [
              ["albums", "albums"],
              ["sharing", "shared pages"],
              ["recent", "recent content"],
              ["maintenance", "maintenance"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={workspace === id}
              aria-controls="content-workspace-panel"
              onClick={() => setWorkspace(id)}
              className={`min-h-11 border-b font-mono text-xs hover:opacity-70 ${
                workspace === id
                  ? "theme-border-strong text-foreground"
                  : "border-transparent theme-muted"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div id="content-workspace-panel" role="tabpanel">
        {workspace === "albums" ? (
          <AlbumManagerPanel
            authFetch={authFetch}
            ensureStepUpToken={ensureStepUpToken}
            withStepUpHeaders={withStepUpHeaders}
            onChanged={onContentChanged}
          />
        ) : null}

        {workspace === "sharing" ? (
          <div id="shared-pages" className="border-t theme-border pt-6 space-y-3 scroll-mt-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-mono text-xs theme-muted">currently shared pages</p>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={sharedWordsLoading}
                  onClick={() => void loadSharedWords()}
                  className="font-mono text-xs theme-muted hover:text-[var(--foreground)] transition-colors disabled:opacity-50"
                  title="Refreshes active page-level share status."
                >
                  {sharedWordsLoading ? "refreshing..." : "refresh"}
                </button>
              </div>
            </div>

            <input
              type="text"
              value={sharedWordQuery}
              onChange={(e) => {
                setSharedWordQuery(e.target.value);
                setShowAllSharedWords(false);
              }}
              placeholder="filter by slug, title, or type"
              className="w-full bg-transparent border-b border-[var(--stone-200)] focus:border-[var(--foreground)] outline-none font-mono text-xs py-2 transition-colors placeholder:text-[var(--stone-400)]"
            />

            {sharedWordsLoaded && !sharedWordsError ? (
              <div className="grid grid-cols-1 gap-3 font-mono text-sm sm:grid-cols-3">
                <div className="border theme-border rounded-md p-3">
                  <p className="theme-muted text-xs">shared pages</p>
                  <p className="text-lg">{sharedWords.length}</p>
                </div>
                <div className="border theme-border rounded-md p-3">
                  <p className="theme-muted text-xs">active links</p>
                  <p className="text-lg">
                    {sharedWords.reduce((sum, word) => sum + word.activeShareCount, 0)}
                  </p>
                </div>
                <div className="border theme-border rounded-md p-3">
                  <p className="theme-muted text-xs">pin protected</p>
                  <p className="text-lg">
                    {sharedWords.reduce((sum, word) => sum + word.pinProtectedCount, 0)}
                  </p>
                </div>
              </div>
            ) : null}

            {sharedWordsLoading || (!sharedWordsLoaded && !sharedWordsError) ? (
              <p className="font-mono text-xs theme-muted" role="status">
                Loading shared pages…
              </p>
            ) : null}
            {sharedWordsError ? (
              <div role="alert">
                <p className="font-mono text-xs">
                  <AdminStatus tone="danger">{sharedWordsError}</AdminStatus>
                </p>
                <button
                  type="button"
                  onClick={() => void loadSharedWords()}
                  className="mt-2 min-h-11 font-mono text-xs underline underline-offset-4 hover:opacity-70"
                >
                  try again
                </button>
              </div>
            ) : null}
            {sharedWordsLoaded &&
            filteredSharedWords.length === 0 &&
            !sharedWordsLoading &&
            !sharedWordsError ? (
              <p className="font-mono text-xs theme-muted">No currently shared pages.</p>
            ) : null}

            {sharedWordsLoaded && !sharedWordsError ? (
              <div className="space-y-2">
                {visibleSharedWords.map((word) => (
                  <div key={word.slug} className="border theme-border rounded-md p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-mono text-sm truncate">{word.title}</p>
                        <p className="font-mono text-xs theme-muted truncate">
                          {word.slug} · {word.type} · {word.visibility}
                        </p>
                        <p className="font-mono text-micro theme-faint truncate">
                          <AdminStatus tone="positive">{word.activeShareCount} active</AdminStatus>{" "}
                          · {word.pinProtectedCount} pin · next expires{" "}
                          {formatDate(word.nextExpiryAt)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Link
                          to="/words/$slug"
                          params={{ slug: word.slug }}
                          className="font-mono text-xs theme-muted hover:text-[var(--foreground)] transition-colors"
                          title="Open public page view."
                        >
                          open
                        </Link>
                        <Link
                          to="/admin/editor"
                          search={{ slug: word.slug }}
                          className="font-mono text-xs theme-muted hover:text-[var(--foreground)] transition-colors"
                          title="Open this word in editor share controls."
                        >
                          editor
                        </Link>
                        <button
                          type="button"
                          disabled={sharedWordActionLoading === word.slug}
                          onClick={() => void handleRevokeSharedWord(word.slug)}
                          className="font-mono text-xs text-[var(--prose-hashtag)] hover:opacity-80 transition-opacity disabled:opacity-50"
                          title="Revoke all active share links for this page."
                        >
                          {sharedWordActionLoading === word.slug ? "revoking..." : "revoke all"}
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {sharedWordsLoaded && !sharedWordsError && filteredSharedWords.length > 12 ? (
              <button
                type="button"
                onClick={() => setShowAllSharedWords((v) => !v)}
                className="font-mono text-xs theme-muted hover:text-[var(--foreground)] transition-colors"
              >
                {showAllSharedWords
                  ? "show fewer shared pages"
                  : `show all shared pages (${filteredSharedWords.length})`}
              </button>
            ) : null}
          </div>
        ) : null}

        {workspace === "maintenance" ? (
          <>
            <section
              className="border-t theme-border pt-6"
              aria-labelledby="content-maintenance-heading"
            >
              <p className="font-mono text-micro font-bold uppercase tracking-widest theme-muted">
                diagnostics
              </p>
              <h3
                id="content-maintenance-heading"
                className="mt-2 font-serif text-2xl font-semibold"
              >
                Content maintenance
              </h3>
              <p className="mt-2 max-w-2xl font-mono text-xs leading-relaxed theme-muted">
                Check references and storage health. Cleanup controls stay collapsed until they are
                deliberately opened.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={auditLoading}
                  onClick={() => void runContentAudit()}
                  title="Loads a cached content audit when available."
                  className="min-h-11 border theme-border px-3 font-mono text-xs hover:opacity-70 disabled:opacity-50"
                >
                  {auditLoading ? "auditing…" : "load audit"}
                </button>
                <button
                  type="button"
                  disabled={auditLoading}
                  onClick={() => void runContentAudit(true)}
                  title="Forces a fresh content audit recomputation."
                  className="min-h-11 border theme-border px-3 font-mono text-xs hover:opacity-70 disabled:opacity-50"
                >
                  {auditLoading ? "auditing…" : "run fresh audit"}
                </button>
              </div>
              {audit ? (
                <p className="mt-3 font-mono text-xs theme-muted">
                  Audited {formatDate(audit.auditedAt)} ·{" "}
                  <AdminStatus
                    tone={
                      audit.albumValidation.invalidCount > 0 ||
                      audit.blogAudit.brokenRefs.length > 0
                        ? "danger"
                        : "positive"
                    }
                  >
                    {audit.albumValidation.invalidCount > 0 || audit.blogAudit.brokenRefs.length > 0
                      ? "issues found"
                      : "audit clean"}
                  </AdminStatus>
                </p>
              ) : null}
              <details className="group mt-5 border-y theme-border py-4">
                <summary className="min-h-11 cursor-pointer list-none py-3 font-mono text-xs text-foreground">
                  cleanup controls
                  <span className="float-right theme-muted group-open:hidden">open</span>
                  <span className="float-right hidden theme-muted group-open:inline">close</span>
                </summary>
                <p className="max-w-2xl font-mono text-micro leading-relaxed theme-muted">
                  These actions delete stale records or stored files. Each action still asks for
                  confirmation and elevated verification.
                </p>
                <div className="mt-4 flex flex-wrap gap-3">
                  <button
                    type="button"
                    disabled={sharedWordCleanupLoading}
                    onClick={() => void handlePurgeStaleSharedWords()}
                    className="min-h-11 border theme-border px-3 font-mono text-xs hover:opacity-70 disabled:opacity-50"
                  >
                    {sharedWordCleanupLoading ? "removing…" : "remove stale share links"}
                  </button>
                  <button
                    type="button"
                    disabled={wordMediaCleanupLoading || wordMediaOrphansLoading}
                    onClick={() => void handlePurgeStaleWordMedia()}
                    className="min-h-11 border theme-border px-3 font-mono text-xs hover:opacity-70 disabled:opacity-50"
                  >
                    {wordMediaCleanupLoading ? "removing…" : "remove orphan media"}
                  </button>
                  <button
                    type="button"
                    disabled={sharedWordPurgeLoading}
                    onClick={() => void handleNukeSharedWords()}
                    className="min-h-11 border theme-border px-3 font-mono text-xs text-[var(--prose-hashtag)] hover:opacity-70 disabled:opacity-50"
                  >
                    {sharedWordPurgeLoading ? "removing…" : "remove all share links"}
                  </button>
                </div>
              </details>
            </section>

            <div
              id="word-media-orphans"
              className="border-t theme-border pt-6 space-y-3 scroll-mt-6"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="font-mono text-xs theme-muted">word media orphans</p>
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    disabled={wordMediaOrphansLoading}
                    onClick={() => void loadWordMediaOrphans()}
                    className="font-mono text-xs theme-muted hover:text-[var(--foreground)] transition-colors disabled:opacity-50"
                    title="Scans words/media/ for orphaned slug folders."
                  >
                    {wordMediaOrphansLoading ? "refreshing..." : "refresh"}
                  </button>
                </div>
              </div>

              {wordMediaOrphans && !wordMediaOrphans.r2Configured ? (
                <p className="font-mono text-xs">
                  <AdminStatus tone="neutral">
                    R2 is not configured, so orphan media scanning is unavailable.
                  </AdminStatus>
                </p>
              ) : null}

              {wordMediaOrphansLoading ? (
                <p className="font-mono text-xs theme-muted" role="status">
                  Scanning word media…
                </p>
              ) : null}
              {wordMediaOrphansError ? (
                <div role="alert">
                  <p className="font-mono text-xs">
                    <AdminStatus tone="danger">{wordMediaOrphansError}</AdminStatus>
                  </p>
                  <button
                    type="button"
                    onClick={() => void loadWordMediaOrphans()}
                    className="mt-2 min-h-11 font-mono text-xs underline underline-offset-4 hover:opacity-70"
                  >
                    try again
                  </button>
                </div>
              ) : null}

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono text-sm">
                <div className="border theme-border rounded-md p-3">
                  <p className="theme-muted text-xs">scanned folders</p>
                  <p className="text-lg">{wordMediaOrphans?.scannedFolders ?? "—"}</p>
                </div>
                <div className="border theme-border rounded-md p-3">
                  <p className="theme-muted text-xs">orphan folders</p>
                  <p className="text-lg">
                    {wordMediaOrphans ? (
                      <AdminStatus
                        tone={wordMediaOrphans.orphanFolders > 0 ? "attention" : "positive"}
                      >
                        {wordMediaOrphans.orphanFolders}
                      </AdminStatus>
                    ) : (
                      "—"
                    )}
                  </p>
                </div>
                <div className="border theme-border rounded-md p-3">
                  <p className="theme-muted text-xs">orphan objects</p>
                  <p className="text-lg">{wordMediaOrphans?.orphanObjects ?? "—"}</p>
                </div>
                <div className="border theme-border rounded-md p-3">
                  <p className="theme-muted text-xs">orphan bytes</p>
                  <p className="text-sm">{formatBytes(wordMediaOrphans?.orphanBytes ?? 0)}</p>
                </div>
              </div>

              {wordMediaOrphans &&
              wordMediaOrphans.orphans.length === 0 &&
              !wordMediaOrphansLoading ? (
                <p className="font-mono text-xs theme-muted">No orphan word-media folders.</p>
              ) : null}

              {visibleWordMediaOrphans.length > 0 ? (
                <div className="space-y-2">
                  {visibleWordMediaOrphans.map((folder) => (
                    <div key={folder.slug} className="border theme-border rounded-md p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-mono text-sm truncate">{folder.slug}</p>
                          <p className="font-mono text-xs theme-muted truncate">
                            {folder.objectCount} object(s) · {formatBytes(folder.totalBytes)}
                          </p>
                        </div>
                        <p className="font-mono text-micro theme-faint shrink-0">
                          latest {formatDate(folder.latestModifiedAt)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              {(wordMediaOrphans?.orphans.length ?? 0) > 12 ? (
                <button
                  type="button"
                  onClick={() => setShowAllMediaOrphans((value) => !value)}
                  className="font-mono text-xs theme-muted hover:text-[var(--foreground)] transition-colors"
                >
                  {showAllMediaOrphans
                    ? "show fewer folders"
                    : `show all folders (${wordMediaOrphans?.orphans.length ?? 0})`}
                </button>
              ) : null}
            </div>
          </>
        ) : null}

        {workspace === "recent" ? (
          <>
            {content?.blog.recent?.length ? (
              <div className="border-t theme-border pt-6">
                <p className="font-mono text-xs theme-muted mb-2">recent posts</p>
                <ul className="space-y-1 font-mono text-sm">
                  {content.blog.recent.map((post) => (
                    <li key={post.slug} className="flex items-center justify-between gap-3">
                      <Link
                        to="/words/$slug"
                        params={{ slug: post.slug }}
                        className="truncate hover:opacity-80 transition-opacity"
                      >
                        {post.title}
                      </Link>
                      <span className="theme-muted shrink-0">{post.readingTime} min</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {content?.gallery.recent?.length ? (
              <div className="border-t theme-border pt-6">
                <p className="font-mono text-xs theme-muted mb-2">recent albums</p>
                <ul className="space-y-1 font-mono text-sm">
                  {content.gallery.recent.map((album) => (
                    <li key={album.slug} className="flex items-center justify-between gap-3">
                      <Link
                        to="/pics/$album"
                        params={{ album: album.slug }}
                        className="truncate hover:opacity-80 transition-opacity"
                      >
                        {album.title}
                      </Link>
                      <span className="theme-muted shrink-0">{album.photoCount} photos</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            {!content?.blog.recent?.length && !content?.gallery.recent?.length ? (
              <p className="border-t theme-border py-8 font-mono text-xs theme-muted">
                No recent posts or albums are available yet.
              </p>
            ) : null}
          </>
        ) : null}

        {workspace === "maintenance" && audit ? (
          <div
            id="audit-results"
            ref={auditResultsRef}
            className="border-t theme-border pt-6 space-y-3 scroll-mt-6"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-mono text-xs theme-muted">content audit results</p>
              <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
                <button
                  type="button"
                  onClick={() => setAuditView("all")}
                  className={`min-h-11 px-3 py-1 rounded border transition-colors ${
                    auditView === "all"
                      ? "theme-border text-[var(--foreground)]"
                      : "theme-border-faint theme-muted hover:text-[var(--foreground)]"
                  }`}
                >
                  all
                </button>
                <button
                  type="button"
                  onClick={() => setAuditView("broken-refs")}
                  className={`min-h-11 px-3 py-1 rounded border transition-colors ${
                    auditView === "broken-refs"
                      ? "theme-border text-[var(--foreground)]"
                      : "theme-border-faint theme-muted hover:text-[var(--foreground)]"
                  }`}
                >
                  only missing refs
                </button>
                <button
                  type="button"
                  onClick={() => setAuditView("invalid-albums")}
                  className={`min-h-11 px-3 py-1 rounded border transition-colors ${
                    auditView === "invalid-albums"
                      ? "theme-border text-[var(--foreground)]"
                      : "theme-border-faint theme-muted hover:text-[var(--foreground)]"
                  }`}
                >
                  only invalid albums
                </button>
              </div>
            </div>
            <p className="font-mono text-xs theme-muted">audited {formatDate(audit.auditedAt)}</p>

            {auditView !== "broken-refs" ? (
              <div className="border theme-border rounded-md p-3">
                <p className="font-mono text-xs theme-muted mb-1">album manifest validation</p>
                <p className="font-mono text-sm">
                  <AdminStatus
                    tone={audit.albumValidation.invalidCount > 0 ? "danger" : "positive"}
                  >
                    {audit.albumValidation.invalidCount > 0
                      ? `${audit.albumValidation.invalidCount} invalid albums`
                      : "all album manifests valid"}
                  </AdminStatus>
                </p>
                {audit.albumValidation.invalidAlbums.length > 0 ? (
                  <ul className="mt-2 space-y-2 font-mono text-xs">
                    {audit.albumValidation.invalidAlbums.map((album) => (
                      <li key={album.slug}>
                        <p className="theme-muted">{album.slug}</p>
                        <p>
                          <AdminStatus tone="danger">{album.errors.join(" · ")}</AdminStatus>
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}

            {auditView !== "invalid-albums" ? (
              <div className="border theme-border rounded-md p-3">
                <p className="font-mono text-xs theme-muted mb-1">words media reference audit</p>
                <p className="font-mono text-sm">
                  refs checked: {audit.blogAudit.checkedRefs} ·{" "}
                  <AdminStatus tone={audit.blogAudit.brokenRefs.length > 0 ? "danger" : "positive"}>
                    {audit.blogAudit.brokenRefs.length} broken refs
                  </AdminStatus>
                </p>
                {!audit.blogAudit.r2Configured ? (
                  <p className="font-mono text-xs theme-muted mt-2">{audit.blogAudit.reason}</p>
                ) : null}
                {audit.blogAudit.brokenRefs.length > 0 ? (
                  <>
                    <ul className="mt-2 space-y-2 font-mono text-xs">
                      {(showAllBrokenRefs
                        ? audit.blogAudit.brokenRefs
                        : audit.blogAudit.brokenRefs.slice(0, 20)
                      ).map((ref) => (
                        <li key={`${ref.postSlug}-${ref.line}-${ref.key}`}>
                          <p className="theme-muted">
                            {ref.postSlug} line {ref.line}
                          </p>
                          <p className="truncate">{ref.key}</p>
                        </li>
                      ))}
                    </ul>
                    {audit.blogAudit.brokenRefs.length > 20 ? (
                      <button
                        type="button"
                        onClick={() => setShowAllBrokenRefs((v) => !v)}
                        className="mt-2 font-mono text-xs theme-muted hover:text-[var(--foreground)] transition-colors"
                      >
                        {showAllBrokenRefs
                          ? "show fewer broken refs"
                          : `show all broken refs (${audit.blogAudit.brokenRefs.length})`}
                      </button>
                    ) : null}
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      {actionDialog}
    </>
  );
}
