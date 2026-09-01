import type { PageData, StaffOperation } from "./useStaffScoringController";

type OperationChoice = { id: StaffOperation; label: string };

export function StaffOperationNav({
  data,
  value,
  onChange,
}: {
  data: PageData;
  value: StaffOperation;
  onChange: (operation: StaffOperation) => void;
}) {
  const choices: OperationChoice[] = [
    ...(data.canAdmit ? [{ id: "admit" as const, label: "door" }] : []),
    ...(data.canScanCheckpoints && data.checkpoints.length > 0
      ? [{ id: "checkpoint" as const, label: "checkpoints" }]
      : []),
    ...(data.canRun && data.canAward ? [{ id: "run" as const, label: "game results" }] : []),
    ...(data.canAward ? [{ id: "award" as const, label: "give points" }] : []),
    ...(data.canManageTeams ? [{ id: "teams" as const, label: "teams" }] : []),
    ...(data.canManageGuestPhotos ? [{ id: "photos" as const, label: "photos" }] : []),
  ];

  if (choices.length < 2) return null;

  return (
    <nav
      aria-label="Staff tool"
      className="sticky top-0 z-20 -mx-6 mt-6 border-y theme-border bg-[var(--background)] px-6 py-2"
    >
      <div className="flex gap-2 overflow-x-auto" role="list">
        {choices.map((choice) => (
          <button
            key={choice.id}
            type="button"
            onClick={() => onChange(choice.id)}
            aria-pressed={value === choice.id}
            className={`mh-action shrink-0 ${value === choice.id ? "mh-action--primary" : "mh-action--quiet"}`}
          >
            {choice.label}
          </button>
        ))}
      </div>
    </nav>
  );
}
