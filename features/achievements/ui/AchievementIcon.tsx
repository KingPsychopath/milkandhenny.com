import type { AchievementIconKey } from "../types";

export function AchievementIcon({
  icon,
  className = "size-7",
}: {
  icon: AchievementIconKey;
  className?: string;
}) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    "aria-hidden": true,
  };
  if (icon === "door")
    return (
      <svg {...common}>
        <path d="M5 21h14M7 21V3h10v18M14 12h.01" />
      </svg>
    );
  if (icon === "search")
    return (
      <svg {...common}>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m15.5 15.5 5 5M8 10.5h5M10.5 8v5" />
      </svg>
    );
  if (icon === "map")
    return (
      <svg {...common}>
        <path d="m3 6 5-2 8 3 5-2v13l-5 2-8-3-5 2V6Z" />
        <path d="M8 4v13M16 7v13" />
      </svg>
    );
  if (icon === "dice")
    return (
      <svg {...common}>
        <rect x="3" y="3" width="18" height="18" rx="3" />
        <path d="M8 8h.01M16 8h.01M12 12h.01M8 16h.01M16 16h.01" />
      </svg>
    );
  if (icon === "grid")
    return (
      <svg {...common}>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    );
  if (icon === "bingo")
    return (
      <svg {...common}>
        <path d="M3 3h18v18H3zM9 3v18M15 3v18M3 9h18M3 15h18" />
        <path d="m10.5 12 1 1 2-2" />
      </svg>
    );
  if (icon === "letters")
    return (
      <svg {...common}>
        <path d="m4 19 5-14 5 14M6 14h6M15 8h5M17.5 5v6M15 19h5" />
      </svg>
    );
  if (icon === "slides")
    return (
      <svg {...common}>
        <rect x="3" y="4" width="18" height="13" rx="2" />
        <path d="M8 21h8M12 17v4M7 13l3-3 2 2 4-4 2 2" />
      </svg>
    );
  return (
    <svg {...common}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M7 3v4M17 3v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" />
    </svg>
  );
}
