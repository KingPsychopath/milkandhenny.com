"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { SITE_BRAND } from "@/lib/config";
import { TokenSessionsPanel } from "./components/TokenSessionsPanel";
import { useAdminAuth } from "./hooks/useAdminAuth";

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

type TransferSummary = {
  id: string;
  title: string;
  fileCount: number;
  createdAt: string;
  expiresAt: string;
  remainingSeconds: number;
};

type AdminAlbum = {
  slug: string;
  title: string;
  date: string;
  description?: string;
  cover: string;
  photoCount: number;
  photos: string[];
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

type DebugResponse = {
  status?: string;
  timestamp?: string;
  environment: {
    // Redis env wiring
    hasRedisUrl: boolean;
    hasRedisToken: boolean;
    redisConfigured: boolean;
    redisReachable: boolean | null;
    redisLatencyMs: number | null;
    redisError: string | null;
    source: "KV_REST_API_*" | "UPSTASH_REDIS_*" | "none";

    cronSecretConfigured: boolean;
    cronWarning: string | null;

    // R2/media wiring
    r2PublicUrlConfigured: boolean;
    r2WriteConfigured: boolean;

    // Auth wiring (presence only; no secrets)
    authSecretConfigured: boolean;
    staffPinConfigured: boolean;
    adminPasswordConfigured: boolean;
    uploadPinConfigured: boolean;

    // Runtime meta (safe)
    nodeEnv: string;
    vercelEnv: string | null;
    vercelRegion: string | null;
    vercelCommitSha: string | null;

    securityWarnings?: string[];
  };
  help?: {
    forceReload?: string;
    bootstrap?: string;
  };
};

type AuditView = "all" | "broken-refs" | "invalid-albums";

function formatDate(date: string | null): string {
  if (!date) return "—";
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatRemaining(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "expired";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function AdminDashboard() {
  const [password, setPassword] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");

  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [content, setContent] = useState<ContentSummaryResponse | null>(null);
  const [audit, setAudit] = useState<ContentAuditResponse | null>(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditView, setAuditView] = useState<AuditView>("all");
  const [showAllBrokenRefs, setShowAllBrokenRefs] = useState(false);
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);
  const [albums, setAlbums] = useState<AdminAlbum[]>([]);
  const [albumsLoading, setAlbumsLoading] = useState(false);
  const [albumQuery, setAlbumQuery] = useState("");
  const [showAllAlbums, setShowAllAlbums] = useState(false);
  const [expandedAlbumSlug, setExpandedAlbumSlug] = useState<string | null>(null);
  const [showAllPhotosByAlbum, setShowAllPhotosByAlbum] = useState<Record<string, boolean>>({});
  const [albumActionLoading, setAlbumActionLoading] = useState<string | null>(null);
  const [transfers, setTransfers] = useState<TransferSummary[]>([]);
  const [transfersLoading, setTransfersLoading] = useState(false);
  const [transferQuery, setTransferQuery] = useState("");
  const [showAllTransfers, setShowAllTransfers] = useState(false);
  const [transferActionLoading, setTransferActionLoading] = useState<string | null>(null);
  const [transferCleanupLoading, setTransferCleanupLoading] = useState(false);
  const [transferNukeLoading, setTransferNukeLoading] = useState(false);
  const [transferStatusMessage, setTransferStatusMessage] = useState("");
  const [revokeLoading, setRevokeLoading] = useState<"admin" | "all" | null>(null);
  const [debugData, setDebugData] = useState<DebugResponse | null>(null);

  const transfersSectionRef = useRef<HTMLDivElement | null>(null);
  const auditResultsRef = useRef<HTMLDivElement | null>(null);
  const transferStatusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setTransferStatus = useCallback((msg: string) => {
    setTransferStatusMessage(msg);
    if (transferStatusTimeoutRef.current) {
      clearTimeout(transferStatusTimeoutRef.current);
    }
    transferStatusTimeoutRef.current = setTimeout(() => setTransferStatusMessage(""), 5000);
  }, []);

  useEffect(() => {
    return () => {
      if (transferStatusTimeoutRef.current) clearTimeout(transferStatusTimeoutRef.current);
    };
  }, []);

  const {
    mounted,
    isAuthed,
    authFetch,
    signIn,
    signOut,
    ensureStepUpToken: ensureStepUpTokenResult,
    withStepUpHeaders,
  } = useAdminAuth();

  const refreshDashboard = useCallback(async () => {
    if (!isAuthed) return;
    setLoading(true);
    setErrorMessage("");
    try {
      const [contentRes, debugRes] = await Promise.all([
        authFetch("/api/admin/content-summary"),
        authFetch("/api/debug"),
      ]);

      if (!contentRes.ok) {
        throw new Error("Failed to load content summary");
      }
      if (!debugRes.ok) {
        throw new Error("Failed to load system status");
      }

      const [contentJson, debugJson] = await Promise.all([
        contentRes.json(),
        debugRes.json(),
      ]);

      setContent(contentJson as ContentSummaryResponse);
      setDebugData(debugJson as DebugResponse);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Failed to refresh dashboard";
      setErrorMessage(msg);
    } finally {
      setLoading(false);
    }
  }, [authFetch, isAuthed]);

  useEffect(() => {
    void refreshDashboard();
  }, [refreshDashboard]);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    setAuthLoading(true);
    try {
      const result = await signIn(password);
      if (result.ok) {
        setPassword("");
        setStatusMessage("Admin access unlocked.");
        setTimeout(() => setStatusMessage(""), 2500);
      } else {
        setAuthError(result.error);
      }
    } catch {
      setAuthError("Connection error");
    } finally {
      setAuthLoading(false);
    }
  };

  const loadAlbums = useCallback(async () => {
    if (!isAuthed) return;
    setAlbumsLoading(true);
    setErrorMessage("");
    try {
      const res = await authFetch("/api/admin/albums");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data.error as string) || "Failed to load albums");
      }
      setAlbums((data.albums as AdminAlbum[]) ?? []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load albums";
      setErrorMessage(msg);
    } finally {
      setAlbumsLoading(false);
    }
  }, [authFetch, isAuthed]);

  useEffect(() => {
    void loadAlbums();
  }, [loadAlbums]);

  const loadTransfers = useCallback(async () => {
    if (!isAuthed) return;
    setTransfersLoading(true);
    setErrorMessage("");
    try {
      const res = await authFetch("/api/admin/transfers");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data.error as string) || "Failed to load transfers");
      }
      setTransfers((data.transfers as TransferSummary[]) ?? []);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to load transfers";
      setErrorMessage(msg);
    } finally {
      setTransfersLoading(false);
    }
  }, [authFetch, isAuthed]);

  const loadTransfersAndScroll = useCallback(async () => {
    // Jump immediately so the user sees progress/spinners in the section.
    transfersSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    await loadTransfers();
  }, [loadTransfers]);

  useEffect(() => {
    void loadTransfers();
  }, [loadTransfers]);

  const runContentAudit = async () => {
    setAuditLoading(true);
    setErrorMessage("");
    setStatusMessage("");
    try {
      const res = await authFetch("/api/admin/content-audit");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data.error as string) || "Failed to run content audit");
      }
      setAudit(data as ContentAuditResponse);
      setAuditView("all");
      setShowAllBrokenRefs(false);
      setStatusMessage("Content audit completed.");
      // Defer so the results section exists in the DOM.
      setTimeout(() => {
        auditResultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 0);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Content audit failed";
      setErrorMessage(msg);
    } finally {
      setAuditLoading(false);
    }
  };

  const ensureStepUpToken = async (): Promise<string | null> => {
    const result = await ensureStepUpTokenResult();
    if (!result.ok) return null;
    return result.token;
  };

  const commandHelpers = [
    {
      key: "auth-revoke-admin",
      label: "revoke admin sessions",
      cmd: "pnpm cli auth revoke --admin-token <jwt> --admin-password <password> --role admin --base-url http://localhost:3000",
      tip: "CLI-first kill switch for admin sessions. Requires JWT + step-up password.",
    },
    {
      key: "albums-upload",
      label: "upload new album",
      cmd: "pnpm cli albums upload",
      tip: "Creates a new album manifest and uploads images to R2.",
    },
    {
      key: "photos-add",
      label: "add photos to album",
      cmd: "pnpm cli photos add <album-slug>",
      tip: "Adds new files to an existing album slug.",
    },
    {
      key: "blog-upload",
      label: "upload blog media",
      cmd: "pnpm cli blog upload --slug <post-slug> --dir <path>",
      tip: "Processes images to WebP and prints markdown snippets to paste in posts.",
    },
    {
      key: "blog-list",
      label: "list blog media",
      cmd: "pnpm cli blog list <post-slug>",
      tip: "Lists all uploaded files under blog/<post-slug>/ in R2.",
    },
  ] as const;

  const copyCommand = async (key: string, command: string) => {
    try {
      await navigator.clipboard.writeText(command);
      setCopiedCommand(key);
      setTimeout(() => setCopiedCommand(null), 1800);
    } catch {
      setErrorMessage("Clipboard write failed");
    }
  };

  const handleDeleteAlbum = async (slug: string, title: string) => {
    if (
      !confirm(
        `Delete album "${title}"?\n\nThis removes its JSON manifest and all album files from R2.`
      )
    ) {
      return;
    }
    setAlbumActionLoading(`album:${slug}`);
    setErrorMessage("");
    setStatusMessage("");
    try {
      const stepToken = await ensureStepUpToken();
      if (!stepToken) return;
      const res = await authFetch(`/api/admin/albums/${encodeURIComponent(slug)}`, {
        method: "DELETE",
        headers: withStepUpHeaders(stepToken),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data.error as string) || "Failed to delete album");
      }
      setStatusMessage(`Deleted album "${title}".`);
      if (expandedAlbumSlug === slug) setExpandedAlbumSlug(null);
      await Promise.all([loadAlbums(), refreshDashboard()]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to delete album";
      setErrorMessage(msg);
    } finally {
      setAlbumActionLoading(null);
    }
  };

  const handleDeletePhoto = async (slug: string, photoId: string) => {
    if (
      !confirm(
        `Delete photo "${photoId}" from "${slug}"?\n\nThis removes thumb/full/original/og files from R2 and updates the album manifest.`
      )
    ) {
      return;
    }
    setAlbumActionLoading(`photo:${slug}:${photoId}`);
    setErrorMessage("");
    setStatusMessage("");
    try {
      const stepToken = await ensureStepUpToken();
      if (!stepToken) return;
      const res = await authFetch(
        `/api/admin/albums/${encodeURIComponent(slug)}/photos/${encodeURIComponent(photoId)}`,
        { method: "DELETE", headers: withStepUpHeaders(stepToken) }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data.error as string) || "Failed to delete photo");
      }
      setStatusMessage(`Deleted photo "${photoId}" from "${slug}".`);
      await Promise.all([loadAlbums(), refreshDashboard()]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to delete photo";
      setErrorMessage(msg);
    } finally {
      setAlbumActionLoading(null);
    }
  };

  const handleSetCover = async (slug: string, photoId: string) => {
    setAlbumActionLoading(`cover:${slug}:${photoId}`);
    setErrorMessage("");
    setStatusMessage("");
    try {
      const res = await authFetch(`/api/admin/albums/${encodeURIComponent(slug)}/cover`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data.error as string) || "Failed to set cover");
      }
      setStatusMessage(`Set "${photoId}" as cover for "${slug}".`);
      await Promise.all([loadAlbums(), refreshDashboard()]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to set cover";
      setErrorMessage(msg);
    } finally {
      setAlbumActionLoading(null);
    }
  };

  const handleDeleteTransfer = async (id: string, title: string) => {
    if (
      !confirm(
        `Delete transfer "${title}" (${id})?\n\nThis removes transfer metadata and all transfer files from R2.`
      )
    ) {
      return;
    }
    setTransferActionLoading(id);
    setErrorMessage("");
    setStatusMessage("");
    setTransferStatusMessage("");
    try {
      const stepToken = await ensureStepUpToken();
      if (!stepToken) return;
      const res = await authFetch(`/api/admin/transfers/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: withStepUpHeaders(stepToken),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data.error as string) || "Failed to delete transfer");
      }
      const msg = `Deleted transfer "${title}" (${id}).`;
      setStatusMessage(msg);
      setTransferStatus(msg);
      await loadTransfers();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to delete transfer";
      setErrorMessage(msg);
    } finally {
      setTransferActionLoading(null);
    }
  };

  const handleCleanupExpiredTransfers = async () => {
    if (
      !confirm(
        "Run cleanup for expired/orphaned transfers now?\n\nThis is not a full nuke. Active transfers are kept."
      )
    ) {
      return;
    }
    setTransferCleanupLoading(true);
    setErrorMessage("");
    setStatusMessage("");
    setTransferStatusMessage("");
    try {
      const stepToken = await ensureStepUpToken();
      if (!stepToken) return;
      const res = await authFetch("/api/admin/transfers/cleanup", {
        method: "POST",
        headers: withStepUpHeaders(stepToken),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data.error as string) || "Failed to run cleanup");
      }
      const msg = `Cleanup complete: removed ${data.deletedObjects ?? 0} orphaned files.`;
      setStatusMessage(msg);
      setTransferStatus(msg);
      await loadTransfers();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to run cleanup";
      setErrorMessage(msg);
    } finally {
      setTransferCleanupLoading(false);
    }
  };

  const handleNukeTransfers = async () => {
    if (
      !confirm(
        "NUKE ALL TRANSFERS?\n\nThis deletes ALL active transfers, their metadata, and all transfer files in R2. This cannot be undone."
      )
    ) {
      return;
    }
    setTransferNukeLoading(true);
    setErrorMessage("");
    setStatusMessage("");
    setTransferStatusMessage("");
    try {
      const stepToken = await ensureStepUpToken();
      if (!stepToken) return;
      const res = await authFetch("/api/admin/transfers/nuke", {
        method: "POST",
        headers: withStepUpHeaders(stepToken),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data.error as string) || "Failed to nuke transfers");
      }
      const msg = `Nuke complete: deleted ${data.deletedTransfers ?? 0} transfers and ${data.deletedFiles ?? 0} files.`;
      setStatusMessage(msg);
      setTransferStatus(msg);
      await loadTransfers();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to nuke transfers";
      setErrorMessage(msg);
    } finally {
      setTransferNukeLoading(false);
    }
  };

  const cleanupTransfersAndScroll = async () => {
    transfersSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    await handleCleanupExpiredTransfers();
  };

  const nukeTransfersAndScroll = async () => {
    transfersSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    await handleNukeTransfers();
  };

  const handleRevokeSessions = async (role: "admin" | "all") => {
    const label = role === "admin" ? "admin sessions" : "all role sessions";
    if (!confirm(`Revoke ${label} now?\n\nThis immediately invalidates active tokens.`)) {
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
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((data.error as string) || "Failed to revoke sessions");
      }

      const revoked = Array.isArray(data.revoked)
        ? (data.revoked as Array<{ role?: string; tokenVersion?: number }>)
        : [];
      const summary = revoked
        .map((item) =>
          typeof item?.role === "string" ? `${item.role}@v${item.tokenVersion ?? "?"}` : null
        )
        .filter(Boolean)
        .join(", ");

      if (role === "admin" || role === "all") {
        signOut();
        setAuthError("Sessions revoked. Sign in again.");
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

  const filteredAlbums = useMemo(() => {
    const q = albumQuery.trim().toLowerCase();
    if (!q) return albums;
    return albums.filter(
      (album) =>
        album.slug.toLowerCase().includes(q) ||
        album.title.toLowerCase().includes(q)
    );
  }, [albums, albumQuery]);
  const visibleAlbums = showAllAlbums
    ? filteredAlbums
    : filteredAlbums.slice(0, 12);

  const filteredTransfers = useMemo(() => {
    const q = transferQuery.trim().toLowerCase();
    if (!q) return transfers;
    return transfers.filter(
      (transfer) =>
        transfer.id.toLowerCase().includes(q) ||
        transfer.title.toLowerCase().includes(q)
    );
  }, [transfers, transferQuery]);
  const visibleTransfers = showAllTransfers
    ? filteredTransfers
    : filteredTransfers.slice(0, 15);

  if (!mounted) {
    return (
      <div className="min-h-dvh flex items-center justify-center px-6" aria-busy="true">
        <div className="w-8 h-8 border-2 border-[var(--foreground)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAuthed) {
    return (
      <div className="min-h-dvh flex items-center justify-center px-6">
        <form onSubmit={handleAuth} className="w-full max-w-xs text-center">
          <h1 className="font-mono font-bold tracking-tighter text-lg">
            {SITE_BRAND}
          </h1>
          <p className="font-mono text-sm theme-muted mt-1 mb-8">admin</p>

          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="admin password"
            autoFocus
            className="w-full bg-transparent border-b border-[var(--stone-200)] focus:border-[var(--foreground)] outline-none font-mono text-sm text-center py-2 tracking-wider transition-colors placeholder:text-[var(--stone-400)]"
          />

          {authError && (
            <p className="font-mono text-xs mt-3 text-[var(--prose-hashtag)]">
              {authError}
            </p>
          )}

          <button
            type="submit"
            disabled={!password || authLoading}
            className="mt-6 w-full bg-[var(--foreground)] text-[var(--background)] font-mono text-sm lowercase tracking-wide py-2.5 rounded-md hover:opacity-90 transition-opacity disabled:opacity-30"
          >
            {authLoading ? "checking..." : "unlock"}
          </button>

          <p className="mt-8 font-mono text-xs theme-muted">
            <Link href="/" className="hover:text-[var(--foreground)] transition-colors">
              ← home
            </Link>
          </p>
        </form>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-6 pt-16 pb-24">
      <header className="mb-10">
        <h1 className="font-mono font-bold tracking-tighter text-lg">
          <Link href="/" className="hover:opacity-80 transition-opacity">
            {SITE_BRAND}
          </Link>{" "}
          <span className="theme-muted font-normal">· admin</span>
        </h1>
        <nav className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-[11px] theme-muted tracking-wide">
          <a href="#content-summary" className="hover:text-[var(--foreground)] transition-colors">content</a>
          <a href="#system-health" className="hover:text-[var(--foreground)] transition-colors">health</a>
          <a href="#transfer-manager" className="hover:text-[var(--foreground)] transition-colors">transfers</a>
          <a href="#editorial-tools" className="hover:text-[var(--foreground)] transition-colors">audit</a>
          <a href="#album-manager" className="hover:text-[var(--foreground)] transition-colors">albums</a>
        </nav>
        <nav
          className="mt-3 flex items-center gap-6 font-mono text-xs tracking-wide"
          aria-label="Admin navigation"
        >
          <Link href="/upload" className="theme-muted hover:text-[var(--foreground)] transition-colors">
            upload
          </Link>
          <Link href="/blog" className="theme-muted hover:text-[var(--foreground)] transition-colors">
            words
          </Link>
          <Link href="/pics" className="theme-muted hover:text-[var(--foreground)] transition-colors">
            pics
          </Link>
        </nav>
      </header>

      <section id="content-summary" className="space-y-4 scroll-mt-6">
        <div className="flex items-center justify-between">
          <p className="font-mono text-xs theme-muted">content summary</p>
          <button
            type="button"
            disabled={loading}
            onClick={() => void refreshDashboard()}
            title="Re-fetches blog/gallery counts and system health cards. It does not run the deep content audit."
            className="font-mono text-xs theme-muted hover:text-[var(--foreground)] transition-colors disabled:opacity-50"
          >
            {loading ? "refreshing..." : "refresh"}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3 font-mono text-sm">
          <div className="border theme-border rounded-md p-3">
            <p className="theme-muted text-xs">blog posts</p>
            <p className="text-lg">{content?.blog.totalPosts ?? "—"}</p>
          </div>
          <div className="border theme-border rounded-md p-3">
            <p className="theme-muted text-xs">featured posts</p>
            <p className="text-lg">{content?.blog.featuredPosts ?? "—"}</p>
          </div>
          <div className="border theme-border rounded-md p-3">
            <p className="theme-muted text-xs">albums</p>
            <p className="text-lg">{content?.gallery.totalAlbums ?? "—"}</p>
          </div>
          <div className="border theme-border rounded-md p-3">
            <p className="theme-muted text-xs">photos</p>
            <p className="text-lg">{content?.gallery.totalPhotos ?? "—"}</p>
          </div>
          <div className="border theme-border rounded-md p-3">
            <p className="theme-muted text-xs">latest post</p>
            <p className="text-sm">{formatDate(content?.blog.latestPostDate ?? null)}</p>
          </div>
          <div className="border theme-border rounded-md p-3">
            <p className="theme-muted text-xs">latest album</p>
            <p className="text-sm">{formatDate(content?.gallery.latestAlbumDate ?? null)}</p>
          </div>
          <div className="border theme-border rounded-md p-3">
            <p className="theme-muted text-xs">posts with hero image</p>
            <p className="text-lg">{content?.blog.postsWithImages ?? "—"}</p>
          </div>
          <div className="border theme-border rounded-md p-3">
            <p className="theme-muted text-xs">invalid albums</p>
            <p className="text-lg">{content?.gallery.invalidAlbumCount ?? "—"}</p>
          </div>
          <div className="border theme-border rounded-md p-3">
            <p className="theme-muted text-xs">reading minutes</p>
            <p className="text-lg">{content?.blog.totalReadingMinutes ?? "—"}</p>
          </div>
          <div className="border theme-border rounded-md p-3">
            <p className="theme-muted text-xs">albums missing description</p>
            <p className="text-lg">{content?.gallery.albumsWithoutDescription ?? "—"}</p>
          </div>
        </div>

        <div id="system-health" className="border-t theme-border pt-6 space-y-3 scroll-mt-6">
          <div className="flex items-center justify-between">
            <p className="font-mono text-xs theme-muted">system health</p>
            <p className="font-mono text-[11px] theme-faint">
              config + reachability
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 font-mono text-sm">
            <div className="border theme-border rounded-md p-3">
              <p className="theme-muted text-xs">redis configured</p>
              <p className="text-lg">{debugData?.environment.redisConfigured ? "ok" : "missing"}</p>
            </div>
            <div className="border theme-border rounded-md p-3">
              <p className="theme-muted text-xs">redis reachable</p>
              <p className="text-sm">
                {!debugData
                  ? "—"
                  : debugData.environment.redisReachable === null
                    ? "unknown"
                    : debugData.environment.redisReachable
                      ? `ok${typeof debugData.environment.redisLatencyMs === "number" ? ` (${debugData.environment.redisLatencyMs}ms)` : ""}`
                      : "failed"}
              </p>
            </div>
            <div className="border theme-border rounded-md p-3">
              <p className="theme-muted text-xs">cron secret</p>
              <p className="text-lg">{debugData?.environment.cronSecretConfigured ? "ok" : "missing"}</p>
            </div>
            <div className="border theme-border rounded-md p-3">
              <p className="theme-muted text-xs">r2 public url</p>
              <p className="text-lg">{debugData?.environment.r2PublicUrlConfigured ? "ok" : "missing"}</p>
            </div>
            <div className="border theme-border rounded-md p-3">
              <p className="theme-muted text-xs">r2 write creds</p>
              <p className="text-lg">{debugData?.environment.r2WriteConfigured ? "ok" : "missing"}</p>
            </div>
            <div className="border theme-border rounded-md p-3">
              <p className="theme-muted text-xs">auth secret</p>
              <p className="text-lg">{debugData?.environment.authSecretConfigured ? "ok" : "missing"}</p>
            </div>
          </div>
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
                title="Invalidates staff, upload, and admin tokens globally."
              >
                {revokeLoading === "all" ? "revoking..." : "revoke all role sessions"}
              </button>
            </div>
          </div>
          <TokenSessionsPanel
            isAuthed={isAuthed}
            authFetch={authFetch}
            formatRemaining={formatRemaining}
            ensureStepUpToken={ensureStepUpToken}
            onError={(msg) => setErrorMessage(msg)}
            onStatus={(msg) => setStatusMessage(msg)}
          />
          {debugData?.environment.securityWarnings?.length ? (
            <ul className="space-y-1">
              {debugData.environment.securityWarnings.map((warning) => (
                <li
                  key={warning}
                  className="font-mono text-xs text-[var(--prose-hashtag)]"
                >
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

        <div id="editorial-tools" className="border-t theme-border pt-6 scroll-mt-6">
          <p className="font-mono text-xs theme-muted mb-2">editorial tools</p>
          <div className="grid sm:grid-cols-2 gap-3">
            <Link
              href="/upload"
              className="border theme-border rounded-md px-3 py-2 font-mono text-sm hover:border-[var(--stone-400)] transition-colors"
            >
              open upload dashboard
            </Link>
            <button
              type="button"
              disabled={auditLoading}
              onClick={() => void runContentAudit()}
              title="Runs deeper checks: album manifest validation + broken blog media references against R2."
              className="border theme-border rounded-md px-3 py-2 font-mono text-sm text-left hover:border-[var(--stone-400)] transition-colors disabled:opacity-50"
            >
              {auditLoading ? "auditing..." : "run content audit"}
            </button>
          </div>
          {audit ? (
            <div className="mt-3 border theme-border rounded-md p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="font-mono text-xs theme-muted">
                  last audit: {formatDate(audit.auditedAt)}
                </p>
                <a
                  href="#audit-results"
                  className="font-mono text-xs text-[var(--prose-hashtag)] hover:opacity-80 transition-opacity"
                >
                  view results
                </a>
              </div>
              <p className="font-mono text-xs theme-faint mt-2">
                invalid albums: {audit.albumValidation.invalidCount} · broken refs:{" "}
                {audit.blogAudit.brokenRefs.length}
              </p>
            </div>
          ) : null}
        </div>

        <div id="album-manager" className="border-t theme-border pt-6 space-y-3 scroll-mt-6">
          <div className="flex items-center justify-between">
            <p className="font-mono text-xs theme-muted">album manager</p>
            <button
              type="button"
              disabled={albumsLoading}
              onClick={() => void loadAlbums()}
              className="font-mono text-xs theme-muted hover:text-[var(--foreground)] transition-colors disabled:opacity-50"
              title="Refreshes the album list used for delete/drill-down actions."
            >
              {albumsLoading ? "refreshing..." : "refresh albums"}
            </button>
          </div>
          <details className="border theme-border rounded-md p-3">
            <summary className="cursor-pointer select-none list-none font-mono text-xs theme-muted">
              about album edits (persistence)
            </summary>
            <div className="mt-2 space-y-2">
              <p className="font-mono text-xs theme-muted">
                These actions edit `content/albums/*.json` on the server runtime.
                On Vercel, the filesystem is typically read-only (so edits may be blocked).
                When edits are allowed (local/dev), they still won&apos;t persist to the next deploy unless you commit the JSON changes to git and redeploy.
              </p>
              <p className="font-mono text-xs theme-muted">
                For durable changes, prefer the CLI (`pnpm cli`) + a git commit.
              </p>
            </div>
          </details>
          <input
            type="text"
            value={albumQuery}
            onChange={(e) => {
              setAlbumQuery(e.target.value);
              setShowAllAlbums(false);
            }}
            placeholder="filter albums by title or slug"
            className="w-full bg-transparent border-b border-[var(--stone-200)] focus:border-[var(--foreground)] outline-none font-mono text-xs py-2 transition-colors placeholder:text-[var(--stone-400)]"
          />
          {filteredAlbums.length === 0 && !albumsLoading ? (
            <p className="font-mono text-xs theme-muted">No albums found.</p>
          ) : null}
          <div className="space-y-2">
            {visibleAlbums.map((album) => (
              <div key={album.slug} className="border theme-border rounded-md p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono text-sm truncate">{album.title}</p>
                    <p className="font-mono text-xs theme-muted truncate">
                      {album.slug} · {album.photoCount} photos · cover: {album.cover}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedAlbumSlug((curr) =>
                          curr === album.slug ? null : album.slug
                        )
                      }
                      className="font-mono text-xs theme-muted hover:text-[var(--foreground)] transition-colors"
                    >
                      {expandedAlbumSlug === album.slug ? "hide photos" : "manage photos"}
                    </button>
                    <button
                      type="button"
                      disabled={albumActionLoading === `album:${album.slug}`}
                      onClick={() => void handleDeleteAlbum(album.slug, album.title)}
                      className="font-mono text-xs text-[var(--prose-hashtag)] hover:opacity-80 transition-opacity disabled:opacity-50"
                      title="Deletes this entire album and all associated files."
                    >
                      {albumActionLoading === `album:${album.slug}`
                        ? "deleting..."
                        : "delete album"}
                    </button>
                  </div>
                </div>
                {expandedAlbumSlug === album.slug ? (
                  <div className="mt-3 pt-3 border-t theme-border max-h-56 overflow-auto">
                    <ul className="space-y-2">
                      {(showAllPhotosByAlbum[album.slug]
                        ? album.photos
                        : album.photos.slice(0, 40)
                      ).map((photoId) => (
                        <li key={`${album.slug}-${photoId}`} className="flex items-center justify-between gap-3">
                          <span className="font-mono text-xs truncate">
                            {photoId}
                            {album.cover === photoId ? " · cover" : ""}
                          </span>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              disabled={
                                album.cover === photoId ||
                                albumActionLoading === `cover:${album.slug}:${photoId}`
                              }
                              onClick={() => void handleSetCover(album.slug, photoId)}
                              className="font-mono text-xs theme-muted hover:text-[var(--foreground)] transition-colors disabled:opacity-50"
                              title="Set this photo as the album cover in the manifest."
                            >
                              {albumActionLoading === `cover:${album.slug}:${photoId}`
                                ? "setting..."
                                : "set cover"}
                            </button>
                            <button
                              type="button"
                              disabled={albumActionLoading === `photo:${album.slug}:${photoId}`}
                              onClick={() => void handleDeletePhoto(album.slug, photoId)}
                              className="font-mono text-xs text-[var(--prose-hashtag)] hover:opacity-80 transition-opacity disabled:opacity-50"
                              title="Deletes this photo's thumb/full/original/og files and updates the album manifest."
                            >
                              {albumActionLoading === `photo:${album.slug}:${photoId}`
                                ? "deleting..."
                                : "delete photo"}
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                    {album.photos.length > 40 ? (
                      <button
                        type="button"
                        onClick={() =>
                          setShowAllPhotosByAlbum((prev) => ({
                            ...prev,
                            [album.slug]: !prev[album.slug],
                          }))
                        }
                        className="mt-2 font-mono text-xs theme-muted hover:text-[var(--foreground)] transition-colors"
                      >
                        {showAllPhotosByAlbum[album.slug]
                          ? "show fewer photos"
                          : `show all photos (${album.photos.length})`}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
          {filteredAlbums.length > 12 ? (
            <button
              type="button"
              onClick={() => setShowAllAlbums((v) => !v)}
              className="font-mono text-xs theme-muted hover:text-[var(--foreground)] transition-colors"
            >
              {showAllAlbums
                ? "show fewer albums"
                : `show all albums (${filteredAlbums.length})`}
            </button>
          ) : null}
        </div>

        <div
          id="transfer-manager"
          ref={transfersSectionRef}
          className="border-t theme-border pt-6 space-y-3 scroll-mt-6"
        >
          <div className="flex items-center justify-between">
            <p className="font-mono text-xs theme-muted">transfer manager</p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={transferNukeLoading}
                onClick={() => void nukeTransfersAndScroll()}
                className="font-mono text-xs text-[var(--prose-hashtag)] hover:opacity-80 transition-opacity disabled:opacity-50"
                title="Deletes all transfers and transfer files. Use with care."
              >
                {transferNukeLoading ? "nuking..." : "nuke all"}
              </button>
              <button
                type="button"
                disabled={transferCleanupLoading}
                onClick={() => void cleanupTransfersAndScroll()}
                className="font-mono text-xs theme-muted hover:text-[var(--foreground)] transition-colors disabled:opacity-50"
                title="Deletes expired/orphaned transfer files now. Active transfers are not removed."
              >
                {transferCleanupLoading ? "cleaning..." : "cleanup expired"}
              </button>
              <button
                type="button"
                disabled={transfersLoading}
                onClick={() => void loadTransfersAndScroll()}
                className="font-mono text-xs theme-muted hover:text-[var(--foreground)] transition-colors disabled:opacity-50"
                title="Refreshes active transfer rows and expiry timings."
              >
                {transfersLoading ? "refreshing..." : "refresh"}
              </button>
            </div>
          </div>
          <input
            type="text"
            value={transferQuery}
            onChange={(e) => {
              setTransferQuery(e.target.value);
              setShowAllTransfers(false);
            }}
            placeholder="filter transfers by title or id"
            className="w-full bg-transparent border-b border-[var(--stone-200)] focus:border-[var(--foreground)] outline-none font-mono text-xs py-2 transition-colors placeholder:text-[var(--stone-400)]"
          />

          {transferStatusMessage ? (
            <p className="font-mono text-xs text-[var(--prose-hashtag)]">
              {transferStatusMessage}
            </p>
          ) : null}

          <div className="grid grid-cols-3 gap-3 font-mono text-sm">
            <div className="border theme-border rounded-md p-3">
              <p className="theme-muted text-xs">active transfers</p>
              <p className="text-lg">{transfers.length}</p>
            </div>
            <div className="border theme-border rounded-md p-3">
              <p className="theme-muted text-xs">files in transfers</p>
              <p className="text-lg">{transfers.reduce((sum, t) => sum + t.fileCount, 0)}</p>
            </div>
            <div className="border theme-border rounded-md p-3">
              <p className="theme-muted text-xs">expiring in 24h</p>
              <p className="text-lg">
                {transfers.filter((t) => t.remainingSeconds > 0 && t.remainingSeconds <= 86400).length}
              </p>
            </div>
          </div>

          {filteredTransfers.length === 0 && !transfersLoading ? (
            <p className="font-mono text-xs theme-muted">No active transfers.</p>
          ) : null}

          <div className="space-y-2">
            {visibleTransfers.map((transfer) => (
              <div key={transfer.id} className="border theme-border rounded-md p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono text-sm truncate">{transfer.title || "untitled"}</p>
                    <p className="font-mono text-xs theme-muted truncate">
                      {transfer.id} · {transfer.fileCount} files · expires in {formatRemaining(transfer.remainingSeconds)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Link
                      href={`/t/${transfer.id}`}
                      className="font-mono text-xs theme-muted hover:text-[var(--foreground)] transition-colors"
                      title="Open the public transfer page."
                    >
                      open
                    </Link>
                    <button
                      type="button"
                      disabled={transferActionLoading === transfer.id}
                      onClick={() => void handleDeleteTransfer(transfer.id, transfer.title || "untitled")}
                      className="font-mono text-xs text-[var(--prose-hashtag)] hover:opacity-80 transition-opacity disabled:opacity-50"
                      title="Delete this transfer now (metadata + R2 files)."
                    >
                      {transferActionLoading === transfer.id ? "deleting..." : "delete"}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {filteredTransfers.length > 15 ? (
            <button
              type="button"
              onClick={() => setShowAllTransfers((v) => !v)}
              className="font-mono text-xs theme-muted hover:text-[var(--foreground)] transition-colors"
            >
              {showAllTransfers
                ? "show fewer transfers"
                : `show all transfers (${filteredTransfers.length})`}
            </button>
          ) : null}
        </div>

        <div className="border-t theme-border pt-6">
          <p className="font-mono text-xs theme-muted mb-2">copy CLI commands</p>
          <div className="space-y-2 font-mono text-xs">
            {commandHelpers.map((item) => (
              <div key={item.key} className="border theme-border rounded-md p-2 flex items-center gap-2">
                <span className="theme-muted shrink-0" title={item.tip}>
                  {item.label}
                </span>
                <code className="truncate flex-1">{item.cmd}</code>
                <button
                  type="button"
                  onClick={() => void copyCommand(item.key, item.cmd)}
                  title={item.tip}
                  className="theme-muted hover:text-[var(--foreground)] transition-colors shrink-0"
                >
                  {copiedCommand === item.key ? "copied" : "copy"}
                </button>
              </div>
            ))}
          </div>
        </div>

        {content?.blog.recent?.length ? (
          <div className="border-t theme-border pt-6">
            <p className="font-mono text-xs theme-muted mb-2">recent posts</p>
            <ul className="space-y-1 font-mono text-sm">
              {content.blog.recent.map((post) => (
                <li key={post.slug} className="flex items-center justify-between gap-3">
                  <Link href={`/blog/${post.slug}`} className="truncate hover:opacity-80 transition-opacity">
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
                  <Link href={`/pics/${album.slug}`} className="truncate hover:opacity-80 transition-opacity">
                    {album.title}
                  </Link>
                  <span className="theme-muted shrink-0">{album.photoCount} photos</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {audit ? (
          <div
            id="audit-results"
            ref={auditResultsRef}
            className="border-t theme-border pt-6 space-y-3 scroll-mt-6"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-mono text-xs theme-muted">content audit results</p>
              <div className="flex items-center gap-2 font-mono text-xs">
                <button
                  type="button"
                  onClick={() => setAuditView("all")}
                  className={`px-2 py-1 rounded border transition-colors ${
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
                  className={`px-2 py-1 rounded border transition-colors ${
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
                  className={`px-2 py-1 rounded border transition-colors ${
                    auditView === "invalid-albums"
                      ? "theme-border text-[var(--foreground)]"
                      : "theme-border-faint theme-muted hover:text-[var(--foreground)]"
                  }`}
                >
                  only invalid albums
                </button>
              </div>
            </div>
            <p className="font-mono text-xs theme-muted">
              audited {formatDate(audit.auditedAt)}
            </p>

            {auditView !== "broken-refs" ? (
            <div className="border theme-border rounded-md p-3">
              <p className="font-mono text-xs theme-muted mb-1">album manifest validation</p>
              <p className="font-mono text-sm">
                invalid albums: {audit.albumValidation.invalidCount}
              </p>
              {audit.albumValidation.invalidAlbums.length > 0 ? (
                <ul className="mt-2 space-y-2 font-mono text-xs">
                  {audit.albumValidation.invalidAlbums.map((album) => (
                    <li key={album.slug}>
                      <p className="theme-muted">{album.slug}</p>
                      <p>{album.errors.join(" · ")}</p>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            ) : null}

            {auditView !== "invalid-albums" ? (
            <div className="border theme-border rounded-md p-3">
              <p className="font-mono text-xs theme-muted mb-1">blog media reference audit</p>
              <p className="font-mono text-sm">
                refs checked: {audit.blogAudit.checkedRefs} · broken refs: {audit.blogAudit.brokenRefs.length}
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

        <div className="border-t theme-border pt-6">
          <p className="font-mono text-xs theme-muted mb-2">party tools (secondary)</p>
          <div className="grid sm:grid-cols-2 gap-3">
            <Link
              href="/guestlist"
              className="border theme-border rounded-md px-3 py-2 font-mono text-sm hover:border-[var(--stone-400)] transition-colors"
            >
              manage guestlist
            </Link>
            <Link
              href="/best-dressed"
              className="border theme-border rounded-md px-3 py-2 font-mono text-sm hover:border-[var(--stone-400)] transition-colors"
            >
              best-dressed votes
            </Link>
          </div>
        </div>

        {debugData?.environment.redisError ? (
          <p className="font-mono text-xs text-[var(--prose-hashtag)]">
            debug warning: {debugData.environment.redisError}
          </p>
        ) : null}
        {statusMessage ? (
          <p className="font-mono text-xs text-[var(--prose-hashtag)]">{statusMessage}</p>
        ) : null}
        {errorMessage ? (
          <p className="font-mono text-xs text-[var(--prose-hashtag)]">{errorMessage}</p>
        ) : null}
      </section>
    </div>
  );
}
