import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import type { GamePoolDefaultLaunch as GamePoolDefaultLaunchTarget } from "./types";

export function GamePoolDefaultLaunch({
  pool,
  children,
  tone = "dark",
  emphasis = "primary",
}: {
  pool: GamePoolDefaultLaunchTarget;
  children: ReactNode;
  tone?: "dark" | "light" | "theme";
  emphasis?: "primary" | "secondary";
}) {
  const colour =
    emphasis === "primary"
      ? tone === "light"
        ? "bg-black text-white"
        : "bg-[var(--things-amber)] text-black"
      : tone === "theme"
        ? "theme-border border text-[var(--foreground)]"
        : tone === "light"
          ? "border border-black/25 text-black"
          : "border border-white/25 text-white";
  const depth = emphasis === "primary" ? "shadow-xl" : "";
  return (
    <Link
      to={pool.path}
      className={`flex min-h-16 w-full items-center justify-center rounded-full px-7 text-center font-mono text-sm font-bold transition-opacity hover:opacity-90 ${depth} ${colour}`}
    >
      {children}
    </Link>
  );
}
