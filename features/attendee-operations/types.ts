/** Browser-safe Attendee Operations contracts and policy helpers. */

export const ATTENDEE_CAPABILITIES = [
  "scoring",
  "publicLeaderboard",
  "manualStaffAwards",
  "discoveries",
  "guestPhotos",
  "transfers",
  "onwardTransfers",
  "complimentaryTransfers",
] as const;

export type AttendeeCapability = (typeof ATTENDEE_CAPABILITIES)[number];
export type CapabilityMap = Record<AttendeeCapability, boolean>;

export const DEFAULT_GLOBAL_AVAILABILITY: CapabilityMap = {
  scoring: true,
  publicLeaderboard: true,
  manualStaffAwards: true,
  discoveries: true,
  guestPhotos: true,
  transfers: false,
  onwardTransfers: false,
  complimentaryTransfers: false,
};

export const DEFAULT_NEW_EVENT_CAPABILITIES: CapabilityMap = {
  scoring: false,
  publicLeaderboard: false,
  manualStaffAwards: false,
  discoveries: false,
  guestPhotos: false,
  transfers: false,
  onwardTransfers: false,
  complimentaryTransfers: false,
};

export interface GlobalOperationsSettings {
  globalAvailability: CapabilityMap;
  newEventDefaults: CapabilityMap;
  emergencyPaused: CapabilityMap;
  revision: number;
  updatedBy: string;
  updateReason?: string;
  updatedAt: string;
}

export interface EventOperationsPolicy {
  eventSlug: string;
  capabilities: CapabilityMap;
  transferOpensAt?: string;
  transferClosesAt?: string;
  policyVersion: number;
  updatedBy: string;
  updateReason?: string;
  updatedAt: string;
}

export function capabilityMap(value: unknown, fallback: CapabilityMap): CapabilityMap {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return Object.fromEntries(
    ATTENDEE_CAPABILITIES.map((capability) => [
      capability,
      typeof (record as Record<string, unknown>)[capability] === "boolean"
        ? (record as Record<string, boolean>)[capability]
        : fallback[capability],
    ]),
  ) as CapabilityMap;
}

export function effectiveCapability(
  global: Pick<GlobalOperationsSettings, "globalAvailability" | "emergencyPaused">,
  event: Pick<EventOperationsPolicy, "capabilities" | "transferOpensAt" | "transferClosesAt">,
  capability: AttendeeCapability,
  now = Date.now(),
): boolean {
  if (!global.globalAvailability[capability] || global.emergencyPaused[capability]) return false;
  if (!event.capabilities[capability]) return false;
  if (capability !== "transfers") return true;
  const opens = event.transferOpensAt
    ? Date.parse(event.transferOpensAt)
    : Number.NEGATIVE_INFINITY;
  const closes = event.transferClosesAt
    ? Date.parse(event.transferClosesAt)
    : Number.POSITIVE_INFINITY;
  return Number.isFinite(opens) || !event.transferOpensAt
    ? (Number.isFinite(closes) || !event.transferClosesAt) && now >= opens && now <= closes
    : false;
}

export const GLOBAL_ADMIN_PERMISSIONS = [
  "viewOperations",
  "manageEvents",
  "manageTickets",
  "executeRefunds",
  "manageScoring",
  "manageCommunications",
  "manageContent",
  "managePeople",
  "manageGlobalSettings",
  "viewFinance",
  "viewSensitiveData",
  "viewAudit",
] as const;

export type GlobalAdminPermission = (typeof GLOBAL_ADMIN_PERMISSIONS)[number];
export type GlobalAdminPermissionSet = Record<GlobalAdminPermission, boolean>;

export const GLOBAL_ADMIN_ROLE_PRESETS = {
  owner: GLOBAL_ADMIN_PERMISSIONS,
  admin: GLOBAL_ADMIN_PERMISSIONS.filter((permission) => permission !== "manageGlobalSettings"),
  finance: ["viewOperations", "manageTickets", "executeRefunds", "viewFinance", "viewAudit"],
  support: ["viewOperations", "manageTickets", "managePeople", "viewAudit"],
  communications: ["viewOperations", "manageCommunications"],
  content: ["manageContent"],
  auditor: ["viewOperations", "viewFinance", "viewAudit"],
} as const satisfies Record<string, readonly GlobalAdminPermission[]>;

export type GlobalAdminRole = keyof typeof GLOBAL_ADMIN_ROLE_PRESETS;

export function permissionsForGlobalRole(
  role: GlobalAdminRole,
  overrides: Partial<GlobalAdminPermissionSet> = {},
): GlobalAdminPermissionSet {
  const preset: readonly string[] = GLOBAL_ADMIN_ROLE_PRESETS[role];
  return Object.fromEntries(
    GLOBAL_ADMIN_PERMISSIONS.map((permission) => [
      permission,
      typeof overrides[permission] === "boolean"
        ? overrides[permission]
        : preset.includes(permission),
    ]),
  ) as GlobalAdminPermissionSet;
}

export type TicketAssignmentState = "pending" | "claimed" | "cancelled" | "expired";
export type TicketTransferState =
  | "pending"
  | "accepted"
  | "declined"
  | "cancelled"
  | "expired"
  | "invalidated";

export function isTerminalTicketTransfer(state: TicketTransferState): boolean {
  return state !== "pending";
}

export type AdminNotificationStatus = "new" | "seen" | "in-progress" | "resolved" | "dismissed";
