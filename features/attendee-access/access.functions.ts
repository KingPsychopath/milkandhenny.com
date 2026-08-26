import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";

import { currentAttendeeAccountStatus, currentAttendeeAccountView } from "./access.server";

const accountLoginRedirect = () =>
  redirect({ to: "/access", search: { returnTo: "/my" }, replace: true });

export const requireAttendeeAccountFn = createServerFn({ method: "GET" }).handler(async () => {
  if (!(await currentAttendeeAccountStatus())) throw accountLoginRedirect();
  return { authenticated: true as const };
});

export const getMyAccountFn = createServerFn({ method: "GET" }).handler(async () => {
  const view = await currentAttendeeAccountView();
  if (!view.account) throw accountLoginRedirect();
  return { account: view.account, emailStepUpRequired: view.emailStepUpRequired };
});
