import { randomUUID } from "node:crypto";

import { log } from "@/lib/platform/logger.server";
import { query, transaction } from "@/lib/platform/postgres.server";
import type { OfficialGameResultEnvelope } from "./types";

const CLAIM_SECONDS = 300;

interface ClaimedResult {
  channel_id: string;
  result_id: string;
  revision: number;
  envelope: OfficialGameResultEnvelope;
  claim_token: string;
}

/** A claim is short lived; a crashed consumer leaves the result eligible for another process. */
export async function claimPostgresOfficialResults(limit = 50): Promise<ClaimedResult[]> {
  const bounded = Math.max(1, Math.min(200, Math.trunc(limit)));
  const claimToken = randomUUID();
  return transaction(async (client) => {
    const selected = await client.query<ClaimedResult>(
      `with selected as (
         select channel_id,result_id,revision
           from multiplayer_game_result_outbox
          where status='pending'
            and next_attempt_at<=clock_timestamp()
            and (claim_until is null or claim_until<=clock_timestamp())
          order by next_attempt_at,created_at,channel_id,result_id,revision
          limit $1 for update skip locked
       )
       update multiplayer_game_result_outbox as o
          set claim_token=$2::uuid,
              claim_until=clock_timestamp()+($3::integer * interval '1 second'),
              attempt_count=o.attempt_count+1
         from selected as s
        where o.channel_id=s.channel_id and o.result_id=s.result_id and o.revision=s.revision
       returning o.channel_id,o.result_id,o.revision,o.envelope,o.claim_token::text`,
      [bounded, claimToken, CLAIM_SECONDS],
    );
    return selected.rows;
  });
}

export async function finishPostgresOfficialResult(
  item: ClaimedResult,
  delivered: boolean,
): Promise<boolean> {
  const rows = await query<{ result_id: string }>(
    `update multiplayer_game_result_outbox
        set status=case when $5 then 'delivered' else 'pending' end,
            delivered_at=case when $5 then clock_timestamp() else null end,
            claim_token=null,
            claim_until=null,
            next_attempt_at=case when $5 then next_attempt_at
              else clock_timestamp()+((least(attempt_count,6)*10)::integer * interval '1 second') end
      where channel_id=$1 and result_id=$2 and revision=$3
        and status='pending' and claim_token=$4::uuid
      returning result_id`,
    [item.channel_id, item.result_id, item.revision, item.claim_token, delivered],
  );
  return rows.length === 1;
}

export async function drainPostgresOfficialResults(
  consumer: (envelope: OfficialGameResultEnvelope) => Promise<boolean>,
  limit = 50,
): Promise<{ selected: number; delivered: number }> {
  const selected = await claimPostgresOfficialResults(limit);
  let delivered = 0;
  for (const item of selected) {
    let consumed = false;
    try {
      consumed = await consumer(item.envelope);
    } catch (error) {
      log.error(
        "game-results.outbox",
        "Official result delivery failed",
        {
          channelId: item.channel_id,
          resultId: item.result_id,
          revision: item.revision,
        },
        error,
      );
    } finally {
      if ((await finishPostgresOfficialResult(item, consumed)) && consumed) delivered += 1;
    }
  }
  return { selected: selected.length, delivered };
}
