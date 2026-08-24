import type { ReactNode } from "react";

type SiteFooterProps = {
  children: ReactNode;
  maxWidth?: "2xl" | "4xl";
};

type JourneyRailProps = {
  leading?: ReactNode;
  trailing?: ReactNode;
  maxWidth?: "2xl" | "4xl";
  ariaLabel?: string;
};

type SiteFooterBarProps = {
  leading: ReactNode;
  trailing: ReactNode;
};

/** Shared layout for public page footers. Product controls keep their own footers. */
export function SiteFooter({ children, maxWidth = "2xl" }: SiteFooterProps) {
  const widthClass = maxWidth === "4xl" ? "max-w-4xl" : "max-w-2xl";

  return (
    <footer className="border-t theme-border">
      <div className={`relative mx-auto w-full ${widthClass} px-6 py-8 sm:py-10`}>{children}</div>
    </footer>
  );
}

export function SiteFooterBar({ leading, trailing }: SiteFooterBarProps) {
  return (
    <div className="flex flex-col items-center gap-4 text-center font-mono text-micro tracking-wide theme-muted md:flex-row md:items-center md:justify-between md:text-left">
      <div className="min-w-0 shrink-0">{leading}</div>
      <div className="min-w-0">{trailing}</div>
    </div>
  );
}

/** Contextual movement for deep pages. It is not global site navigation. */
export function JourneyRail({
  leading,
  trailing,
  maxWidth = "2xl",
  ariaLabel = "Page navigation",
}: JourneyRailProps) {
  if (!leading && !trailing) return null;
  const widthClass = maxWidth === "4xl" ? "max-w-4xl" : "max-w-2xl";

  return (
    <nav aria-label={ariaLabel} className="border-t theme-border">
      <div
        className={`mx-auto flex w-full ${widthClass} flex-col items-center gap-4 px-6 py-8 text-center font-mono text-micro tracking-wide theme-muted md:flex-row md:items-center ${leading ? "md:justify-between md:text-left" : "md:justify-end"} [&_a]:inline-flex [&_a]:min-h-11 [&_a]:items-center`}
      >
        {leading ? <div className="min-w-0">{leading}</div> : null}
        {trailing ? <div className="min-w-0">{trailing}</div> : null}
      </div>
    </nav>
  );
}
