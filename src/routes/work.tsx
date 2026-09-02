import { useEffect, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";

import {
  forgetStaffAccess,
  readRememberedStaffAccess,
  type RememberedStaffAccess,
} from "@/features/event-operations/staff-memory";
import {
  forgetScanner,
  readRememberedScanners,
  type RememberedScanner,
} from "@/features/tickets/scanner-memory";
import { SITE_NAME } from "@/lib/shared/config";
import { buildSeoHead } from "@/lib/shared/seo";

type WorkAccess =
  | { kind: "scanner"; savedAt: string; scanner: RememberedScanner }
  | { kind: "staff"; savedAt: string; staff: RememberedStaffAccess };

function rememberedWork(): WorkAccess[] {
  return [
    ...readRememberedScanners().map((scanner) => ({
      kind: "scanner" as const,
      savedAt: scanner.savedAt,
      scanner,
    })),
    ...readRememberedStaffAccess().map((staff) => ({
      kind: "staff" as const,
      savedAt: staff.savedAt,
      staff,
    })),
  ].sort((left, right) => Date.parse(right.savedAt) - Date.parse(left.savedAt));
}

export const Route = createFileRoute("/work")({
  component: WorkRoute,
  head: () =>
    buildSeoHead({
      title: `Staff tools — ${SITE_NAME}`,
      description: "Private event tools remembered on this phone.",
      path: "/work",
      robots: "noindex, nofollow",
      referrer: "no-referrer",
    }),
});

function WorkRoute() {
  const [access, setAccess] = useState<WorkAccess[] | null>(null);

  useEffect(() => setAccess(rememberedWork()), []);

  const forget = (entry: WorkAccess) => {
    if (entry.kind === "scanner") forgetScanner(entry.scanner.token);
    else forgetStaffAccess(entry.staff.eventSlug, entry.staff.token);
    setAccess(rememberedWork());
  };

  return (
    <div className="min-h-dvh bg-background">
      <main id="main" className="mx-auto max-w-md px-5 pb-16 pt-12">
        <p className="font-mono text-micro uppercase tracking-widest theme-muted">work</p>
        <h1 className="mt-2 font-serif text-3xl text-foreground">Staff tools</h1>
        <p className="mt-3 max-w-sm font-mono text-xs leading-relaxed theme-muted">
          Every active event role or scanner opened on this phone lives here. Choose the job you are
          doing now.
        </p>

        {access === null ? null : access.length === 0 ? (
          <section className="mt-8 rounded-2xl border theme-border p-5">
            <h2 className="font-serif text-xl">No access on this phone</h2>
            <p className="mt-2 font-mono text-xs leading-relaxed theme-muted">
              Open the private link an organiser sent you. It will be remembered here until it
              expires or you remove it.
            </p>
          </section>
        ) : (
          <ul className="mt-8 divide-y border-y theme-border">
            {access.map((entry) => {
              const isScanner = entry.kind === "scanner";
              const title = isScanner ? entry.scanner.eventTitle : entry.staff.eventTitle;
              const label = isScanner
                ? `${entry.scanner.station} · ${entry.scanner.label}`
                : `${entry.staff.label} · ${(entry.staff.rolePreset ?? entry.staff.assignmentType).replaceAll("-", " ")}`;
              const key = isScanner
                ? `scanner:${entry.scanner.token}`
                : `staff:${entry.staff.eventSlug}:${entry.staff.token}`;
              return (
                <li key={key} className="py-4">
                  <p className="font-serif text-xl text-foreground">{title}</p>
                  <p className="mt-1 font-mono text-micro theme-muted">{label}</p>
                  <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
                    {isScanner ? (
                      <Link
                        to="/scan/$token"
                        params={{ token: entry.scanner.token }}
                        className="inline-flex min-h-14 items-center justify-center rounded-xl bg-foreground px-5 font-mono text-sm text-background"
                      >
                        open scanner
                      </Link>
                    ) : (
                      <Link
                        to="/events/$slug/staff/$token"
                        params={{ slug: entry.staff.eventSlug, token: entry.staff.token }}
                        className="inline-flex min-h-14 items-center justify-center rounded-xl bg-foreground px-5 font-mono text-sm text-background"
                      >
                        open tools
                      </Link>
                    )}
                    <button
                      type="button"
                      onClick={() => forget(entry)}
                      className="min-h-14 rounded-xl border theme-border-strong px-4 font-mono text-micro theme-muted"
                    >
                      remove
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
