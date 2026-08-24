import { queryOne } from "@/lib/platform/postgres.server";
import { listEvents } from "@/features/events/store.server";
import {
  defaultFooterPartyPath,
  parseFooterPartyPath,
  type FooterPartyPathResult,
} from "./site-navigation";

type SiteSettingsRow = {
  footer_party_path: string | null;
};

export type FooterPartySettings = {
  footerPartyPath: string | null;
  effectivePartyPath: string;
};

async function readConfiguredFooterPartyPath(): Promise<string | null> {
  const row = await queryOne<SiteSettingsRow>(
    "select footer_party_path from site_settings where singleton = true",
  );
  const parsed = parseFooterPartyPath(row?.footer_party_path ?? null);
  return parsed.ok ? parsed.path : null;
}

export async function getFooterPartySettings(): Promise<FooterPartySettings> {
  const [configuredPath, events] = await Promise.all([
    readConfiguredFooterPartyPath(),
    listEvents({ limit: 200 }),
  ]);
  return {
    footerPartyPath: configuredPath,
    effectivePartyPath: configuredPath ?? defaultFooterPartyPath(events),
  };
}

export async function setFooterPartyPath(
  value: unknown,
): Promise<
  { ok: true; settings: FooterPartySettings } | { ok: false; status: 400; error: string }
> {
  const parsed: FooterPartyPathResult = parseFooterPartyPath(value);
  if (!parsed.ok) return { ok: false, status: 400, error: parsed.error };

  await queryOne<SiteSettingsRow>(
    `insert into site_settings (singleton, footer_party_path, updated_at)
       values (true, $1, now())
       on conflict (singleton) do update
         set footer_party_path = excluded.footer_party_path, updated_at = now()
       returning footer_party_path`,
    [parsed.path],
  );

  return { ok: true, settings: await getFooterPartySettings() };
}

/** Public pages use the automatic event destination and fail open to the game. */
export async function getFooterPartyPath(): Promise<string> {
  try {
    return (await getFooterPartySettings()).effectivePartyPath;
  } catch {
    return defaultFooterPartyPath([]);
  }
}
