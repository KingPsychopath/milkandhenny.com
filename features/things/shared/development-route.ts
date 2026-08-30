import { notFound } from "@tanstack/react-router";

/** Development harnesses can mint rooms and expose private test state, so noindex is not enough. */
export function requireDevelopmentRoute() {
  if (!import.meta.env.DEV) throw notFound();
}
