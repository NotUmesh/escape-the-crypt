/**
 * Seeded, deterministic ordering for what a learner sees. No random source: the same items and
 * seed always give the same order, so a remounted panel shows the same list.
 */
function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
function nextRandom(state: { value: number }): number {
  state.value = (state.value + 0x6d2b79f5) >>> 0;
  let t = state.value;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
/** Seeded Fisher-Yates. Always a permutation of `items`. */
export function displayOrder<T>(items: readonly T[], seed: string): readonly T[] {
  const out = [...items];
  const state = { value: hashSeed(seed) };
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(nextRandom(state) * (i + 1));
    const a = out[i];
    const b = out[j];
    if (a === undefined || b === undefined) continue;
    out[i] = b;
    out[j] = a;
  }
  return out;
}
/**
 * Like `displayOrder`, but retries with the seed suffixes `:1` to `:5` while `avoid` rejects
 * the candidate, then rotates the list by one. If even that is rejected (for example a list of
 * one item) the last candidate is returned.
 */
export function displayOrderAvoiding<T>(
  items: readonly T[],
  seed: string,
  avoid: (candidate: readonly T[]) => boolean,
): readonly T[] {
  const first = displayOrder(items, seed);
  if (!avoid(first)) return first;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const candidate = displayOrder(items, `${seed}:${attempt}`);
    if (!avoid(candidate)) return candidate;
  }
  if (items.length < 2) return first;
  const rotated = [...items.slice(1), ...items.slice(0, 1)];
  return rotated;
}
