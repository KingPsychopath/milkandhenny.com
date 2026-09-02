import type { ActivityStatus, ScoreRule } from "@/features/event-scoring/types";

export type AdminScoringActivity = {
  id: string;
  name: string;
  template: string;
  status: ActivityStatus;
  rule: ScoreRule;
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

export type AdminScoringTeam = {
  id: string;
  name: string;
  colourKey?: import("@/lib/shared/team-palette").TeamColourKey;
  memberCount: number;
  checkedInCount: number;
  status: "active" | "archived";
};

export type AdminTeamParticipant = {
  id: string;
  publicAlias: string;
  displayName?: string;
  ticketSuffix?: string;
  teamId?: string;
  teamName?: string;
  teamColourKey?: import("@/lib/shared/team-palette").TeamColourKey;
  checkedIn: boolean;
};

import type { AdminStaffAssignment, AdminStaffRole } from "./staff-access-types";

export type ScoringData = {
  settings: {
    state: string;
    leaderboardVisibility: string;
    gamesOpenAt?: string;
    gamesCloseAt?: string;
    scheduledStart?: string;
    scheduledFreeze?: string;
    scheduledEnd?: string;
    revision: number;
  };
  activities: AdminScoringActivity[];
  eventGames: Array<{
    id: string;
    gameKey: string;
    label: string;
    playMode: "pooled" | "hosted" | "table";
    poolEntranceId?: string;
    awardMethod: "staff" | "automatic";
    activityIds: string[];
    status: "included" | "paused";
  }>;
  personalTemplates: Array<{
    id: string;
    name: string;
    activityTemplate: string;
    rule: ScoreRule;
    updatedAt: string;
  }>;
  operations: {
    windowMinutes: number;
    scoreWrites: number;
    rejectedCommands: number;
    heldActions: number;
    projectionDrift: number;
    exhaustedPools: number;
    discoveryClaims: number;
    discoveryRejected: number;
    mediaLinks: number;
    mediaFailures: number;
    writeFailures: number;
    sessionFailures: number;
    alerts: Array<{ code: string; severity: "warning" | "critical"; message: string }>;
  };
  pools: AdminScoringPool[];
  teams: AdminScoringTeam[];
  teamRoster: AdminTeamParticipant[];
  held: { id: string; sourceType: string; createdAt: string }[];
  heldOfficialResults: Array<{
    id: string;
    gameKind: string;
    gameInstanceId: string;
    resultId: string;
    revision: number;
    heldReason: string | null;
    ingestedAt: string;
  }>;
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
  staffRoles: AdminStaffRole[];
  checkpoints: Array<{ id: string; name: string }>;
  media: Array<{
    id: string;
    storageRef: string;
    visibility: "event-album" | "admin-evidence" | "discard";
    consentState: "not-requested" | "requested" | "obtained" | "declined";
    expiresAt?: string;
    deletedAt?: string;
  }>;
  mediaDrop: { uploadPath?: string; albumPath: string; expiresAt: string } | null;
  audit: Array<{
    id: number;
    action: string;
    actorType: string;
    actorId?: string;
    entityType: string;
    entityId: string;
    createdAt: string;
  }>;
  anomalies: Array<{
    id: number;
    transactionId?: string;
    participantId?: string;
    activityId?: string;
    actorId?: string;
    assignmentId?: string;
    stationId?: string;
    deviceId?: string;
    signal: string;
    state: string;
    createdAt: string;
  }>;
  merges: Array<{
    id: string;
    sourceParticipantId: string;
    targetParticipantId: string;
    reason: string;
    createdAt: string;
  }>;
};
