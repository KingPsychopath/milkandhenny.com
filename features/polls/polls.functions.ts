import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { getAdminWorkspaceAccess, getClientIp } from "@/features/auth/auth.server";
import {
  getPollVote,
  getPublicPoll,
  listPolls,
  reservePollSubmission,
  submitPollVote,
} from "./polls.server";

export const getAdminPollsFn = createServerFn({ method: "GET" }).handler(async () => {
  const access = await getAdminWorkspaceAccess(getRequest());
  if (!access.ok || !access.permissions.manageCommunications)
    throw new Error("Communications access required");
  return listPolls();
});

export const getPublicPollFn = createServerFn({ method: "GET" })
  .validator((data: { slug: string }) => data)
  .handler(({ data }) => getPublicPoll(data.slug));

export const submitPollVoteFn = createServerFn({ method: "POST" })
  .validator((data: { slug: string; voterId: string; selections: string[] }) => data)
  .handler(async ({ data }) => {
    const limit = await reservePollSubmission(data.slug, getClientIp(getRequest()));
    if (!limit.allowed)
      throw new Error("Too many votes from this network. Try again in a little while.");
    return submitPollVote(data);
  });

export const getPollVoteFn = createServerFn({ method: "GET" })
  .validator((data: { slug: string; voterId: string }) => data)
  .handler(({ data }) => getPollVote(data));
