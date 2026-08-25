import { useEffect, useMemo, useRef, useState } from "react";
import type { AdminDestination } from "./AdminSectionNav";

const COMMANDS: Array<{
  label: string;
  detail: string;
  destination: AdminDestination;
}> = [
  {
    label: "overview",
    detail: "priorities, reports, and common actions",
    destination: { section: "overview" },
  },
  {
    label: "needs attention",
    detail: "refunds, conflicts, delivery failures",
    destination: { section: "operations", operationsTab: "inbox" },
  },
  {
    label: "identity manager",
    detail: "people, email identities, sessions, tickets, restrictions",
    destination: { section: "operations", operationsTab: "people" },
  },
  {
    label: "attendee preview",
    detail: "real ticket and identity UI across invariant states",
    destination: { section: "operations", operationsTab: "preview" },
  },
  {
    label: "events and tickets",
    detail: "event setup, ticket holders, scanners, scoring",
    destination: { section: "events" },
  },
  {
    label: "content",
    detail: "words, albums, shares, and media",
    destination: { section: "content" },
  },
  {
    label: "event message plans",
    detail: "timed attendee communication stages",
    destination: { section: "communications", communicationTab: "event-plan" },
  },
  {
    label: "compose message",
    detail: "audience, subject, content, scheduling",
    destination: { section: "communications", communicationTab: "compose" },
  },
  {
    label: "email delivery",
    detail: "queue, failures, provider events, suppressions",
    destination: { section: "communications", communicationTab: "delivery" },
  },
  {
    label: "alert recipients",
    detail: "operational email alerts, digests, quiet hours, and delivery history",
    destination: { section: "communications", communicationTab: "delivery" },
  },
  {
    label: "message templates",
    detail: "reusable communication templates",
    destination: { section: "communications", communicationTab: "templates" },
  },
  {
    label: "feedback",
    detail: "surveys and attendee responses",
    destination: { section: "communications", communicationTab: "feedback" },
  },
  {
    label: "communication consent",
    detail: "contacts and marketing preferences",
    destination: { section: "communications", communicationTab: "people" },
  },
  {
    label: "games",
    detail: "game-night entrances and room pools",
    destination: { section: "games" },
  },
  {
    label: "best dressed",
    detail: "voting, codes, and results",
    destination: { section: "best-dressed" },
  },
  {
    label: "attendee settings",
    detail: "capability gates, event defaults, and administrator access",
    destination: { section: "settings" },
  },
  {
    label: "file delivery",
    detail: "private drops and media processing",
    destination: { section: "transfers" },
  },
  {
    label: "system health",
    detail: "providers, runtime, queues, sessions, security",
    destination: { section: "system" },
  },
];

export function AdminCommandPalette({
  onNavigate,
}: {
  onNavigate: (destination: AdminDestination) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
      }
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, []);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  const commands = useMemo(
    () =>
      COMMANDS.filter((command) => {
        const haystack = `${command.label} ${command.detail}`.toLowerCase();
        return query
          .toLowerCase()
          .trim()
          .split(/\s+/)
          .filter(Boolean)
          .every((term) => haystack.includes(term));
      }),
    [query],
  );
  const choose = (destination: AdminDestination) => {
    onNavigate(destination);
    setOpen(false);
    setQuery("");
    setActiveIndex(0);
  };
  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="min-h-11 border theme-border px-3 font-mono text-micro hover:opacity-70"
        aria-label="Open command palette"
      >
        ⌘K
      </button>
    );
  return (
    <div
      className="fixed inset-0 z-50 bg-background/90 px-6 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Admin command palette"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
    >
      <div className="mx-auto max-w-2xl border-y theme-border bg-background py-4">
        <label htmlFor="admin-command-search" className="sr-only">
          Search admin destinations
        </label>
        <input
          ref={input}
          id="admin-command-search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((current) => Math.min(Math.max(0, commands.length - 1), current + 1));
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
          aria-activedescendant={commands[activeIndex] ? `admin-command-${activeIndex}` : undefined}
          className="min-h-12 w-full border-b theme-border bg-transparent px-3 font-mono text-lg outline-none"
        />
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
  );
}
