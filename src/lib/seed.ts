/**
 * Numbers that are the same every time, from a name.
 *
 * Animation needs variety — four dice thrown identically read as scripted
 * however good the throw is — and it must not need luck. `Math.random` in a
 * render is a throw that changes when anything else on the board moves, a
 * server and a browser that disagree about what they drew, and a test that
 * cannot say what it expects. Keyed off a die's id instead, a throw is a fact
 * about that die: the same one twice, and different from its neighbour's.
 *
 * Deliberately not the engine's generator. That one deals the game, and
 * advancing it to decide how something looks would put the board's appearance
 * inside the replay.
 */

/** FNV-1a, which is short, has no state to carry, and mixes well enough. */
export function seedOf(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/** Successive numbers in [0, 1) from that seed. */
export function spread(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0x100000000;
  };
}

/** Somewhere between the two, from the next number in the sequence. */
export function between(next: () => number, low: number, high: number): number {
  return low + next() * (high - low);
}

/** One or the other, evenly. */
export function either(next: () => number): 1 | -1 {
  return next() < 0.5 ? -1 : 1;
}
