import { useEffect, useMemo, useRef, useState } from "react";
import type { AdminSection, OperationsTab } from "./AdminSectionNav";

const COMMANDS: Array<{
  label: string;
  detail: string;
  section: AdminSection;
  operationsTab?: OperationsTab;
}> = [
  {
    label: "needs attention",
    detail: "refunds, conflicts, delivery failures",
    section: "operations",
    operationsTab: "inbox",
  },
  {
    label: "identity manager",
    detail: "people, email identities, sessions, tickets, restrictions",
    section: "operations",
    operationsTab: "people",
  },
  { label: "events and tickets", detail: "event setup, scanners, scoring", section: "events" },
  { label: "email delivery", detail: "outbox, failures, suppressions", section: "communications" },
  { label: "attendee settings", detail: "capability gates and defaults", section: "settings" },
  { label: "system health", detail: "providers, queues, sessions", section: "system" },
];

export function AdminCommandPalette({
  onNavigate,
}: {
  onNavigate: (section: AdminSection, operationsTab?: OperationsTab) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
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
      COMMANDS.filter((command) =>
        `${command.label} ${command.detail}`.includes(query.toLowerCase()),
      ),
    [query],
  );
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
          onChange={(event) => setQuery(event.target.value)}
          placeholder="go to…"
          className="min-h-12 w-full border-b theme-border bg-transparent px-3 font-mono text-lg outline-none"
        />
        <ul className="mt-2 divide-y theme-border">
          {commands.map((command) => (
            <li key={command.label}>
              <button
                type="button"
                onClick={() => {
                  onNavigate(command.section, command.operationsTab);
                  setOpen(false);
                  setQuery("");
                }}
                className="min-h-14 w-full px-3 py-3 text-left hover:opacity-70"
              >
                <span className="block font-mono text-sm">{command.label}</span>
                <span className="mt-1 block font-mono text-micro theme-muted">
                  {command.detail}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <p className="mt-3 px-3 font-mono text-micro theme-faint">
          Navigation only. Financial, identity, permission, and destructive actions always open
          their reviewed workflow.
        </p>
      </div>
    </div>
  );
}
