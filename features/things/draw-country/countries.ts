import generatedCountries from "./countries.generated.json";
import type { CountryOutline } from "./types";

export const COUNTRIES: CountryOutline[] = generatedCountries;
export const COUNTRY_BY_ID = new Map(COUNTRIES.map((country) => [country.id, country]));

export function countryById(id: string) {
  return COUNTRY_BY_ID.get(id) ?? null;
}
