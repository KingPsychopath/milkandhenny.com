import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { getClientIp } from "@/features/auth/auth.server";
import { getPollVote, getPublicPoll, reservePollSubmission, submitPollVote } from "./polls.server";

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
