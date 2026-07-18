import { ReportIssueButton } from "@/features/reports/ReportIssueButton";
import type { CountryDrawing } from "./types";

export function DrawCountryResultReport({
  countryId,
  drawing,
  mode,
}: {
  countryId: string;
  drawing: CountryDrawing;
  mode: "solo" | "multiplayer";
}) {
  return (
    <ReportIssueButton type="draw_country_result_issue" context={{ countryId, drawing, mode }} />
  );
}
