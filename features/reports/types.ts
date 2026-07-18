import type { CountryDrawing, CountryScore } from "@/features/things/draw-country/types";
import type { ReportType } from "./report-policy";

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
}

export interface ReportContextByType {
  draw_country_result_issue: DrawCountryResultIssueContext;
}

export interface ReportInputByType {
  draw_country_result_issue: {
    countryId: string;
    mode: "solo" | "multiplayer";
    drawing: CountryDrawing;
  };
}

export type UserReportDraft = {
  [Type in ReportType]: {
    type: Type;
    subjectKey: string;
    context: ReportContextByType[Type];
  };
}[ReportType];

export type UserReportRecord = {
  [Type in ReportType]: {
    id: string;
    type: Type;
    subjectKey: string;
    createdAt: string;
    context: ReportContextByType[Type];
  };
}[ReportType];

export type AdminReportGroup = {
  [Type in ReportType]: {
    id: string;
    type: Type;
    label: string;
    subjectKey: string;
    reportIds: string[];
    count: number;
    priority: number;
    halfLifeDays: number;
    firstReportedAt: string;
    latestReportedAt: string;
    latestContext: ReportContextByType[Type];
    recentReports: Array<{
      id: string;
      createdAt: string;
      context: ReportContextByType[Type];
    }>;
  };
}[ReportType];
