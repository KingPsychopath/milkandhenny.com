import { AppSelect } from "@/components/AppSelect";
import type { GlobalAdminPermissionSet } from "@/features/attendee-operations/types";
import { canAccessAdminSection } from "../admin-permissions";

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
    label: "people & support",
    description: "People, ticket history, identity access, and support cases",
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
    label: "access policies",
    description: "Attendee capabilities, event defaults, and administrator access",
  },
] as const;

const PRIMARY_ADMIN_SECTION_IDS = [
  "overview",
  "content",
  "events",
  "operations",
  "communications",
  "games",
] as const;
const UTILITY_ADMIN_SECTION_IDS = ["transfers", "system", "settings"] as const;

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
  "polls",
  "credits",
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
  permissions,
}: {
  active: AdminSection;
  onChange: (section: AdminSection) => void;
  permissions: GlobalAdminPermissionSet;
}) {
  const primaryActive = active === "best-dressed" ? "events" : active;
  const primarySections = ADMIN_SECTIONS.filter(
    (section) =>
      PRIMARY_ADMIN_SECTION_IDS.some((id) => id === section.id) &&
      canAccessAdminSection(section.id, permissions),
  );
  const utilitySections = ADMIN_SECTIONS.filter(
    (section) =>
      UTILITY_ADMIN_SECTION_IDS.some((id) => id === section.id) &&
      canAccessAdminSection(section.id, permissions),
  );

  const relatedEventSection =
    active === "best-dressed"
      ? ADMIN_SECTIONS.find((section) => section.id === "events")
      : ADMIN_SECTIONS.find((section) => section.id === "best-dressed");

  return (
    <div className="mt-4 border-y theme-border py-2 sm:mt-7">
      <nav aria-label="Admin work area" className="sm:hidden">
        <AppSelect
          ariaLabel="Admin work area"
          variant="field"
          value={active}
          options={ADMIN_SECTIONS.filter((section) =>
            canAccessAdminSection(section.id, permissions),
          ).map((section) => ({ value: section.id, label: section.label }))}
          onValueChange={(value) => {
            if (isAdminSection(value)) onChange(value);
          }}
        />
      </nav>
      <nav
        aria-label="Primary admin work areas"
        className="hidden gap-x-4 sm:grid sm:grid-cols-3 lg:grid-cols-6 lg:gap-x-2"
      >
        {primarySections.map((section) => {
          const selected = section.id === primaryActive;
          return (
            <button
              key={section.id}
              type="button"
              onClick={() => onChange(section.id)}
              aria-current={selected ? "page" : undefined}
              className={`relative min-h-12 px-1 py-3 text-left font-mono text-xs transition-opacity hover:opacity-70 ${
                selected ? "font-bold text-[var(--foreground)]" : "theme-subtle"
              }`}
            >
              {section.label}
              {selected ? (
                <span
                  aria-hidden="true"
                  className="absolute inset-x-1 bottom-0 h-0.5 bg-[var(--prose-hashtag)]"
                />
              ) : null}
            </button>
          );
        })}
      </nav>
      {utilitySections.length > 0 ? (
        <div className="mt-1 hidden flex-wrap items-center gap-x-5 sm:flex border-t theme-border-faint pt-2">
          <p className="font-mono text-micro uppercase tracking-widest theme-faint">utilities</p>
          <nav
            aria-label="Admin utilities and policies"
            className="flex min-w-0 flex-1 flex-wrap gap-x-5"
          >
            {utilitySections.map((section) => {
              const selected = section.id === active;
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => onChange(section.id)}
                  aria-current={selected ? "page" : undefined}
                  className={`relative inline-flex min-h-11 items-center gap-2 font-mono text-micro transition-opacity hover:opacity-70 ${
                    selected ? "font-bold text-[var(--foreground)]" : "theme-subtle"
                  }`}
                >
                  {section.label}
                  {selected ? (
                    <span
                      aria-hidden="true"
                      className="absolute inset-x-0 bottom-0 h-px bg-[var(--prose-hashtag)]"
                    />
                  ) : null}
                </button>
              );
            })}
          </nav>
        </div>
      ) : null}
      {(active === "events" || active === "best-dressed") &&
      relatedEventSection &&
      canAccessAdminSection(relatedEventSection.id, permissions) ? (
        <nav
          aria-label="Related event tool"
          className="mt-1 hidden items-center gap-x-5 sm:flex border-t theme-border-faint pt-2"
        >
          <span className="font-mono text-micro uppercase tracking-widest theme-faint">
            related
          </span>
          <button
            type="button"
            onClick={() => onChange(relatedEventSection.id)}
            className="inline-flex min-h-11 items-center font-mono text-micro theme-subtle underline decoration-transparent underline-offset-4 transition-all hover:decoration-current"
          >
            {relatedEventSection.label}
          </button>
        </nav>
      ) : null}
    </div>
  );
}
