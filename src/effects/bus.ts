/**
 * The one channel between the board and the particles.
 *
 * A module singleton rather than context, and deliberately one-way. The board
 * says "sparks, here, this colour" and forgets about it; nothing about a burst
 * is state, nothing can be queried, and the emitter has no idea whether anyone
 * is listening. That is what lets the whole canvas be lazy-loaded, switched
 * off by a flag, or absent under reduced motion without a single call site
 * knowing.
 *
 * There is no buffering on purpose. A burst emitted before the canvas has
 * loaded is dropped, because the alternative — replaying it on arrival — means
 * the first frame after the chunk lands spits out every spark the game has
 * owed since the page opened.
 */

/** Sparks off something, in viewport pixels. */
export type Burst = {
  readonly x: number;
  readonly y: number;
  /** How many. Defaults to a modest handful. */
  readonly count?: number;
  /** Any CSS colour three can parse. Defaults to hot metal. */
  readonly color?: string;
  /** Radians either side of straight up. */
  readonly spread?: number;
  /** Pixels per second, before drag. */
  readonly speed?: number;
};

export type BurstListener = (burst: Burst) => void;

const listeners = new Set<BurstListener>();

/** Listen. Returns the unsubscribe, so it drops straight out of an effect. */
export function onBurst(listener: BurstListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Throw some sparks. Does nothing at all if nothing is listening. */
export function emitBurst(burst: Burst): void {
  // Copied, so a listener that unsubscribes as it is called — a canvas
  // unmounting on the same tick — cannot disturb the rest of the delivery.
  for (const listener of [...listeners]) listener(burst);
}
