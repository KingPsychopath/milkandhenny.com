import { Link } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import type { ComponentProps, ReactNode } from "react";
import { Disclosure, DisclosureSummary } from "@/components/Disclosure";
import "./GameFrame.css";

export function GameFrame({
  children,
  tone = "theme",
  className = "",
  ...props
}: {
  children: ReactNode;
  tone?: "night" | "amber" | "green" | "stone" | "cream" | "theme";
} & ComponentProps<"div">) {
  return (
    <div className={`things-game things-game--${tone} game-frame ${className}`} {...props}>
      {children}
    </div>
  );
}

/** Games supply their back action, status, and necessary live controls in the same header slots. */
export function GameFrameHeader({
  children,
  menu,
  className = "",
  ...props
}: ComponentProps<"header"> & { menu?: ReactNode }) {
  return (
    <div className="game-frame-bar">
      <header className={`game-frame-header ${className}`} {...props}>
        {children}
      </header>
      <GameMenu>{menu}</GameMenu>
    </div>
  );
}

export function GameFrameFooter({ className = "", ...props }: ComponentProps<"footer">) {
  return <footer className={`game-frame-footer ${className}`} {...props} />;
}

function GameMenu({ children }: { children?: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && ref.current && !ref.current.contains(event.target))
        ref.current.open = false;
    };
    const closeEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (!ref.current?.open) return;
      ref.current.open = false;
      ref.current?.querySelector("summary")?.focus();
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeEscape);
    };
  }, []);
  return (
    <Disclosure ref={ref} className="game-frame-menu">
      <DisclosureSummary className="game-frame-menu-trigger">menu</DisclosureSummary>
      <nav aria-label="Game menu" className="game-frame-menu-panel">
        {children ? <div className="game-frame-menu-controls">{children}</div> : null}
        <Link
          to="/things"
          onClick={() => {
            if (ref.current) ref.current.open = false;
          }}
        >
          all games
        </Link>
        <Link
          to="/"
          onClick={() => {
            if (ref.current) ref.current.open = false;
          }}
        >
          home
        </Link>
        <Link to="/my">account</Link>
      </nav>
    </Disclosure>
  );
}
