import { useRouterState } from "@tanstack/react-router";
import { ReportIssueButton } from "@/features/reports/ReportIssueButton";

export function ThingsReportFooter() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const segments = pathname.split("/").filter(Boolean);
  const game = segments[1] ?? "things";
  if (game === "centre" || ((game === "draw-country" || game === "pitches") && segments.length > 2))
    return null;

  return (
    <footer className="things-report-footer flex justify-center px-5 py-5">
      <ReportIssueButton type="things_room_issue" payload={{ game }} className="justify-center" />
    </footer>
  );
}
