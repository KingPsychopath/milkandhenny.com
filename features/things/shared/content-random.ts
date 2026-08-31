/**
 * Fisher–Yates with browser/Node cryptographic entropy when available. Content order is not a
 * security boundary, but using the platform RNG avoids repeated pseudo-random runs after reloads.
 */
export function shuffledCopy<T>(items: readonly T[]): T[] {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = randomIndex(index + 1);
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

export function freshFirst<T>(
  items: readonly T[],
  recentIds: readonly string[],
  id: (item: T) => string,
): T[] {
  const recent = new Set(recentIds);
  const unseen = shuffledCopy(items.filter((item) => !recent.has(id(item))));
  const byId = new Map(items.map((item) => [id(item), item]));
  const oldestSeen = recentIds.flatMap((itemId) => {
    const item = byId.get(itemId);
    return item === undefined ? [] : [item];
  });
  const recorded = new Set(oldestSeen.map(id));
  const remainingSeen = shuffledCopy(
    items.filter((item) => recent.has(id(item)) && !recorded.has(id(item))),
  );
  return [...unseen, ...oldestSeen, ...remainingSeen];
}

function randomIndex(bound: number): number {
  if (bound <= 1) return 0;
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues) return Math.floor(Math.random() * bound);
  const range = 0x1_0000_0000;
  const limit = range - (range % bound);
  const sample = new Uint32Array(1);
  do cryptoApi.getRandomValues(sample);
  while ((sample[0] ?? 0) >= limit);
  return (sample[0] ?? 0) % bound;
}
