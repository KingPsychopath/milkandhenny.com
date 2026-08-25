export type AdminScoringActivity = {
  id: string;
  name: string;
  template: string;
  status: string;
  rule: {
    mode: string;
    fixedPoints?: number;
    participationPoints?: number;
    repeat: string;
    requiresCheckIn: boolean;
  };
};

export type AdminScoringPool = {
  id: string;
  activityId?: string;
  ownerType: string;
  ownerId?: string;
  issued: number;
  reserved: number;
  spent: number;
  held: number;
  available: number;
};

export type AdminStaffDevice = {
  deviceId: string;
  lastSeenAt: string;
  revokedAt?: string;
};

export type AdminStaffAssignment = {
  id: string;
  label: string;
  assignmentType: "personal" | "station";
  status: string;
  expiresAt?: string;
  permissions: Record<string, boolean>;
  scope: Record<string, unknown>;
  devices: AdminStaffDevice[];
};

export type ScoringData = {
  settings: { state: string; leaderboardVisibility: string; revision: number };
  activities: AdminScoringActivity[];
  pools: AdminScoringPool[];
  held: { id: string; sourceType: string; createdAt: string }[];
  discoveries: Array<{
    id: string;
    activityId: string;
    name: string;
    method: string;
    status: string;
    rule: Record<string, unknown>;
    clues: Array<{ key: string; label: string; replacementRevision: number }>;
  }>;
  staff: AdminStaffAssignment[];
};

export type ScoringAction = (
  body: Record<string, unknown>,
) => Promise<Record<string, unknown> | null>;
