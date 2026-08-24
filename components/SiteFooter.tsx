import type { ReactNode } from "react";

type SiteFooterProps = {
  children: ReactNode;
  maxWidth?: "2xl" | "4xl";
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
