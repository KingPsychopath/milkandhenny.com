import { configurationActions } from "./configuration.server";
import { discoveryActions } from "./discoveries.server";
import { identityActions } from "./identity.server";
import { ledgerActions } from "./ledger.server";
import { mediaExportActions } from "./media-export.server";
import { staffingActions } from "./staffing.server";
import type { AdminScoringActionContext, AdminScoringActionHandlers } from "./shared";

const ACTIONS: AdminScoringActionHandlers = {
  ...configurationActions,
  ...ledgerActions,
  ...discoveryActions,
  ...staffingActions,
  ...mediaExportActions,
  ...identityActions,
};

export async function runAdminScoringAction(
  action: string | undefined,
  context: AdminScoringActionContext,
): Promise<Response> {
  const handler = action ? ACTIONS[action] : undefined;
  return handler
    ? handler(context)
    : Response.json({ error: "Unknown scoring action" }, { status: 400 });
}
