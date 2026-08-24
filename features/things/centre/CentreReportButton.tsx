import { ReportIssueButton } from "@/features/reports/ReportIssueButton";

export function CentreReportButton({ phase, roomId }: { phase: string; roomId?: string }) {
  return (
    <ReportIssueButton
      type="things_room_issue"
      payload={{ game: "centre", phase, ...(roomId ? { roomId } : {}) }}
      label="something feel off?"
      className="justify-center opacity-75"
    />
  );
}
