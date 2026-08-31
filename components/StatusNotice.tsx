import type { ReactNode } from "react";

export type StatusTone = "positive" | "attention" | "danger" | "neutral";

export function StatusNotice({
  tone,
  label,
  children,
  role = tone === "danger" ? "alert" : "status",
  announce = true,
  className = "",
}: {
  tone: StatusTone;
  label: string;
  children?: ReactNode;
  role?: "alert" | "status";
  announce?: boolean;
  className?: string;
}) {
  return (
    <div
      role={announce ? role : undefined}
      className={`mh-status mh-status--${tone} ${className}`.trim()}
    >
      <span className="mh-status__mark" aria-hidden="true" />
      <span>
        <strong className="mh-status__label">{label}</strong>
        {children ? <span className="mh-status__detail">{children}</span> : null}
      </span>
    </div>
  );
}
