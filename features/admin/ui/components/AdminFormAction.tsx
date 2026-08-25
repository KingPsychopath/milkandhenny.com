import type { ReactNode } from "react";

export function AdminFormAction({
  children,
  className = "",
  spacing = "compact",
}: {
  children: ReactNode;
  className?: string;
  spacing?: "compact" | "comfortable";
}) {
  return (
    <div className="admin-form-field">
      {/* Preserve the label track so the action shares the neighbouring controls' row. */}
      <span aria-hidden="true" className="hidden font-mono text-micro theme-muted sm:inline">
        {"\u200b"}
      </span>
      <div className={`${spacing === "comfortable" ? "mt-2" : "mt-1"} sm:mt-0 ${className}`}>
        {children}
      </div>
      <span aria-hidden="true" />
    </div>
  );
}
