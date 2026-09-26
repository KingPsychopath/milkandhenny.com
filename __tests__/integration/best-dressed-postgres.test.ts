import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

import {
  clearPostgresBestDressed,
  cleanupPostgresBestDressed,
  getPostgresVotingWindow,
  issuePostgresVoteToken,
  mintPostgresBestDressedCodes,
  postgresVoteCodeExists,
  postgresVoteTokenExists,
  readPostgresVotingState,
  revokePostgresBestDressedCodes,
  setPostgresVotingWindow,
  votePostgresBestDressed,
} from "@/features/best-dressed/best-dressed-postgres.server";
import { query } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase } from "../helpers/postgres";

describeWithDatabase("Postgres Best Dressed", () => {
  beforeAll(async () => {
    vi.stubEnv("AUTH_SECRET", "integration-test-voting-secret-at-least-32-characters");
    await applySchema();
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await closeDatabase();
  });
  beforeEach(async () => {
    await query(
      "truncate best_dressed_codes, best_dressed_tokens, best_dressed_voters, best_dressed_totals",
    );
    await query(
      "update best_dressed_state set session = 'initial', open_until = null, source_rdb_sha256 = null, runtime_revision = 0",
    );
  });

  const eligible = new Set(["Ada", "Bea"]);

  it("accepts one ballot per voter and increments the tally only once under concurrency", async () => {
    await setPostgresVotingWindow(10);
    const tokens = await Promise.all([issuePostgresVoteToken(), issuePostgresVoteToken()]);
    const votes = await Promise.all([
      votePostgresBestDressed({ name: "Ada", voteToken: tokens[0] }, "voter-alpha", eligible),
      votePostgresBestDressed({ name: "Bea", voteToken: tokens[1] }, "voter-alpha", eligible),
    ]);
    expect(votes.filter((result) => result.ok)).toHaveLength(1);
    expect(votes.filter((result) => !result.ok && result.status === 409)).toHaveLength(1);
    const state = await readPostgresVotingState();
    expect(state.totalVotes).toBe(1);
    expect(state.leaderboard).toHaveLength(1);
    expect((await getPostgresVotingWindow()).isOpen).toBe(true);
  });

  it("consumes a one-time code and token together with the accepted ballot", async () => {
    const minted = await mintPostgresBestDressedCodes({ count: 1, words: 2 });
    if (!minted.ok) throw new Error("Expected a voting code");
    const code = minted.codes[0];
    const tokens = await Promise.all([issuePostgresVoteToken(), issuePostgresVoteToken()]);
    const votes = await Promise.all([
      votePostgresBestDressed({ name: "Ada", voteToken: tokens[0], code }, "voter-alpha", eligible),
      votePostgresBestDressed({ name: "Bea", voteToken: tokens[1], code }, "voter-beta", eligible),
    ]);
    expect(votes.filter((result) => result.ok)).toHaveLength(1);
    expect(votes.filter((result) => !result.ok && result.status === 403)).toHaveLength(1);
    expect(await postgresVoteCodeExists(code)).toBe(false);
    expect((await readPostgresVotingState()).totalVotes).toBe(1);
    const losingToken = votes[0].ok ? tokens[1] : tokens[0];
    expect(await postgresVoteTokenExists(losingToken)).toBe(true);
  });

  it("uses imported totals as a baseline without inventing ballots and clears a round", async () => {
    await query(
      "insert into best_dressed_totals (session, candidate_name, vote_count) values ('initial', 'Ada', 7)",
    );
    await setPostgresVotingWindow(5);
    const token = await issuePostgresVoteToken();
    const accepted = await votePostgresBestDressed(
      { name: "Ada", voteToken: token },
      "new-voter",
      eligible,
    );
    expect(accepted.ok).toBe(true);
    expect((await readPostgresVotingState()).totalVotes).toBe(8);
    const reset = await clearPostgresBestDressed();
    expect(reset.session).not.toBe("initial");
    expect((await readPostgresVotingState()).totalVotes).toBe(0);
    expect((await getPostgresVotingWindow()).isOpen).toBe(true);
  });

  it("revokes issued codes and hides expired credentials", async () => {
    const minted = await mintPostgresBestDressedCodes({ count: 2, words: 2 });
    if (!minted.ok) throw new Error("Expected voting codes");
    expect((await revokePostgresBestDressedCodes()).deleted).toBe(2);
    expect(await postgresVoteCodeExists(minted.codes[0])).toBe(false);
    const token = await issuePostgresVoteToken();
    await query("update best_dressed_tokens set expires_at = now() - interval '1 second'");
    expect(await postgresVoteTokenExists(token)).toBe(false);
    expect((await cleanupPostgresBestDressed()).tokens).toBe(1);
  });
});
