import { isTeamColourKey, type TeamColourKey } from "@/lib/shared/team-palette";

export function TeamBadge({
  name,
  colourKey,
  detail,
  className = "",
}: {
  name: string;
  colourKey?: TeamColourKey | string;
  detail?: string;
  className?: string;
}) {
  const colour = isTeamColourKey(colourKey) ? colourKey : "amber";
  return (
    <span
      className={`team-badge team-colour--${colour} inline-flex items-center gap-2 font-mono text-micro ${className}`.trim()}
    >
      <span className="team-badge__mark" aria-hidden="true" />
      <span>{name}</span>
      {detail ? <span className="theme-muted">· {detail}</span> : null}
    </span>
  );
}
