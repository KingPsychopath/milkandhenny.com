import type { ReactNode } from "react";

export function GameShell({
  children,
  tone,
}: {
  children: ReactNode;
  tone: "night" | "amber" | "green" | "stone" | "cream";
}) {
  return <div className={`things-game things-game--${tone}`}>{children}</div>;
}
