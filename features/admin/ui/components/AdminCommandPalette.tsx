import { useEffect, useMemo, useState } from "react";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import type {
  GlobalAdminPermission,
  GlobalAdminPermissionSet,
} from "@/features/attendee-operations/types";
import { hasAnyAdminPermission } from "../admin-permissions";
import type { AdminDestination } from "./AdminSectionNav";

const COMMANDS: Array<{
  label: string;
  detail: string;
  destination: AdminDestination;
  permissions: readonly GlobalAdminPermission[];
}> = [
  {
    label: "overview",
    detail: "priorities, reports, and common actions",
    destination: { section: "overview" },
    permissions: ["viewOperations"],
  },
  {
    label: "notifications",
    detail: "app-wide alerts, work ownership, and delivery failures",
    destination: { section: "overview" },
    permissions: ["viewOperations"],
  },
  {
    label: "identity manager",
    detail: "people, email identities, sessions, tickets, restrictions",
    destination: { section: "operations", operationsTab: "people" },
    permissions: ["managePeople"],
  },
  {
    label: "attendee preview",
    detail: "real ticket and identity UI across invariant states",
    destination: { section: "operations", operationsTab: "preview" },
    permissions: ["viewOperations"],
  },
  {
    label: "events and tickets",
    detail: "event setup, ticket holders, staff, and scanners",
    destination: { section: "events" },
    permissions: ["viewOperations"],
  },
  {
    label: "content",
    detail: "words, albums, shares, and media",
    destination: { section: "content" },
    permissions: ["manageContent"],
  },
  {
    label: "event message plans",
    detail: "timed attendee communication stages",
    destination: { section: "communications", communicationTab: "event-plan" },
    permissions: ["manageCommunications"],
  },
  {
    label: "compose message",
    detail: "audience, subject, content, scheduling",
    destination: { section: "communications", communicationTab: "compose" },
    permissions: ["manageCommunications"],
  },
  {
    label: "email delivery",
    detail: "queue, failures, provider events, suppressions",
    destination: { section: "communications", communicationTab: "delivery" },
    permissions: ["manageCommunications"],
  },
  {
    label: "alert recipients",
    detail: "operational email alerts, digests, quiet hours, and delivery history",
    destination: { section: "communications", communicationTab: "delivery" },
    permissions: ["manageCommunications"],
  },
  {
    label: "message templates",
    detail: "reusable communication templates",
    destination: { section: "communications", communicationTab: "templates" },
    permissions: ["manageCommunications"],
  },
  {
    label: "feedback",
    detail: "surveys and attendee responses",
    destination: { section: "communications", communicationTab: "feedback" },
    permissions: ["manageCommunications"],
  },
  {
    label: "communication consent",
    detail: "contacts and marketing preferences",
    destination: { section: "communications", communicationTab: "people" },
    permissions: ["manageCommunications"],
  },
  {
    label: "games",
    detail: "game-night entrances and room pools",
    destination: { section: "games" },
    permissions: ["manageScoring"],
  },
  {
    label: "best dressed",
    detail: "voting, codes, and results",
    destination: { section: "best-dressed" },
    permissions: ["manageScoring"],
  },
  {
    label: "attendee settings",
    detail: "capability gates, event defaults, and administrator access",
    destination: { section: "settings" },
    permissions: ["manageGlobalSettings"],
  },
  {
    label: "file delivery",
    detail: "private drops and media processing",
    destination: { section: "transfers" },
    permissions: ["manageContent"],
  },
  {
    label: "system health",
    detail: "providers, runtime, queues, sessions, security",
    destination: { section: "system" },
    permissions: ["viewOperations"],
  },
];

export function AdminCommandPalette({
  onNavigate,
  permissions,
}: {
  onNavigate: (destination: AdminDestination) => void;
  permissions: GlobalAdminPermissionSet;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const dialogRef = useFocusTrap<HTMLDivElement>(open);
  useEscapeKey(() => setOpen(false), open);
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);
  const commands = useMemo(
    () =>
      COMMANDS.filter((command) => hasAnyAdminPermission(permissions, command.permissions)).filter(
        (command) => {
          const haystack = `${command.label} ${command.detail}`.toLowerCase();
          return query
            .toLowerCase()
            .trim()
            .split(/\s+/)
            .filter(Boolean)
            .every((term) => haystack.includes(term));
        },
      ),
    [permissions, query],
  );
  const choose = (destination: AdminDestination) => {
    onNavigate(destination);
    setOpen(false);
    setQuery("");
    setActiveIndex(0);
  };
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-11 border theme-border px-3 font-mono text-micro hover:opacity-70"
        aria-label="Open command palette"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        ⌘K
      </button>
      {open ? (
        <div
          className="fixed inset-0 z-50 bg-background/90 px-4 pt-[6dvh] sm:px-6 sm:pt-[12vh]"
          role="dialog"
          aria-modal="true"
          aria-label="Admin command palette"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div
            ref={dialogRef}
            className="relative mx-auto max-h-[88dvh] max-w-2xl overflow-y-auto border-y theme-border bg-background py-4 sm:max-h-[76dvh]"
          >
            <label htmlFor="admin-command-search" className="sr-only">
              Search admin destinations
            </label>
            <input
              id="admin-command-search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActiveIndex((current) =>
                    Math.min(Math.max(0, commands.length - 1), current + 1),
                  );
                }
                if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActiveIndex((current) => Math.max(0, current - 1));
                }
                if (event.key === "Enter" && commands[activeIndex]) {
                  event.preventDefault();
                  choose(commands[activeIndex].destination);
                }
              }}
              placeholder="go to…"
              role="combobox"
              aria-expanded="true"
              aria-controls="admin-command-options"
              aria-activedescendant={
                commands[activeIndex] ? `admin-command-${activeIndex}` : undefined
              }
              className="min-h-12 w-full border-b theme-border bg-transparent px-3 pr-14 font-mono text-lg outline-none"
            />
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute right-1 top-2 inline-flex size-11 items-center justify-center font-mono text-sm theme-muted hover:opacity-70"
              aria-label="Close command palette"
            >
              ×
            </button>
            <ul id="admin-command-options" role="listbox" className="mt-2 divide-y theme-border">
              {commands.map((command, index) => (
                <li key={command.label}>
                  <button
                    id={`admin-command-${index}`}
                    role="option"
                    aria-selected={activeIndex === index}
                    type="button"
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => choose(command.destination)}
                    className={`min-h-14 w-full px-3 py-3 text-left transition-opacity hover:opacity-70 ${
                      activeIndex === index
                        ? "border-l-2 border-foreground"
                        : "border-l-2 border-transparent"
                    }`}
                  >
                    <span className="block font-mono text-sm">{command.label}</span>
                    <span className="mt-1 block font-mono text-micro theme-muted">
                      {command.detail}
                    </span>
                  </button>
                </li>
              ))}
              {!commands.length ? (
                <li className="px-3 py-6 font-mono text-xs theme-muted">No destination matches.</li>
              ) : null}
            </ul>
            <p className="mt-3 px-3 font-mono text-micro theme-faint">
              Navigation only. Financial, identity, permission, and destructive actions always open
              their reviewed workflow.
            </p>
          </div>
        </div>
      ) : null}
    </>
  );
}
