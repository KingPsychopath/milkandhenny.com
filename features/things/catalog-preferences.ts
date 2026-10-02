import { THINGS } from "./catalog";
import type { Thing } from "./catalog";

const USAGE_KEY = "things:usage:v1";
export type ThingUsage = Partial<Record<Thing["slug"], number>>;
export type ThingFilter = "all" | "games" | "tools" | "solo" | "together" | "offline";
export type ThingSort = "used" | "name";

export function parseThingUsage(value: unknown): ThingUsage {
  const usage: ThingUsage = {};
  if (!value || typeof value !== "object") return usage;
  for (const { slug } of THINGS) {
    if (!(slug in value)) continue;
    const count = Reflect.get(value, slug);
    if (typeof count === "number" && Number.isSafeInteger(count) && count > 0)
      usage[slug] = Math.min(count, 100_000);
  }
  return usage;
}

export function readThingUsage(): ThingUsage {
  try {
    return parseThingUsage(JSON.parse(localStorage.getItem(USAGE_KEY) ?? "null"));
  } catch {
    return {};
  }
}

export function recordThingVisit(slug: Thing["slug"]): ThingUsage {
  const usage = readThingUsage();
  usage[slug] = Math.min((usage[slug] ?? 0) + 1, 100_000);
  try {
    localStorage.setItem(USAGE_KEY, JSON.stringify(usage));
  } catch {
    /* Sorting still works when this browser cannot save preferences. */
  }
  return usage;
}

export function selectThings(
  query: string,
  filter: ThingFilter,
  sort: ThingSort,
  usage: ThingUsage,
): Thing[] {
  const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return THINGS.filter((thing) => {
    if (filter === "games" || filter === "tools") {
      if (thing.category !== filter) return false;
    } else if (filter === "solo" && thing.minPlayers > 1) return false;
    else if (filter === "together" && thing.category !== "games") return false;
    else if (filter === "offline" && !thing.offline) return false;
    return tokens.every((token) =>
      `${thing.name} ${thing.description} ${thing.eyebrow} ${thing.category}`
        .toLowerCase()
        .includes(token),
    );
  }).sort((a, b) =>
    sort === "name" ? a.name.localeCompare(b.name) : (usage[b.slug] ?? 0) - (usage[a.slug] ?? 0),
  );
}
