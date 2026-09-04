import { createHash, randomUUID } from "node:crypto";

import { query, transaction } from "@/lib/platform/postgres.server";
import { reserveRateLimit } from "@/lib/platform/rate-limit.server";
import {
  buildPollResults,
  normaliseOptionId,
  normalisePollOptions,
  validateSelections,
} from "./poll-results";
import {
  POLL_RESULT_VISIBILITIES,
  POLL_SELECTION_MODES,
  POLL_STATUSES,
  type AdminPoll,
  type PollRecord,
  type PollResult,
  type PollVoteResult,
  type PublicPoll,
} from "./types";

const POLL_SUBMISSION_LIMIT_PER_NETWORK = 300;
const POLL_SUBMISSION_GLOBAL_LIMIT = 10_000;
const POLL_SUBMISSION_WINDOW_SECONDS = 60 * 60;

function normaliseSlug(value: string): string {
  return normaliseOptionId(value).slice(0, 80);
}

function asIso(value: Date | string): string {
  return new Date(value).toISOString();
}

function fromRow(row: Record<string, unknown>): PollRecord {
  return {
    id: String(row.id),
    slug: String(row.slug),
    eventSlug: typeof row.event_slug === "string" ? row.event_slug : null,
    title: String(row.title),
    intro: String(row.intro ?? ""),
    question: String(row.question),
    options: normalisePollOptions(row.options),
    selectionMode: POLL_SELECTION_MODES.includes(row.selection_mode as PollRecord["selectionMode"])
      ? (row.selection_mode as PollRecord["selectionMode"])
      : "single",
    resultVisibility: POLL_RESULT_VISIBILITIES.includes(
      row.result_visibility as PollRecord["resultVisibility"],
    )
      ? (row.result_visibility as PollRecord["resultVisibility"])
      : "after_vote",
    showPercentages: row.show_percentages === true,
    status: POLL_STATUSES.includes(row.status as PollRecord["status"])
      ? (row.status as PollRecord["status"])
      : "draft",
    responseCount: Number(row.response_count) || 0,
    createdAt: asIso(row.created_at as Date),
    updatedAt: asIso(row.updated_at as Date),
  };
}

async function resultsForPoll(poll: PollRecord): Promise<PollResult[]> {
  const rows = await query<{ option_id: string; votes: string | number }>(
    `select selection as option_id, count(*) as votes
       from poll_votes, unnest(selections) as selection
      where poll_id = $1
      group by selection`,
    [poll.id],
  );
  return buildPollResults(
    poll.options,
    Object.fromEntries(rows.map((row) => [row.option_id, Number(row.votes) || 0])),
    poll.responseCount,
  );
}

export async function reservePollSubmission(slug: string, sourceIp: string) {
  const decision = await reserveRateLimit({
    name: "poll-submit",
    identity: `${normaliseSlug(slug) || "unknown"}:${sourceIp || "unknown"}`,
    limit: POLL_SUBMISSION_LIMIT_PER_NETWORK,
    windowSeconds: POLL_SUBMISSION_WINDOW_SECONDS,
    globalLimit: POLL_SUBMISSION_GLOBAL_LIMIT,
  });
  return { allowed: decision.allowed, retryAfterSeconds: decision.retryAfterSeconds };
}

export async function listPolls(): Promise<AdminPoll[]> {
  const rows = await query<Record<string, unknown>>(
    `select id, slug, event_slug, title, intro, question, options, selection_mode,
            result_visibility, show_percentages, status, response_count, created_at, updated_at
       from polls where status <> 'archived' order by updated_at desc`,
  );
  return Promise.all(
    rows.map(async (row) => {
      const poll = fromRow(row);
      return { ...poll, results: await resultsForPoll(poll) };
    }),
  );
}

export async function getPoll(slug: string, includeDraft = false): Promise<PollRecord | null> {
  const rows = await query<Record<string, unknown>>(
    `select id, slug, event_slug, title, intro, question, options, selection_mode,
            result_visibility, show_percentages, status, response_count, created_at, updated_at
       from polls
      where slug = $1 and ($2 or status in ('open','closed')) limit 1`,
    [normaliseSlug(slug), includeDraft],
  );
  return rows[0] ? fromRow(rows[0]) : null;
}

export async function getPublicPoll(slug: string): Promise<PublicPoll | null> {
  const poll = await getPoll(slug);
  if (!poll) return null;
  return {
    ...poll,
    results: poll.resultVisibility === "always" ? await resultsForPoll(poll) : null,
  };
}

