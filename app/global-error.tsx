"use client";

/**
 * Root-level error boundary.
 *
 * Catches errors thrown by the root layout itself — the one scenario
 * `error.tsx` can't handle. Because the root layout is gone, this
 * component must render its own <html> and <body> with inline styles
 * (no CSS variables, no Tailwind, no fonts from layout).
 *
 * Hex colours below mirror :root in app/globals.css (light theme). When
 * updating the design system, keep these in sync so this fallback stays on-brand.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          backgroundColor: "#fafaf9",
          color: "#1c1917",
          fontFamily:
            "ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, Consolas, monospace",
        }}
      >
        <div style={{ textAlign: "center", maxWidth: 420 }}>
          <button
            type="button"
            onClick={() => {
              window.location.href = "/";
            }}
            style={{
              fontSize: 14,
              fontWeight: 700,
              color: "#1c1917",
              textDecoration: "none",
              letterSpacing: "-0.04em",
              background: "none",
              border: "none",
              cursor: "pointer",
              fontFamily: "inherit",
              padding: 0,
            }}
          >
            milk &amp; henny
          </button>

          <p
            style={{
              fontSize: 72,
              fontWeight: 700,
              opacity: 0.1,
              lineHeight: 1,
              margin: "32px 0 12px",
            }}
          >
            oops
          </p>

          <p
            style={{
              fontSize: 20,
              fontFamily: "Georgia, 'Times New Roman', serif",
              margin: "0 0 8px",
            }}
          >
            something went very wrong
          </p>

          <p style={{ fontSize: 14, color: "#78716c", margin: "0 0 24px" }}>
            the page couldn&apos;t recover. try again, or head home.
          </p>

          <div
            style={{
              display: "flex",
              gap: 16,
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <button
              onClick={reset}
              style={{
                fontSize: 14,
                color: "#78716c",
                background: "none",
                border: "none",
                cursor: "pointer",
                fontFamily: "inherit",
                padding: 0,
              }}
            >
              ↻ try again
            </button>
            <span style={{ color: "#d6d3d1" }}>·</span>
            <button
              type="button"
              onClick={() => {
                window.location.href = "/";
              }}
              style={{
                fontSize: 14,
                color: "#78716c",
                textDecoration: "none",
                background: "none",
                border: "none",
                cursor: "pointer",
                fontFamily: "inherit",
                padding: 0,
              }}
            >
              ← go home
            </button>
          </div>

          {error.digest && (
            <p
              style={{
                fontSize: 10,
                color: "#a8a29e",
                marginTop: 24,
              }}
            >
              ref: {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
