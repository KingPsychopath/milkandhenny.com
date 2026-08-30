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
  const availableSections = ADMIN_SECTIONS.filter((section) =>
    canAccessAdminSection(section.id, permissions),
  );
  const current =
    availableSections.find((section) => section.id === active) ?? availableSections[0];
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

  return (
    <div className="mt-8 border-y theme-border">
      <nav
        aria-label="Primary admin work areas"
        className="-mx-6 flex overflow-x-auto px-6 sm:mx-0 sm:grid sm:grid-cols-3 sm:px-0 lg:grid-cols-6"
      >
        {primarySections.map((section) => {
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
      {utilitySections.length > 0 ? (
        <div className="flex items-stretch border-t theme-border-faint">
          <p className="hidden shrink-0 items-center px-3 font-mono text-micro uppercase tracking-widest theme-faint sm:flex">
            utilities
          </p>
          <nav
            aria-label="Admin utilities and policies"
            className="-mx-6 flex min-w-0 flex-1 overflow-x-auto px-6 sm:mx-0 sm:grid sm:grid-cols-3 sm:px-0"
          >
            {utilitySections.map((section) => {
              const selected = section.id === active;
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => onChange(section.id)}
                  aria-current={selected ? "page" : undefined}
                  className={`relative min-h-11 shrink-0 px-4 py-3 text-left font-mono text-micro transition-opacity sm:px-3 ${
                    selected ? "font-bold text-[var(--foreground)]" : "theme-muted hover:opacity-70"
                  }`}
                >
                  {section.label}
                  {selected ? (
                    <span
                      aria-hidden="true"
                      className="absolute inset-x-3 bottom-0 h-0.5 bg-[var(--prose-hashtag)]"
                    />
                  ) : null}
                </button>
              );
            })}
          </nav>
        </div>
      ) : null}
      {(active === "events" || active === "best-dressed") && (
        <div className="border-t theme-border-faint py-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <p className="font-mono text-micro font-bold uppercase tracking-widest theme-muted">
              event tools
            </p>
            <nav aria-label="Event tools" className="flex flex-wrap gap-x-4 gap-y-2">
              {(["events", "best-dressed"] as const).map((sectionId) => {
                const section = ADMIN_SECTIONS.find((item) => item.id === sectionId);
                if (!section || !canAccessAdminSection(section.id, permissions)) return null;
                const selected = section.id === active;
                return (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => onChange(section.id)}
                    aria-current={selected ? "page" : undefined}
                    className={`inline-flex min-h-11 items-center font-mono text-xs underline-offset-4 transition-opacity hover:opacity-70 ${
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
      {current ? (
        <p
          className="border-t theme-border-faint py-3 font-mono text-micro theme-muted"
          aria-live="polite"
        >
          <span className="font-bold text-foreground">{current.label}</span>
          <span aria-hidden="true"> · </span>
          {current.description}
        </p>
      ) : null}
    </div>
  );
}
