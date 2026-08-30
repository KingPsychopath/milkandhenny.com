import type { ReactNode } from "react";

export type AdminStatusTone = "positive" | "attention" | "danger" | "neutral";

const TONE_CLASSES: Record<AdminStatusTone, { dot: string; text: string; border: string }> = {
  positive: {
    dot: "bg-[var(--status-positive)]",
    text: "text-[var(--status-positive)]",
    border: "border-[var(--status-positive)]",
  },
  attention: {
    dot: "bg-[var(--status-attention)]",
    text: "text-[var(--status-attention)]",
    border: "border-[var(--status-attention)]",
  },
  danger: {
    dot: "bg-[var(--status-danger)]",
    text: "text-[var(--status-danger)]",
    border: "border-[var(--status-danger)]",
  },
  neutral: {
    dot: "bg-[var(--stone-400)]",
    text: "theme-muted",
    border: "theme-border-strong",
  },
};

const DANGER_STATE =
  /\b(fail(?:ed|ure|ures|ing)?|errors?|unavailable|invalid|blocked|rejected|bounced|complained|critical|stale|overdue)\b/;
const ATTENTION_STATE =
  /\b(pending|processing|queued|leased|scheduled|draft|paused|checking|warnings?|degraded|retrying|investigating|unread|awaiting|waiting|preparing|invited|held|partial|contended|rate limited)\b/;
const POSITIVE_STATE =
  /\b(active|available|healthy|ready|resolved|delivered|accepted|published|live|open|enabled|sent|complete|completed|committed|verified|valid|claimed|approved|connected|confirmed|settled|synchronized|succeeded|success|usable)\b/;

export function adminToneForStatus(status: string | null | undefined): AdminStatusTone {
  const normalized = status?.trim().toLowerCase() ?? "";
  if (DANGER_STATE.test(normalized)) return "danger";
  if (ATTENTION_STATE.test(normalized)) return "attention";
  if (POSITIVE_STATE.test(normalized)) return "positive";
  return "neutral";
}

export function adminToneTextClass(tone: AdminStatusTone): string {
  return TONE_CLASSES[tone].text;
}

export function adminToneBorderClass(tone: AdminStatusTone): string {
  return TONE_CLASSES[tone].border;
}

export function AdminStatus({
  children,
  tone,
  className = "",
}: {
  children: ReactNode;
  tone: AdminStatusTone;
  className?: string;
}) {
  const classes = TONE_CLASSES[tone];

  return (
    <span className={`inline-flex items-center gap-1.5 ${classes.text} ${className}`}>
      <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${classes.dot}`} />
      <span>{children}</span>
    </span>
  );
}
