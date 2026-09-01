import { expect, test } from "@playwright/test";
import { Pool } from "pg";

const databaseUrl =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres:test@127.0.0.1:55432/mah_test";

test("an official game result awards, corrects, and cancels attendee points live", async ({
  page,
}) => {
  test.setTimeout(120_000);
  process.env.DATABASE_URL = databaseUrl;
  process.env.AUTH_SECRET ??= "playwright-auth-secret-at-least-thirty-two-characters";
  const suffix = Date.now().toString(36);
  const eventSlug = `game-score-${suffix}`;
  const ticketId = `01CRZ3NDEK${safeSuffix()}`;
  const pool = new Pool({ connectionString: databaseUrl });
  const store = await import("@/features/event-scoring/store.server");
  const games = await import("@/features/event-scoring/games.server");
  const results = await import("@/features/game-results/outbox.server");

  await pool.query(
    `insert into events (slug,title,status,starts_at,timezone)
     values ($1,'Official result QA','published',now(),'Europe/London')`,
    [eventSlug],
  );
  await pool.query(
    `insert into ticket_types (event_slug,id,name,quantity)
     values ($1,'standard','Standard',2)`,
    [eventSlug],
  );
  await pool.query(
    `insert into tickets (id,event_slug,ticket_type_id,holder_name,order_id)
     values ($1,$2,'standard','Game guest',$3)`,
    [ticketId, eventSlug, `game-order-${suffix}`],
  );

  try {
    const participant = await store.participantForTicket(ticketId);
    const activity = await store.createActivity({
      eventSlug,
      name: "Centre finish",
      template: "winner",
      status: "live",
      rule: {
        mode: "placement",
        placementPoints: { "1": 7, "2": 3 },
        repeat: "once-per-source",
        requiresCheckIn: false,
      },
    });
    await store.getOrCreateSettings(eventSlug);
    await pool.query(`update event_scoring_settings set state = 'live' where event_slug = $1`, [
      eventSlug,
    ]);
    const binding = await games.createGameScoreBinding({
      eventSlug,
      activityId: activity.id,
      gameKind: "centre",
      acceptedScope: "game",
    });
    expect(binding.ok).toBe(true);
    if (!binding.ok || !participant) return;
    await pool.query(
      `update event_participants set checked_in_at = now()
        where id = $1 and event_slug = $2`,
      [participant.id, eventSlug],
    );
    await games.activateGameScoreBinding({
      channelId: binding.value.channelId,
      gameInstanceId: `centre-${suffix}`,
    });
    await games.linkGamePlayer({
      channelId: binding.value.channelId,
      gamePlayerId: "player-one",
      participantId: participant.id,
    });

    await page.goto(`/ticket/${ticketId}`);
    await page.getByRole("button", { name: "use this ticket for points" }).click();
    await expect(
      page.getByText("This device will use this ticket for event points."),
    ).toBeVisible();

    const process = async (revision: number, placement?: number, operation = "record") => {
      const envelope = results.sealOfficialGameResult({
        channelId: binding.value.channelId,
        revision,
        result: {
          gameKind: "centre",
          gameInstanceId: `centre-${suffix}`,
          resultId: "final",
          scope: "game",
          players:
            operation === "cancel"
              ? []
              : [
                  {
                    playerId: "player-one",
                    outcome: "completed",
                    placement,
                  },
                ],
        },
        operation: operation as "record" | "cancel",
      });
      const ingested = await games.ingestOfficialGameResult(envelope);
      expect(ingested.ok).toBe(true);
      if (ingested.ok) await games.processOfficialGameResult(ingested.value.id);
    };

    await process(1, 1);
    const eventScore = page.getByRole("region", { name: "event score" });
    await expect(
      eventScore.getByRole("status").filter({ hasText: "server confirmed" }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(eventScore.getByText("7 points", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await expect.poll(() => balance(pool, participant.id)).toBe(7);

    await process(2, 2);
    await expect.poll(() => balance(pool, participant.id)).toBe(3);

    await process(3, undefined, "cancel");
    await expect.poll(() => balance(pool, participant.id)).toBe(0);

    await process(4, 1);
    await expect.poll(() => balance(pool, participant.id)).toBe(7);
    const receipts = await pool.query<{ count: number }>(
      `select count(*)::integer as count from score_game_receipts receipts
        join official_game_results results on results.id = receipts.official_result_id
       where results.channel_id = $1 and results.result_id = 'final'`,
      [binding.value.channelId],
    );
    expect(receipts.rows[0]?.count).toBe(4);
  } finally {
    await pool.end();
  }
});

async function balance(pool: Pool, participantId: string) {
  const result = await pool.query<{ balance: number }>(
    `select balance::integer as balance from score_projections where participant_id = $1`,
    [participantId],
  );
  return result.rows[0]?.balance ?? 0;
}

function safeSuffix() {
  const alphabet = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
  let source = Date.now();
  let suffix = "";
  for (let index = 0; index < 6; index += 1) {
    suffix = `${alphabet[source % alphabet.length]}${suffix}`;
    source = Math.floor(source / alphabet.length);
  }
  return suffix;
}
