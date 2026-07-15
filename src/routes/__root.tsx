import {
  HeadContent,
  Link,
  Outlet,
  Scripts,
  createRootRoute,
  useRouter,
} from "@tanstack/react-router";
import type { ErrorComponentProps } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { BackToTop } from "@/components/BackToTop";
import { LampToggle } from "@/components/LampToggle";
import { BASE_URL, SITE_BRAND, SITE_NAME } from "@/lib/shared/config";
import { LOCAL_KEYS } from "@/lib/shared/storage-keys";
import "@/src/styles/globals.css";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: SITE_NAME },
      {
        name: "description",
        content: "Thoughts, stories, and things worth sharing.",
      },
      { property: "og:title", content: SITE_NAME },
      {
        property: "og:description",
        content: "Thoughts, stories, and things worth sharing.",
      },
      { property: "og:url", content: BASE_URL },
      { property: "og:site_name", content: SITE_NAME },
      { property: "og:type", content: "website" },
      { property: "og:image", content: `${BASE_URL}/icon.svg` },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      { rel: "icon", href: "/icon.svg", type: "image/svg+xml" },
      { rel: "apple-touch-icon", href: "/apple-icon.png" },
      { rel: "manifest", href: "/manifest.json" },
      { rel: "alternate", type: "application/rss+xml", href: "/feed.xml" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Geist:wght@100..900&family=Geist+Mono:wght@100..900&family=Lora:ital,wght@0,400..700;1,400..700&display=swap",
      },
    ],
  }),
  component: RootComponent,
  errorComponent: RootError,
  notFoundComponent: NotFound,
});

function RootComponent() {
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
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var t=localStorage.getItem("${LOCAL_KEYS.theme}");if(t==="dark")document.documentElement.setAttribute("data-theme","dark");})();`,
          }}
        />
      </head>
      <body>
        <a href="#main" className="skip-link">
          Skip to main content
        </a>
        <LampToggle />
        <BackToTop />
        {children}
        <Scripts />
      </body>
    </html>
  );
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
      <main id="main" className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="text-center max-w-md space-y-8">
          <h1 className="font-mono text-7xl font-bold text-foreground opacity-10 leading-none">
            oops
          </h1>
          <p className="font-serif text-xl text-foreground">something broke</p>
          <button
            type="button"
            onClick={() => void router.invalidate()}
            className="font-mono text-sm theme-muted hover:text-foreground transition-colors"
          >
            ↻ try again
          </button>
        </div>
      </main>
    </RootDocument>
  );
}
