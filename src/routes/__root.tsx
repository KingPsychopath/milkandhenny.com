import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRoute,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { Suspense, lazy, useEffect } from "react";
import { BackToTop } from "@/components/BackToTop";
import { LampToggle } from "@/components/LampToggle";
import { NavigationProgress } from "@/components/NavigationProgress";
import { OfflinePlatform } from "@/components/OfflinePlatform";
import { WorkAccessReturnPrompt } from "@/components/WorkAccessReturnPrompt";
import { ReportIssueButton } from "@/features/reports/ReportIssueButton";
import { ActiveRoomNotice } from "@/features/things/shared/ActiveRoomNotice";
import { ClaimedScoreLinks } from "@/features/event-scoring/ui/ClaimedScoreLinks";
import { AttendeeClaimReconciler } from "@/features/event-scoring/ui/AttendeeClaimReconciler";
import { GlobalAchievementNotice } from "@/features/achievements/ui/GlobalAchievementNotice";
import { getEventNightContextsFn } from "@/features/event-operations/event-night.functions";
import { EventNightNavigation } from "@/features/event-operations/ui/EventNightNavigation";
import { ApplicationFileDrop } from "@/features/media/ApplicationFileDrop";
import { getAttendeeShellFn } from "@/features/attendee-access/access.functions";
import { recordDiagnosticAction } from "@/features/reports/diagnostics";
import { BASE_URL, SITE_BRAND, SITE_NAME } from "@/lib/shared/config";
import { LOCAL_KEYS } from "@/lib/shared/storage-keys";
import { OG_IMAGES, buildSeoHead } from "@/lib/shared/seo";
import { isStaleAssetError, reloadForStaleAssets } from "@/lib/client/stale-asset-recovery";
import "@/src/styles/globals.css";

const LostGuest404 = lazy(() =>
  import("@/features/things/shared/PixelMoments").then(({ LostGuest404 }) => ({
    default: LostGuest404,
  })),
);

