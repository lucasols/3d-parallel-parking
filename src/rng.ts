export type Rng = () => number;

/** Mulberry32 — small, fast, deterministic PRNG. */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function range(rng: Rng, min: number, max: number): number {
  return min + (max - min) * rng();
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  const item = items[Math.floor(rng() * items.length)];
  if (item === undefined) throw new Error('Cannot pick from an empty list');
  return item;
}

export interface Weighted<T> {
  readonly item: T;
  readonly weight: number;
}

export function weightedPick<T>(rng: Rng, items: readonly Weighted<T>[]): T {
  const total = items.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = rng() * total;
  for (const entry of items) {
    roll -= entry.weight;
    if (roll <= 0) return entry.item;
  }
  const last = items[items.length - 1];
  if (last === undefined) throw new Error('Cannot pick from an empty list');
  return last.item;
}
