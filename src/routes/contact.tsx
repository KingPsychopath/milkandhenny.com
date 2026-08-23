import { Link, createFileRoute } from "@tanstack/react-router";

import { CONTACT_EMAIL, SITE_BRAND } from "@/lib/shared/config";
import { buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/contact")({
  head: () =>
    buildSeoHead({
      title: `Contact — ${SITE_BRAND}`,
      description: "Contact Milk & Henny about events, tickets, pitches, transfers, or the site.",
      path: "/contact",
    }),
  component: ContactPage,
});

function ContactPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="max-w-2xl mx-auto px-6 pt-12 pb-8">
        <Link
          to="/"
          className="font-mono text-sm font-bold tracking-tighter hover:opacity-70 transition-opacity"
        >
          {SITE_BRAND}
        </Link>
      </header>

      <main id="main" className="max-w-2xl mx-auto px-6 pb-20">
        <p className="font-mono text-micro theme-muted tracking-widest uppercase">Get in touch</p>
        <h1 className="mt-3 font-serif text-4xl leading-tight">Contact</h1>
        <div className="mt-10 space-y-8 font-serif text-lg leading-relaxed theme-muted">
          <p>
            For event, ticket, pitch, transfer, privacy, or site questions, email{" "}
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className="text-foreground underline underline-offset-4 hover:opacity-70"
            >
              {CONTACT_EMAIL}
            </a>
            .
          </p>
          <p>
            For a ticket problem, include the event name and order reference. Do not send payment
            card details or passwords.
          </p>
          <p className="font-mono text-xs">
            You can read how we handle personal information in the{" "}
            <Link to="/privacy" className="text-foreground underline underline-offset-4">
              privacy notice
            </Link>
            .
          </p>
        </div>
      </main>
    </div>
  );
}
