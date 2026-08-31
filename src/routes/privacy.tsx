import { Link, createFileRoute } from "@tanstack/react-router";

import { BrowserProfileControl } from "@/components/BrowserProfileControl";
import { SiteFooter, SiteFooterBar } from "@/components/SiteFooter";
import { MARKETING_PRIVACY_NOTICE_LAST_UPDATED } from "@/features/communications/marketing-consent";
import { CONTACT_EMAIL, SITE_BRAND } from "@/lib/shared/config";
import { buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/privacy")({
  head: () =>
    buildSeoHead({
      title: `Privacy — ${SITE_BRAND}`,
      description: "How Milk & Henny collects, uses, stores, and protects personal information.",
      path: "/privacy",
    }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-background text-foreground">
      <header className="max-w-2xl mx-auto px-6 pt-12 pb-8">
        <Link
          to="/"
          className="inline-flex min-h-11 items-center font-mono text-sm font-bold tracking-tighter hover:opacity-70 transition-opacity"
        >
          {SITE_BRAND}
        </Link>
      </header>

      <main id="main" className="max-w-2xl mx-auto flex-1 px-6 pb-20">
        <p className="font-mono text-micro theme-muted tracking-widest uppercase">
          Last updated {MARKETING_PRIVACY_NOTICE_LAST_UPDATED}
        </p>
        <h1 className="mt-3 font-serif text-4xl leading-tight">Privacy</h1>
        <div className="mt-10 space-y-10 font-serif text-lg leading-relaxed">
          <section>
            <h2 className="font-mono text-sm font-bold tracking-tight">What we collect</h2>
            <p className="mt-3 theme-muted">
              We collect the details that you give us when you buy or receive a ticket, submit a
              pitch, join an event waitlist, upload media, send a report, or use a private transfer.
              These details can include your name, email address, content, and files. We also
              process basic security and service data, such as an IP address, request time, browser
              details, and error records.
            </p>
          </section>

          <section>
            <h2 className="font-mono text-sm font-bold tracking-tight">Why we use it</h2>
            <p className="mt-3 theme-muted">
              We use this information to provide the service you asked for, deliver tickets and
              requested availability alerts, run events, prevent abuse, keep the site reliable,
              answer you, and meet our legal duties. We do not sell personal information.
            </p>
          </section>

          <section>
            <h2 className="font-mono text-sm font-bold tracking-tight">Optional marketing</h2>
            <p className="mt-3 theme-muted">
              Marketing email is separate from the service. If you choose the optional news and
              event updates box, or join the mailing list, we use your email and optional name for
              occasional Milk &amp; Henny updates. We record the choice, time, source, and wording
              version so we can honour it. Ticket, access, payment, and other service messages can
              still be sent without this choice. We do not infer marketing consent from buying a
              ticket, uploading, pitching, reporting a problem, answering a survey, or using the
              site. Every marketing email includes an unsubscribe link.
            </p>
          </section>

          <section>
            <h2 className="font-mono text-sm font-bold tracking-tight">Payments and providers</h2>
            <p className="mt-3 theme-muted">
              Stripe processes payment card details. We do not store full card details. We use
              service providers for hosting, storage, database, email, payments, and error
              monitoring. They process only the information needed to provide those services.
            </p>
          </section>

          <section>
            <h2 className="font-mono text-sm font-bold tracking-tight">Storage and retention</h2>
            <p className="mt-3 theme-muted">
              The site uses cookies and local browser storage for sign-in, preferences, saved work,
              offline features, and editable name and email suggestions. These suggestions stay in
              your browser until you clear its site data. Private transfers and temporary event data
              expire on the dates shown in the service. We keep transaction and security records for
              as long as needed for accounting, disputes, safety, and legal duties. Event waitlist
              requests expire when they can no longer be used and are not treated as marketing
              consent. We then delete or anonymise records when they are no longer needed.
            </p>
            <p className="mt-3 theme-muted">
              Issue reports do not include full session replays, keystrokes, or pointer movement.
              They may include a short list of recent product actions, the page and build, basic
              browser and device details, and an exact product artefact needed to investigate an
              issue, such as a map drawing. Any description you enter is saved with the same report.
              Reports expire automatically: client errors after 14 days, site feedback and
              operational issues after 30 days, and map-result reports after 90 days. A closed
              report may remain for up to 30 additional days, within a hard limit of 44, 60, or 120
              days from the first report.
            </p>
          </section>

          <section>
            <h2 className="font-mono text-sm font-bold tracking-tight">Your choices</h2>
            <p className="mt-3 theme-muted">
              You can ask for access, correction, deletion, restriction, or a copy of your personal
              information. Some rights depend on the reason we hold the data and the law that
              applies. A waitlist confirmation email also gives you a private management link where
              you can leave before an alert is sent. You can also object or complain to your local
              data protection authority.
            </p>
            <BrowserProfileControl />
          </section>

          <section>
            <h2 className="font-mono text-sm font-bold tracking-tight">Contact</h2>
            <p className="mt-3 theme-muted">
              Email{" "}
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="text-foreground underline underline-offset-4 hover:opacity-70"
              >
                {CONTACT_EMAIL}
              </a>{" "}
              with a privacy request or question. Include enough detail for us to find the relevant
              record, but do not send sensitive identity documents unless we ask for them.
            </p>
          </section>
        </div>
      </main>
      <SiteFooter>
        <SiteFooterBar
          leading={
            <span className="whitespace-nowrap">
              © {new Date().getFullYear()} {SITE_BRAND}
            </span>
          }
          trailing={
            <nav
              aria-label="Footer"
              className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 md:justify-end"
            >
              <Link to="/contact" className="hover:text-foreground transition-colors">
                contact
              </Link>
              <Link to="/subscribe" className="hover:text-foreground transition-colors">
                stay close
              </Link>
              <Link to="/" className="hover:text-foreground transition-colors">
                ← home
              </Link>
            </nav>
          }
        />
      </SiteFooter>
    </div>
  );
}
