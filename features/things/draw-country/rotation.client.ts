import { COUNTRIES } from "./countries";

const STORAGE_KEY = "things:draw-country:v1:history";
const HISTORY_LIMIT = 36;

function readHistory() {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === "string").slice(-HISTORY_LIMIT)
      : [];
  } catch {
    return [];
  }
}

export function rememberCountry(countryId: string) {
  const history = readHistory().filter((id) => id !== countryId);
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...history, countryId].slice(-HISTORY_LIMIT)));
}

export function recentCountryIds() {
  return readHistory();
}

export function nextSoloCountry() {
  const history = readHistory();
  const cooldown = new Set(history.slice(-24));
  const last = COUNTRIES.find(({ id }) => id === history.at(-1));
  const candidates = COUNTRIES.filter(({ id }) => !cooldown.has(id));
  const varied = candidates.filter(({ continent }) => continent !== last?.continent);
  const pool = varied.length > 24 ? varied : candidates.length ? candidates : COUNTRIES;
  return pool[Math.floor(Math.random() * pool.length)] ?? COUNTRIES[0];
}
