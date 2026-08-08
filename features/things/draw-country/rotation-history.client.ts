const STORAGE_KEY = "things:draw-country:v1:history";
const HISTORY_LIMIT = 36;

export function recentCountryIds() {
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
  const history = recentCountryIds().filter((id) => id !== countryId);
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...history, countryId].slice(-HISTORY_LIMIT)));
}
