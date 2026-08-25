export const ADMIN_SECTIONS = [
  {
    id: "overview",
    label: "overview",
    description: "Priorities, reports, and shortcuts",
  },
  {
    id: "content",
    label: "content",
    description: "Words, albums, shares, and media",
  },
  {
    id: "events",
    label: "events",
    description: "Events, tickets, scanners, and pitches",
  },
  {
    id: "operations",
    label: "people & access",
    description: "Identity manager, sessions, restrictions, tickets, and support cases",
  },
  {
    id: "communications",
    label: "communications",
    description: "Plans, messages, delivery, alert recipients, templates, and consent",
  },
  {
    id: "games",
    label: "games",
    description: "Game-night entrances, room pools, and default settings",
  },
  {
    id: "transfers",
    label: "file delivery",
    description: "Private file drops and media processing",
  },
  {
    id: "best-dressed",
    label: "best dressed",
    description: "Voting, codes, and results",
  },
  {
    id: "system",
    label: "system",
    description: "Health, runtime, and sessions",
  },
  {
    id: "settings",
    label: "settings",
    description: "Attendee capabilities, event defaults, and administrator access",
  },
] as const;

const PRIMARY_ADMIN_SECTIONS = ADMIN_SECTIONS.filter((section) => section.id !== "best-dressed");

export type AdminSection = (typeof ADMIN_SECTIONS)[number]["id"];

export const OPERATIONS_TABS = ["inbox", "people", "preview"] as const;
export type OperationsTab = (typeof OPERATIONS_TABS)[number];

export function isOperationsTab(value: unknown): value is OperationsTab {
  return OPERATIONS_TABS.some((tab) => tab === value);
}

export const COMMUNICATION_TABS = [
  "event-plan",
  "compose",
  "delivery",
  "templates",
  "feedback",
  "people",
] as const;

export type CommunicationsTab = (typeof COMMUNICATION_TABS)[number];

export type AdminDestination = {
  section: AdminSection;
  operationsTab?: OperationsTab;
  communicationTab?: CommunicationsTab;
  event?: string;
  ticket?: string;
  person?: string;
  emailStatus?: string;
  emailQuery?: string;
};

export function isCommunicationsTab(value: unknown): value is CommunicationsTab {
  return COMMUNICATION_TABS.some((tab) => tab === value);
}

export function isAdminSection(value: unknown): value is AdminSection {
  return ADMIN_SECTIONS.some((section) => section.id === value);
}

export function AdminSectionNav({
  active,
  onChange,
}: {
  active: AdminSection;
  onChange: (section: AdminSection) => void;
}) {
  const current = ADMIN_SECTIONS.find((section) => section.id === active) ?? ADMIN_SECTIONS[0];
  const primaryActive = active === "best-dressed" ? "events" : active;

  return (
    <div className="mt-8 border-y theme-border">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b theme-border-faint py-3">
        <p className="font-mono text-micro font-bold uppercase tracking-widest theme-muted">
          workspace
        </p>
        <p className="font-mono text-micro theme-faint">
          Choose a work area, then use its local tools.
        </p>
      </div>
      <nav
        aria-label="Admin sections"
        className="-mx-6 flex overflow-x-auto px-6 sm:mx-0 sm:grid sm:grid-cols-4 lg:grid-cols-8 sm:px-0"
      >
        {PRIMARY_ADMIN_SECTIONS.map((section) => {
          const selected = section.id === primaryActive;
          return (
            <button
              key={section.id}
              type="button"
              onClick={() => onChange(section.id)}
              aria-current={selected ? "page" : undefined}
              className={`relative min-h-12 shrink-0 px-4 py-3 text-left font-mono text-xs transition-opacity first:pl-0 sm:px-3 sm:first:pl-3 ${
                selected ? "font-bold text-[var(--foreground)]" : "theme-muted hover:opacity-70"
              }`}
            >
              {section.label}
              {selected ? (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-3 bottom-0 h-0.5 bg-[var(--prose-hashtag)] first:left-0 sm:first:left-3"
                />
              ) : null}
            </button>
          );
        })}
      </nav>
      {(active === "events" || active === "best-dressed") && (
        <div className="border-t theme-border-faint py-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <p className="font-mono text-micro font-bold uppercase tracking-widest theme-muted">
              event tools
            </p>
            <nav aria-label="Event tools" className="flex flex-wrap gap-x-4 gap-y-2">
              {(["events", "best-dressed"] as const).map((sectionId) => {
                const section = ADMIN_SECTIONS.find((item) => item.id === sectionId);
                if (!section) return null;
                const selected = section.id === active;
                return (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => onChange(section.id)}
                    aria-current={selected ? "page" : undefined}
                    className={`font-mono text-xs underline-offset-4 transition-opacity hover:opacity-70 ${
                      selected ? "font-bold underline" : "theme-muted"
                    }`}
                  >
                    {section.label}
                  </button>
                );
              })}
            </nav>
          </div>
        </div>
      )}
      <p className="border-t theme-border-faint py-3 font-mono text-micro theme-muted">
        {current.description}
      </p>
    </div>
  );
}
