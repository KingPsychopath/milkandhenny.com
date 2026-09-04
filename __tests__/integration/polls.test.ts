import { raceLockedWrite } from "../helpers/locked-write";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import { getPublicPoll, listPolls, savePoll, submitPollVote } from "@/features/polls/polls.server";
import { applySchema, closeDatabase, describeWithDatabase, truncateAll } from "../helpers/postgres";

describeWithDatabase("polls (postgres)", () => {
  beforeAll(applySchema);
  afterAll(closeDatabase);
  beforeEach(truncateAll);

  async function createPoll(resultVisibility: "always" | "after_vote" | "hidden" = "after_vote") {
    return savePoll({
      slug: "best-evening",
      title: "Choose an evening",
      intro: "Help us choose.",
      question: "Which works best?",
      options: [
        { id: "tuesday", label: "Tuesday" },
        { id: "wednesday", label: "Wednesday" },
      ],
      selectionMode: "single",
      resultVisibility,
      showPercentages: false,
      status: "open",
    });
  }

  it("rejects a ballot if the poll closes while submission waits for its lock", async () => {
    const poll = await createPoll();
    const result = await raceLockedWrite(
      "select id from polls where id=$1 for update",
      [poll.id],
      () =>
        submitPollVote({
          slug: poll.slug,
          voterId: "visitor_race_identifier_1",
          selections: ["tuesday"],
        }),
      "update polls set status='closed' where id=$1",
    );
    expect(result.status).toBe("rejected");
    expect((await listPolls())[0]?.responseCount).toBe(0);
  });

  it("should reveal weighted results after a vote without counting a device twice", async () => {
    await createPoll();
    const first = await submitPollVote({
      slug: "best-evening",
      voterId: "visitor_device_identifier_1",
      selections: ["tuesday"],
    });
    expect(first.results?.find((result) => result.id === "tuesday")).toMatchObject({
      votes: 1,
      weight: 1,
    });

    const updated = await submitPollVote({
      slug: "best-evening",
      voterId: "visitor_device_identifier_1",
      selections: ["wednesday"],
    });
    expect(updated.poll.responseCount).toBe(1);
    expect(updated.results?.find((result) => result.id === "tuesday")?.votes).toBe(0);
    expect(updated.results?.find((result) => result.id === "wednesday")?.votes).toBe(1);
  });

  it("should honour public visibility while retaining exact admin totals", async () => {
    await createPoll("hidden");
    const publicBefore = await getPublicPoll("best-evening");
    expect(publicBefore?.results).toBeNull();
    const vote = await submitPollVote({
      slug: "best-evening",
      voterId: "visitor_device_identifier_2",
      selections: ["tuesday"],
    });
    expect(vote.results).toBeNull();
    expect((await listPolls())[0]?.results[0]?.votes).toBe(1);
  });

  it("should keep ballot meaning stable once voting begins", async () => {
    const poll = await createPoll();
    await submitPollVote({
      slug: poll.slug,
      voterId: "visitor_device_identifier_3",
      selections: ["tuesday"],
    });
    await expect(
      savePoll({
        ...poll,
        options: [
          { id: "friday", label: "Friday" },
          { id: "saturday", label: "Saturday" },
        ],
      }),
    ).rejects.toThrow("Choices cannot change after voting begins");
  });
});