export const Route = createRootRoute({
  loader: async () => {
    const [shell, eventNightContexts] = await Promise.all([
      getAttendeeShellFn(),
      getEventNightContextsFn(),
    ]);
    return { ...shell, eventNightContexts };
  },
  staleTime: Infinity,
  head: () => {
    const seo = buildSeoHead({
      title: SITE_NAME,
      description: "Thoughts, stories, and things worth sharing from Milk & Henny.",
      path: "/",
      image: OG_IMAGES.default,
      imageAlt: "Milk & Henny — thoughts, stories, and things worth sharing",
    });
    return {
      meta: [
        { charSet: "utf-8" },
        {
          name: "viewport",
          content: "width=device-width, initial-scale=1, interactive-widget=resizes-content",
        },
        ...seo.meta,
      ],
      links: [
        { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
        { rel: "icon", href: "/icon.svg", type: "image/svg+xml" },
        { rel: "apple-touch-icon", href: "/apple-icon.png" },
        { rel: "alternate", type: "application/rss+xml", href: `${BASE_URL}/feed.xml` },
      ],
    };
  },
  component: RootComponent,
  errorComponent: RootError,
  notFoundComponent: NotFound,
});

function RootComponent() {
  const { authenticated, eventNightContexts } = Route.useLoaderData();
  useEffect(() => {
    document.documentElement.setAttribute("data-app-hydrated", "");
    const onError = (event: ErrorEvent) => {
      recordDiagnosticAction("window.error", {
        name: event.error instanceof Error ? event.error.name : "Error",
        ...(import.meta.env.DEV && event.message ? { message: event.message } : {}),
      });
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      recordDiagnosticAction("window.unhandled_rejection", {
        name: event.reason instanceof Error ? event.reason.name : "PromiseRejection",
        ...(import.meta.env.DEV && event.reason instanceof Error && event.reason.message
          ? { message: event.reason.message }
          : {}),
      });
    };
    const onPreloadError = (event: Event) => {
      recordDiagnosticAction("stale_asset_reload", { buildId: __BUILD_ID__ });
      if (reloadForStaleAssets()) event.preventDefault();
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    window.addEventListener("vite:preloadError", onPreloadError);
    return () => {
      document.documentElement.removeAttribute("data-app-hydrated");
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
      window.removeEventListener("vite:preloadError", onPreloadError);
    };
  }, []);
  return (
    <RootDocument authenticated={authenticated} eventNightContexts={eventNightContexts}>
      <Outlet />
    </RootDocument>
  );
}

function RootDocument({
  authenticated = false,
  eventNightContexts = [],
  children,
}: Readonly<{
  authenticated?: boolean;
  eventNightContexts?: import("@/features/event-operations/event-night.types").EventNightContext[];
  children: ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){window.EXCALIDRAW_ASSET_PATH="/excalidraw/";var t=localStorage.getItem("${LOCAL_KEYS.theme}");var d=t==="dark"||t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches;var e=document.documentElement;e.setAttribute("data-theme",d?"dark":"light");e.style.colorScheme=d?"dark":"light";requestAnimationFrame(function(){requestAnimationFrame(function(){e.setAttribute("data-theme-ready","")})})})();`,
          }}
        />
        <HeadContent />
        <ManifestLink />
      </head>
      <body>
        <a href="#main" className="skip-link">
          Skip to main content
        </a>
        <LampToggle />
        <BackToTop />
        <NavigationProgress />
        <ApplicationFileDrop />
        <OfflinePlatform />
        <WorkAccessReturnPrompt />
        <EventNightNavigation authenticated={authenticated} initialContexts={eventNightContexts} />
        <AttendeeClaimReconciler />
        <ClaimedScoreLinks />
        <GlobalAchievementNotice authenticated={authenticated} />
        {children}
        <ActiveRoomNotice />
        <Scripts />
      </body>
    </html>
  );
}

function ManifestLink() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const href =
    pathname === "/things/heads-up" ? "/manifest-forehead.webmanifest" : "/manifest.json";
  return <link rel="manifest" href={href} />;
}

function NotFound() {
  return (
    <main id="main" className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="text-center max-w-md space-y-8">
        <Link
          to="/"
          className="inline-flex min-h-11 items-center font-mono text-sm font-bold text-foreground tracking-tighter hover:opacity-70 transition-opacity"
        >
          {SITE_BRAND}
        </Link>
        <div className="space-y-3">
          <h1 className="font-mono text-7xl font-bold text-foreground opacity-10 leading-none">
            404
          </h1>
          <p className="font-serif text-xl text-foreground">this page doesn&apos;t exist</p>
          <p className="theme-muted text-sm">maybe it never did. maybe it will one day.</p>
        </div>
        <Suspense fallback={null}>
          <LostGuest404 />
        </Suspense>
        <RecoveryNavigation />
      </div>
    </main>
  );
}

function RootError({ error }: ErrorComponentProps) {
  const router = useRouter();

  useEffect(() => {
    console.error("Unhandled error:", error);
    if (isStaleAssetError(error)) {
      recordDiagnosticAction("stale_asset_error_boundary", { buildId: __BUILD_ID__ });
      reloadForStaleAssets();
    }
  }, [error]);

  return (
    <RootDocument>
      <main
        id="main"
        className="flex min-h-screen items-center justify-center bg-background px-6 py-12"
      >
        <div className="w-full max-w-md space-y-8 text-center">
          <h1 className="font-mono text-7xl font-bold text-foreground opacity-10 leading-none">
            oops
          </h1>
          <div className="space-y-4">
            <p role="alert" className="font-serif text-xl text-foreground">
              something broke
            </p>
            <button
              type="button"
              onClick={() => void router.invalidate()}
              className="inline-flex min-h-11 items-center px-3 font-mono text-sm theme-muted hover:text-foreground transition-colors"
            >
              ↻ try again
            </button>
            <RecoveryNavigation />
            <ReportIssueButton
              type="client_error"
              payload={{
                surface: "root_error",
                operation: "route_render",
                errorCode: error instanceof Error ? error.name : "route_error",
              }}
              error={error}
              label="something still wrong? let us know"
              detailsPlacement="inline"
              className="justify-center"
            />
          </div>
        </div>
      </main>
    </RootDocument>
  );
}

function RecoveryNavigation() {
  const goBack = () => {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    window.location.assign("/");
  };

  return (
    <nav aria-label="Page recovery" className="flex flex-wrap items-center justify-center gap-2">
      <button type="button" onClick={goBack} className="mh-action mh-action--quiet">
        ← go back
      </button>
      <Link to="/" className="mh-action mh-action--quiet">
        go home
      </Link>
    </nav>
  );
}
