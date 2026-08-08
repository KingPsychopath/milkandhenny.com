import { readCountryOutlineFn, selectSoloCountryFn } from "./draw-country-room.functions";
import { recentCountryIds } from "./rotation-history.client";
import type { CountryOutline } from "./types";
export { rememberCountry } from "./rotation-history.client";

const countries = new Map<string, CountryOutline>();
let offlineAtlas: Promise<CountryOutline[]> | null = null;

export function primeCountry(country: CountryOutline) {
  countries.set(country.id, country);
}

async function loadOfflineAtlas() {
  offlineAtlas ??= fetch("/assets/draw-country-atlas-v1.json").then(async (response) => {
    if (!response.ok) throw new Error("The offline atlas is unavailable");
    return (await response.json()) as CountryOutline[];
  });
  return offlineAtlas;
}

function selectFromAtlas(atlas: CountryOutline[], history = recentCountryIds()) {
  const cooldown = new Set(history.slice(-24));
  const last = atlas.find(({ id }) => id === history.at(-1));
  const candidates = atlas.filter(({ id }) => !cooldown.has(id));
  const varied = candidates.filter(({ continent }) => continent !== last?.continent);
  const pool = varied.length > 24 ? varied : candidates.length ? candidates : atlas;
  return pool[Math.floor(Math.random() * pool.length)] ?? atlas[0];
}

export async function nextSoloCountry(currentCountryId?: string) {
  const history = recentCountryIds();
  if (currentCountryId && !history.includes(currentCountryId)) history.push(currentCountryId);
  try {
    const country = await selectSoloCountryFn({ data: { recentCountryIds: history } });
    primeCountry(country);
    return country;
  } catch {
    const country = selectFromAtlas(await loadOfflineAtlas(), history);
    primeCountry(country);
    return country;
  }
}

export async function loadCountryOutline(countryId: string) {
  const cached = countries.get(countryId);
  if (cached) return cached;
  try {
    const country = await readCountryOutlineFn({ data: { countryId } });
    primeCountry(country);
    return country;
  } catch {
    const country = (await loadOfflineAtlas()).find(({ id }) => id === countryId);
    if (!country) throw new Error("Country not found");
    primeCountry(country);
    return country;
  }
}
