import { queryOptions } from "@tanstack/react-query";
import { getAdminPitchRemindersFn, getAdminPitchWorkspaceFn } from "./admin-workspace.functions";

export const adminPitchWorkspaceQuery = queryOptions({
  queryKey: ["admin", "pitches", "workspace"] as const,
  queryFn: () => getAdminPitchWorkspaceFn(),
  staleTime: 10_000,
  retry: false,
});

export const adminPitchRemindersQuery = queryOptions({
  queryKey: ["admin", "pitches", "reminders"] as const,
  queryFn: () => getAdminPitchRemindersFn(),
  staleTime: 10_000,
  retry: false,
});
