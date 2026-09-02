export type AdminStaffDevice = {
  deviceId: string;
  lastSeenAt: string;
  revokedAt?: string;
};

export type AdminStaffAssignment = {
  id: string;
  roleId: string;
  personId?: string;
  label: string;
  assignmentType: "personal" | "station";
  status: string;
  invitationState?: string;
  rolePreset?: string;
  expiresAt?: string;
  revokedAt?: string;
  activatedAt?: string;
  lastUsedAt?: string;
  permissions: Record<string, boolean>;
  scope: Record<string, unknown>;
  invitedEmailHint?: string;
  assignedEmailHint?: string;
  personName?: string;
  invitationDelivery: "email" | "copy" | "direct" | "station";
  devices: AdminStaffDevice[];
};

export type AdminStaffRole = {
  id: string;
  label: string;
  rolePreset: string;
  permissions: Record<string, boolean>;
  scope: Record<string, unknown>;
  expiresAt: string;
  status: "active" | "archived";
};

export type StaffAccessAction = (
  body: Record<string, unknown>,
) => Promise<Record<string, unknown> | null>;
