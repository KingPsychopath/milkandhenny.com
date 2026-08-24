import type { CountryDrawing, CountryScore } from "@/features/things/draw-country/types";
import type { ReportSeverity, ReportSource, ReportStatus, ReportType } from "./report-policy";

export interface DiagnosticAction {
  at: string;
  name: string;
  data?: Record<string, boolean | number | string | null>;
}

export interface DiagnosticDevice {
  userAgent?: string;
  platform?: string;
  viewport?: { width: number; height: number; pixelRatio: number };
  touch?: boolean;
  online?: boolean;
  timezone?: string;
}

export interface DiagnosticError {
  name?: string;
  code?: string;
  message?: string;
  stack?: string;
}

export interface DiagnosticContext {
  schemaVersion: 1;
  diagnosticId: string;
  buildId: string;
  route: string;
  device: DiagnosticDevice;
  trail: DiagnosticAction[];
  error?: DiagnosticError;
}

export interface DrawCountryResultIssueContext {
  schemaVersion: 1;
  mode: "solo" | "multiplayer";
  country: {
    id: string;
    name: string;
    aspect: number;
    ringCount: number;
    pointCount: number;
    outlineFingerprint: string;
  };
  result: CountryScore;
  drawing: {
    raw: CountryDrawing;
    aligned?: CountryDrawing;
  };
  diagnostics: DiagnosticContext;
  note?: string;
}

export interface ClientErrorContext {
  schemaVersion: 1;
  surface: string;
  operation?: string;
  errorCode?: string;
  diagnostics: DiagnosticContext;
  note?: string;
}

export interface SiteFeedbackContext {
  schemaVersion: 1;
  surface: string;
  diagnostics: DiagnosticContext;
  note?: string;
}

export interface ThingsRoomIssueContext {
  schemaVersion: 1;
  game: string;
  roomId?: string;
  phase?: string;
  connectionState?: "connected" | "reconnecting" | "offline";
  sequence?: number;
  revision?: number;
  issue?: string;
  diagnostics: DiagnosticContext;
  note?: string;
}

export interface PitchIssueContext {
  schemaVersion: 1;
  surface: string;
  deckId?: string;
  roomId?: string;
  slideId?: string;
  slideIndex?: number;
  operation?: string;
  status?: string;
  retryable?: boolean;
  diagnostics: DiagnosticContext;
  note?: string;
}

export interface UploadIssueContext {
  schemaVersion: 1;
  surface: "transfer" | "words" | string;
  phase?: string;
  operation?: string;
  fileCount?: number;
  bytes?: number;
  status?: number;
  errorCode?: string;
  retryable?: boolean;
  diagnostics: DiagnosticContext;
  note?: string;
}

export interface ReportContextByType {
  client_error: ClientErrorContext;
  site_feedback: SiteFeedbackContext;
  draw_country_result_issue: DrawCountryResultIssueContext;
  things_room_issue: ThingsRoomIssueContext;
  pitch_issue: PitchIssueContext;
  upload_issue: UploadIssueContext;
}

export interface ReportInputByType {
  client_error: {
    surface: string;
    operation?: string;
    errorCode?: string;
  };
  site_feedback: {
    surface: string;
  };
  draw_country_result_issue: {
    countryId: string;
    mode: "solo" | "multiplayer";
    drawing: CountryDrawing;
  };
  things_room_issue: {
    game: string;
    roomId?: string;
    phase?: string;
    connectionState?: "connected" | "reconnecting" | "offline";
    sequence?: number;
    revision?: number;
    issue?: string;
  };
  pitch_issue: {
    surface: string;
    deckId?: string;
    roomId?: string;
    slideId?: string;
    slideIndex?: number;
    operation?: string;
    status?: string;
    retryable?: boolean;
  };
  upload_issue: {
    surface: "transfer" | "words" | string;
    phase?: string;
    operation?: string;
    fileCount?: number;
    bytes?: number;
    status?: number;
    errorCode?: string;
    retryable?: boolean;
  };
}

export interface ReportDiagnosticsInput {
  diagnosticId?: string;
  buildId?: string;
  route?: string;
  device?: DiagnosticDevice;
  trail?: DiagnosticAction[];
  error?: DiagnosticError;
}

export type UserReportEnvelope = {
  [Type in ReportType]: {
    type: Type;
    payload: ReportInputByType[Type];
    diagnostics?: ReportDiagnosticsInput;
    note?: string;
  };
}[ReportType];

export type UserReportDraft = {
  [Type in ReportType]: {
    type: Type;
    subjectKey: string;
    severity: ReportSeverity;
    source: ReportSource;
    context: ReportContextByType[Type];
  };
}[ReportType];

export type UserReportRecord = {
  [Type in ReportType]: {
    id: string;
    type: Type;
    subjectKey: string;
    createdAt: string;
    updatedAt: string;
    status: ReportStatus;
    severity: ReportSeverity;
    source: ReportSource;
    context: ReportContextByType[Type];
  };
}[ReportType];

export type AdminReportGroup = {
  id: string;
  type: ReportType;
  label: string;
  subjectKey: string;
  status: ReportStatus;
  severity: ReportSeverity;
  reportIds: string[];
  count: number;
  activeCount: number;
  priority: number;
  halfLifeDays: number;
  firstReportedAt: string;
  latestReportedAt: string;
  latestContext: ReportContextByType[ReportType];
  recentReports: Array<{
    id: string;
    createdAt: string;
    updatedAt: string;
    status: ReportStatus;
    severity: ReportSeverity;
    source: ReportSource;
    context: ReportContextByType[ReportType];
  }>;
};
