import type { ReactNode } from "react";
import { ReportIssueButton } from "@/features/reports/ReportIssueButton";

function currentGame() {
  if (typeof location === "undefined") return "things";
  return location.pathname.split("/").filter(Boolean)[1] ?? "things";
}

export function GameShell({
  children,
  tone,
}: {
  children: ReactNode;
  tone: "night" | "amber" | "green" | "stone" | "cream";
}) {
  return (
    <div className={`things-game things-game--${tone}`}>
      {children}
      <div className="flex justify-center px-5 pb-5">
        <ReportIssueButton
          type="things_room_issue"
          payload={{ game: currentGame() }}
          className="justify-center opacity-80"
        />
      </div>
    </div>
  );
}
