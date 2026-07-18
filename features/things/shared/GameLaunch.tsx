import type { ButtonHTMLAttributes, ReactNode } from "react";

type LaunchTone = "night" | "cream" | "paper";

interface GameLaunchProps {
  align?: "left" | "center";
  children: ReactNode;
  description: ReactNode;
  eyebrow: ReactNode;
  title: ReactNode;
  tone: LaunchTone;
}

export function GameLaunch({
  align = "left",
  children,
  description,
  eyebrow,
  title,
  tone,
}: GameLaunchProps) {
  const light = tone === "cream";
  const centred = align === "center";

  return (
    <section
      className={`mx-auto w-full max-w-lg pt-7 ${centred ? "text-center" : ""}`}
      aria-labelledby="game-launch-title"
    >
      <p
        className={`font-mono text-micro uppercase tracking-[0.2em] ${
          light ? "text-black/40" : "text-white/45"
        }`}
      >
        {eyebrow}
      </p>
      <h1
        id="game-launch-title"
        className="mt-3 font-serif text-5xl font-semibold leading-[0.98] tracking-tight sm:text-6xl"
      >
        {title}
      </h1>
      <p
        className={`mt-5 max-w-md font-serif text-lg leading-relaxed ${
          centred ? "mx-auto" : ""
        } ${light ? "text-black/60" : "text-white/65"}`}
      >
        {description}
      </p>
      <div className="mt-9">{children}</div>
    </section>
  );
}

interface GameLaunchButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  accent: "amber" | "ink" | "paper";
}

export function GameLaunchButton({ accent, className = "", ...props }: GameLaunchButtonProps) {
  const colour =
    accent === "amber"
      ? "bg-[var(--things-amber)] text-black"
      : accent === "ink"
        ? "bg-black text-white"
        : "bg-white text-black";

  return (
    <button
      type="button"
      className={`min-h-16 w-full rounded-full px-7 font-mono text-sm font-bold shadow-xl transition-transform hover:scale-[1.01] disabled:opacity-40 ${colour} ${className}`}
      {...props}
    />
  );
}

export function GameLaunchMeta({
  children,
  tone,
}: {
  children: ReactNode;
  tone: "dark" | "light";
}) {
  return (
    <p
      className={`mt-3 text-center font-mono text-micro ${
        tone === "light" ? "text-black/45" : "text-white/45"
      }`}
    >
      {children}
    </p>
  );
}

export function GameLaunchChoices({
  children,
  tone,
}: {
  children: ReactNode;
  tone: "dark" | "light";
}) {
  return (
    <div
      className={`mt-5 flex min-h-11 flex-wrap items-center justify-center gap-x-5 gap-y-1 border-t pt-4 font-mono text-xs ${
        tone === "light" ? "border-black/10 text-black/60" : "border-white/10 text-white/60"
      }`}
    >
      {children}
    </div>
  );
}
