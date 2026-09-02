/**
 * Seeded, purely functional PRNG (mulberry32).
 *
 * Every function takes an `Rng` and returns the next one alongside its value,
 * so randomness lives inside `GameState` like any other field. Same seed plus
 * same move sequence always reproduces the same game, which is what makes the
 * engine testable and replays possible.
 */

export type Rng = { readonly seed: number };

export function createRng(seed: number): Rng {
  return { seed: seed | 0 };
}

/** Uniform float in [0, 1). */
export function nextFloat(rng: Rng): [number, Rng] {
  const a = (rng.seed + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [value, { seed: a }];
}

/** Uniform integer in [0, maxExclusive). */
export function nextInt(rng: Rng, maxExclusive: number): [number, Rng] {
  if (maxExclusive <= 0) {
    throw new Error(`nextInt requires maxExclusive > 0, got ${maxExclusive}`);
  }
  const [value, next] = nextFloat(rng);
  return [Math.floor(value * maxExclusive), next];
}

/** Picks one element. Throws on an empty array — callers should guard. */
export function pick<T>(items: readonly T[], rng: Rng): [T, Rng] {
  if (items.length === 0) {
    throw new Error("pick called on an empty array");
  }
  const [index, next] = nextInt(rng, items.length);
  return [items[index], next];
}

/** Fisher-Yates. Returns a new array; the input is untouched. */
export function shuffle<T>(items: readonly T[], rng: Rng): [T[], Rng] {
  const result = [...items];
  let current = rng;
  for (let i = result.length - 1; i > 0; i--) {
    const [j, next] = nextInt(current, i + 1);
    current = next;
    [result[i], result[j]] = [result[j], result[i]];
  }
  return [result, current];
}