export async function getPollVote(input: {
  slug: string;
  voterId: string;
}): Promise<PollVoteResult | null> {
  const voterId = input.voterId.trim();
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(voterId)) return null;
  const poll = await getPoll(input.slug);
  if (!poll) return null;
  const voterHash = createHash("sha256").update(voterId).digest("hex");
  const rows = await query<{ selections: string[] }>(
    `select selections from poll_votes where poll_id=$1 and voter_hash=$2 limit 1`,
    [poll.id, voterHash],
  );
  if (!rows[0]) return null;
  return {
    poll,
    selections: rows[0].selections,
    results: poll.resultVisibility === "hidden" ? null : await resultsForPoll(poll),
  };
}

export async function savePoll(input: {
  id?: string;
  slug: string;
  eventSlug?: string | null;
  title: string;
  intro: string;
  question: string;
  options: unknown;
  selectionMode: PollRecord["selectionMode"];
  resultVisibility: PollRecord["resultVisibility"];
  showPercentages: boolean;
  status: PollRecord["status"];
}): Promise<AdminPoll> {
  const slug = normaliseSlug(input.slug);
  const title = input.title.trim().slice(0, 160);
  const intro = input.intro.trim().slice(0, 2000);
  const question = input.question.trim().slice(0, 240);
  const options = normalisePollOptions(input.options);
  if (!slug || !title || !question || options.length < 2) {
    throw new Error("Add a title, question, and at least two distinct choices");
  }
  const id = input.id || randomUUID();
  if (input.id) {
    const existingRows = await query<Record<string, unknown>>(
      `select id, slug, event_slug, title, intro, question, options, selection_mode,
              result_visibility, show_percentages, status, response_count, created_at, updated_at
         from polls where id=$1 limit 1`,
      [input.id],
    );
    const existing = existingRows[0] ? fromRow(existingRows[0]) : null;
    const choicesChanged =
      existing &&
      (existing.selectionMode !== input.selectionMode ||
        existing.options.map((option) => option.id).join("\n") !==
          options.map((option) => option.id).join("\n"));
    if (existing && existing.responseCount > 0 && choicesChanged) {
      throw new Error(
        "Choices cannot change after voting begins. Close this poll and create another.",
      );
    }
  }
  await query(
    `insert into polls
       (id, slug, event_slug, title, intro, question, options, selection_mode,
        result_visibility, show_percentages, status)
     values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11)
     on conflict (id) do update set
       slug=excluded.slug, event_slug=excluded.event_slug, title=excluded.title,
       intro=excluded.intro, question=excluded.question, options=excluded.options,
       selection_mode=excluded.selection_mode, result_visibility=excluded.result_visibility,
       show_percentages=excluded.show_percentages, status=excluded.status, updated_at=now()`,
    [
      id,
      slug,
      input.eventSlug || null,
      title,
      intro,
      question,
      JSON.stringify(options),
      input.selectionMode,
      input.resultVisibility,
      input.showPercentages,
      input.status,
    ],
  );
  const poll = await getPoll(slug, true);
  if (!poll) throw new Error("Poll was not saved");
  return { ...poll, results: await resultsForPoll(poll) };
}

export async function submitPollVote(input: {
  slug: string;
  voterId: string;
  selections: unknown;
}): Promise<PollVoteResult> {
  const voterId = input.voterId.trim();
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(voterId)) throw new Error("Refresh the page and try again");
  const poll = await getPoll(input.slug);
  if (!poll || poll.status !== "open") throw new Error("This poll is not open");
  const selections = validateSelections(poll.options, poll.selectionMode, input.selections);
  const voterHash = createHash("sha256").update(voterId).digest("hex");
  await transaction(async (client) => {
    const result = await client.query(
      `insert into poll_votes (id, poll_id, voter_hash, selections)
       values ($1,$2,$3,$4)
       on conflict (poll_id, voter_hash) do update set selections=excluded.selections, updated_at=now()
       returning (xmax = 0) as inserted`,
      [randomUUID(), poll.id, voterHash, selections],
    );
    if (result.rows[0]?.inserted) {
      await client.query(
        `update polls set response_count=response_count+1, updated_at=now() where id=$1`,
        [poll.id],
      );
    }
  });
  const updated = await getPoll(poll.slug);
  if (!updated) throw new Error("This poll is not available");
  return {
    poll: updated,
    selections,
    results: updated.resultVisibility === "hidden" ? null : await resultsForPoll(updated),
  };
}
