import type { EmailLedgerEntry, EmailSuppression } from "./types";

export interface EmailDeliveryIncident {
  recipientHash: string;
  suppression: EmailSuppression;
  entries: EmailLedgerEntry[];
  recoveryEntry: EmailLedgerEntry | null;
  lateJoinCount: number;
}

export function deliveryThreadKey(entry: EmailLedgerEntry): string {
  if (
    entry.channel === "tickets" &&
    (entry.kind === "ticket-issued" || entry.kind === "ticket-resend") &&
    entry.context.orderId
  ) {
    return `ticket-order:${entry.context.orderId}`;
  }
  return entry.id;
}

export function groupDeliveryThreads(entries: EmailLedgerEntry[]): EmailLedgerEntry[][] {
  const groups = new Map<string, EmailLedgerEntry[]>();
  for (const entry of entries) {
    const key = deliveryThreadKey(entry);
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return [...groups.values()].map((group) =>
    group.toSorted((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)),
  );
}

export function groupEmailDeliveryIncidents(entries: EmailLedgerEntry[]): EmailDeliveryIncident[] {
  const groups = new Map<string, EmailDeliveryIncident>();
  for (const entry of entries) {
    const suppression = entry.suppression;
    if (!suppression) continue;
    const current = groups.get(suppression.recipientHash) ?? {
      recipientHash: suppression.recipientHash,
      suppression,
      entries: [],
      recoveryEntry: null,
      lateJoinCount: 0,
    };
    current.entries.push(entry);
    if (entry.dispatchReason === "late-join-catch-up") current.lateJoinCount += 1;
    if (
      current.recoveryEntry === null &&
      suppression.reason === "bounced" &&
      entry.canResend &&
      (entry.kind === "ticket-issued" || entry.kind === "ticket-resend")
    ) {
      current.recoveryEntry = entry;
    }
    groups.set(suppression.recipientHash, current);
  }
  return [...groups.values()];
}
