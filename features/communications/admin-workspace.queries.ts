import { queryOptions } from "@tanstack/react-query";
import { readCommunicationsWorkspaceFn } from "./admin-workspace.functions";

export type CommunicationsWorkspaceScope = {
  tab: string;
  eventSlug: string;
  query: string;
};

export const communicationsWorkspaceKey = (scope: CommunicationsWorkspaceScope) =>
  ["admin", "communications", "workspace", scope.tab, scope.eventSlug, scope.query] as const;

export function communicationsWorkspaceQuery(scope: CommunicationsWorkspaceScope) {
  return queryOptions({
    queryKey: communicationsWorkspaceKey(scope),
    queryFn: () => readCommunicationsWorkspaceFn({ data: scope }),
    staleTime: 10_000,
  });
}
