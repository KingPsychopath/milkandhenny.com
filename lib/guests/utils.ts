import type { Guest } from './types';

/**
 * Collect all unique guest names from a guest list, including plus-ones.
 * Returns sorted names for stable output.
 */
export function getAllGuestNames(guests: Guest[]): string[] {
  const set = new Set<string>();

  for (const g of guests) {
    if (g?.name) set.add(g.name);
    for (const p of g.plusOnes ?? []) {
      if (p?.name) set.add(p.name);
    }
  }

  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

