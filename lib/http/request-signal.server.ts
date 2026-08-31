import { getRequest } from "@tanstack/react-start/server";

/** Returns the active TanStack request signal when called from an HTTP/server-function boundary. */
export function activeRequestSignal(): AbortSignal | undefined {
  try {
    return getRequest().signal;
  } catch {
    // Scheduled jobs, scripts, and focused engine tests intentionally have no request context.
    return undefined;
  }
}
