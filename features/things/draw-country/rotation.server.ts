import { randomInt } from "node:crypto";
import { COUNTRIES, countryById } from "./countries";

function shuffle<T>(items: T[]) {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swap = randomInt(index + 1);
    [items[index], items[swap]] = [items[swap], items[index]];
  }
  return items;
}

export function selectRoomCountries(total: number, recentIds: string[]) {
  const recent = new Set(recentIds.slice(-36));
  const fresh = shuffle(COUNTRIES.filter(({ id }) => !recent.has(id)));
  const fallback = shuffle(COUNTRIES.filter(({ id }) => recent.has(id)));
  const pool = [...fresh, ...fallback];
  const selected: string[] = [];
  let lastContinent = "";
  while (selected.length < total && pool.length) {
    let index = pool.findIndex(({ continent }) => continent !== lastContinent);
    if (index < 0) index = 0;
    const [country] = pool.splice(index, 1);
    selected.push(country.id);
    lastContinent = country.continent;
  }
  return selected;
}

export function selectSoloCountry(recentIds: string[]) {
  const history = recentIds.slice(-24);
  const cooldown = new Set(history);
  const last = countryById(history.at(-1) ?? "");
  const candidates = COUNTRIES.filter(({ id }) => !cooldown.has(id));
  const varied = candidates.filter(({ continent }) => continent !== last?.continent);
  const pool = varied.length > 24 ? varied : candidates.length ? candidates : COUNTRIES;
  return pool[randomInt(pool.length)] ?? COUNTRIES[0];
}
