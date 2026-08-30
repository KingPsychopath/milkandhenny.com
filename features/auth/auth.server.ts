/** Stable authentication boundary; implementation is split by responsibility. */
export {
  authenticateRequest,
  createAdminStepUpToken,
  getAdminWorkspaceAccess,
  requireAdminStepUp,
  requireAuth,
  requireAuthWithPayload,
  revokeCurrentSession,
} from "./internal/authorization.server";
export type { AdminWorkspaceAccess } from "./internal/authorization.server";
export {
  getLocalDevAdminCookieValue,
  getClientIp,
  isLocalDevelopment,
  isValidTokenJti,
  issueAdminTokenForCli,
  safeCompare,
} from "./internal/token-session.server";
export {
  getSecurityWarnings,
  handleVerifyRequest,
  revokeAllRoleTokens,
  revokeRoleTokens,
} from "./internal/verify.server";
export type { AuthRole, RevocableRole } from "./internal/token-session.server";
