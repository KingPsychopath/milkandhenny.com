import { createHmac } from "node:crypto";

import { query, queryOne } from "@/lib/platform/postgres-provider-context.server";

export function postgresPasskeyCeremoniesSelected(): boolean {
  return process.env.PASSKEY_CEREMONY_STORE === "postgres";
}

function ceremonyHash(id: string): string {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret || secret.length < 32) throw new Error("Passkey ceremony secret unavailable");
  return createHmac("sha256", secret).update(`mah:passkey-ceremony:id:v1:${id}`).digest("hex");
}

export async function storePostgresPasskeyCeremony(id: string, value: unknown): Promise<boolean> {
  const rows = await query(
    `insert into attendee_passkey_ceremonies (id_hash, ceremony_data, expires_at)
       values ($1, $2::jsonb, clock_timestamp() + interval '5 minutes')
       on conflict (id_hash) do nothing returning id_hash`,
    [ceremonyHash(id), JSON.stringify(value)],
  );
  return rows.length === 1;
}

export async function takePostgresPasskeyCeremony(id: string): Promise<unknown> {
  const row = await queryOne<{ ceremony_data: unknown }>(
    `delete from attendee_passkey_ceremonies
      where id_hash = $1 and expires_at > clock_timestamp()
      returning ceremony_data`,
    [ceremonyHash(id)],
  );
  return row?.ceremony_data ?? null;
}

export async function cleanupPostgresPasskeyCeremonies(limit = 10_000): Promise<number> {
  if (!postgresPasskeyCeremoniesSelected()) return 0;
  const bounded = Math.max(1, Math.min(10_000, Math.floor(limit)));
  const rows = await query(
    `delete from attendee_passkey_ceremonies where ctid in (
       select ctid from attendee_passkey_ceremonies
        where expires_at < clock_timestamp()
        order by expires_at limit $1
     ) returning id_hash`,
    [bounded],
  );
  return rows.length;
}
