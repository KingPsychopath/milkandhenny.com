import { getRequest } from "@tanstack/react-start/server";
import { authenticateRequest } from "./auth.server";
import type { AuthRole } from "./auth.server";

export function requireAuthFromServerContext(role: AuthRole) {
  return authenticateRequest(getRequest(), role);
}
