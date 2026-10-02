import type { ComponentProps } from "react";

/** Native disclosure semantics, with one shared touch target and open/closed indicator. */
export function Disclosure({ className = "", ...props }: ComponentProps<"details">) {
  return <details className={`mh-disclosure ${className}`} {...props} />;
}

export function DisclosureSummary({ className = "", ...props }: ComponentProps<"summary">) {
  return <summary role="button" className={`mh-disclosure-trigger ${className}`} {...props} />;
}
