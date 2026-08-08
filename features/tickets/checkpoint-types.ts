/**
 * Checkpoint domain types.
 *
 * Browser-safe: shared by the scanner UI, the admin panel, and the server
 * engine. A checkpoint is any scan station that is not the door — catering,
 * merch, cloakroom — where a ticket entitles its holder to a counted number
 * of units rather than a single admission.
 */

export type CheckpointRecord = {
  eventSlug: string;
  id: string;
  name: string;
  /** Units a valid ticket may consume here unless its type overrides it. */
  defaultAllowance: number;
  /** Per-ticket-type overrides, keyed by ticket type id. 0 = not included. */
  allowances: Record<string, number>;
  position: number;
};

/** What a checkpoint scanner needs to show after a scan, and nothing else. */
export type CheckpointTicketView = {
  ticketId: string;
  holderName: string;
  ticketTypeName: string;
  /** Total units this ticket is entitled to at this checkpoint. */
  allowance: number;
  /** Units already consumed, including any consumed by this scan. */
  used: number;
};

export type CheckpointScanOutcome =
  | { result: "consumed"; ticket: CheckpointTicketView; consumed: number }
  | { result: "exhausted"; ticket: CheckpointTicketView; lastUsedAt?: string }
  | { result: "not-included"; ticket: CheckpointTicketView }
  | { result: "over-remaining"; ticket: CheckpointTicketView; requested: number }
  | { result: "void" }
  | { result: "wrong-event" }
  | { result: "invalid" }
  | { result: "not-found" }
  | { result: "unknown-checkpoint" };

export const CHECKPOINT_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidCheckpointId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 2 &&
    value.length <= 40 &&
    CHECKPOINT_ID_PATTERN.test(value)
  );
}

export function slugifyCheckpointName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

/** Units `ticketTypeId` is entitled to at `checkpoint`. */
export function checkpointAllowanceFor(
  checkpoint: Pick<CheckpointRecord, "defaultAllowance" | "allowances">,
  ticketTypeId: string,
): number {
  const override = checkpoint.allowances[ticketTypeId];
  if (typeof override === "number" && Number.isInteger(override) && override >= 0) {
    return override;
  }
  return checkpoint.defaultAllowance;
}

/**
 * A link's level. A `scanner` works their station; a `manager` is the
 * on-the-ground orchestrator — they can also add guests directly and decide
 * other scanners' guest requests, without ever holding admin access.
 */
export const SCANNER_ROLES = ["scanner", "manager"] as const;
export type ScannerRole = (typeof SCANNER_ROLES)[number];

export function isScannerRole(value: unknown): value is ScannerRole {
  return typeof value === "string" && (SCANNER_ROLES as readonly string[]).includes(value);
}

/**
 * Scanner-link wire shape. `checkpointId: null` means the link works the
 * door; anything else names a checkpoint on the same event.
 */
export type ScannerLinkRecord = {
  token: string;
  label: string;
  eventSlug: string;
  checkpointId: string | null;
  role: ScannerRole;
  createdAt: string;
  expiresAt?: string;
  revokedAt?: string;
  lastUsedAt?: string;
};

/** One guest request as both scanner and admin see it. */
export type GuestRequestRecord = {
  id: number;
  eventSlug: string;
  requestedBy: string;
  name: string;
  note?: string;
  status: "pending" | "approved" | "declined" | "cancelled";
  ticketId?: string;
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
};

export function scannerPath(token: string): string {
  return `/scan/${token}`;
}

const SCANNER_TOKEN_PATTERN = /^scn_[A-Za-z0-9_-]{26,64}$/;

export function isValidScannerToken(value: unknown): value is string {
  return typeof value === "string" && SCANNER_TOKEN_PATTERN.test(value);
}
