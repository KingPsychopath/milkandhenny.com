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
import { ScannerReturnPrompt } from "@/components/ScannerReturnPrompt";
import { ReportIssueButton } from "@/features/reports/ReportIssueButton";
import { ActiveRoomNotice } from "@/features/things/shared/ActiveRoomNotice";
import { recordDiagnosticAction } from "@/features/reports/diagnostics";
import { BASE_URL, SITE_BRAND, SITE_NAME } from "@/lib/shared/config";
import { LOCAL_KEYS } from "@/lib/shared/storage-keys";
import { OG_IMAGES, buildSeoHead } from "@/lib/shared/seo";
import "@/src/styles/globals.css";

const LostGuest404 = lazy(() =>
  import("@/features/things/shared/PixelMoments").then(({ LostGuest404 }) => ({
    default: LostGuest404,
  })),
);

export const Route = createRootRoute({
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
        { name: "viewport", content: "width=device-width, initial-scale=1" },
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
  useEffect(() => {
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
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        <ManifestLink />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){window.EXCALIDRAW_ASSET_PATH="/excalidraw/";var t=localStorage.getItem("${LOCAL_KEYS.theme}");var d=t==="dark"||t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches;document.documentElement.setAttribute("data-theme",d?"dark":"light");})();`,
          }}
        />
      </head>
      <body>
        <a href="#main" className="skip-link">
          Skip to main content
        </a>
        <LampToggle />
        <BackToTop />
        <NavigationProgress />
        <OfflinePlatform />
        <ScannerReturnPrompt />
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
          className="font-mono text-sm font-bold text-foreground tracking-tighter hover:opacity-70 transition-opacity"
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
        <Link
          to="/"
          className="font-mono text-sm theme-muted hover:text-foreground transition-colors"
        >
          ← go home
        </Link>
      </div>
    </main>
  );
}

function RootError({ error }: ErrorComponentProps) {
  const router = useRouter();

  useEffect(() => {
    console.error("Unhandled error:", error);
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
