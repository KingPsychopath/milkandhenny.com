import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { GamePoolDefaultLaunch as GamePoolDefaultLaunchTarget } from "./types";

export function GamePoolDefaultLaunch({
  pool,
  children,
  tone = "dark",
}: {
  pool: GamePoolDefaultLaunchTarget;
  children: ReactNode;
  tone?: "dark" | "light";
}) {
  const colour = tone === "light" ? "bg-black text-white" : "bg-[var(--things-amber)] text-black";
  return (
    <Link
      to={pool.path}
      className={`flex min-h-16 w-full items-center justify-center rounded-full px-7 text-center font-mono text-sm font-bold shadow-xl transition-opacity hover:opacity-90 ${colour}`}
    >
      {children}
    </Link>
  );
}
