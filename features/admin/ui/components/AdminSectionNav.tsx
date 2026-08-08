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
    id: "transfers",
    label: "transfers",
    description: "Active drops and media processing",
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
] as const;

export type AdminSection = (typeof ADMIN_SECTIONS)[number]["id"];

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

  return (
    <div className="mt-8 border-y theme-border">
      <nav
        aria-label="Admin sections"
        className="-mx-6 flex overflow-x-auto px-6 sm:mx-0 sm:grid sm:grid-cols-3 sm:px-0"
      >
        {ADMIN_SECTIONS.map((section) => {
          const selected = section.id === active;
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
      <p className="border-t theme-border-faint py-3 font-mono text-micro theme-muted">
        {current.description}
      </p>
    </div>
  );
}
