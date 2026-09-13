/**
 * The one channel between the board and the simulated dice.
 *
 * Modelled on `effects/bus.ts` and for the same reason: a module singleton,
 * fire-and-forget, so that the whole canvas can be lazy-loaded, switched off by
 * a flag, or absent under reduced motion without a single call site knowing.
 *
 * Two directions rather than one, which is the difference. The board asks for
 * a roll and the canvas answers with where each die came to rest, because the
 * DOM dice have to take over from exactly there — see docs/dice.md §2.1. If
 * nothing is listening, the ask is dropped and the board falls back to the
 * keyframed throw, which is the same outcome by a shorter road.
 */

import type { DieColor, DieFace } from "@/engine";

/** One die to throw: what it is, and the number it already owes. */
export type Rolling = {
  readonly id: string;
  readonly face: DieFace;
  readonly color: DieColor;
};

export type RollRequest = {
  readonly dice: readonly Rolling[];
  /**
   * Where on the screen to roll them, in viewport pixels — the panel the tray
   * belongs to. The canvas covers this and nothing else, so dice cannot go
   * skittering across the market.
   */
  readonly within: { readonly left: number; readonly top: number; readonly width: number; readonly height: number };
};

/** Where a die stopped, in viewport pixels. */
export type Landing = { readonly id: string; readonly x: number; readonly y: number };

type RollListener = (request: RollRequest) => void;
type LandListener = (landing: Landing) => void;

const rollers = new Set<RollListener>();
const landers = new Set<LandListener>();

/** Listen for rolls. Returns the unsubscribe, so it drops out of an effect. */
export function onRoll(listener: RollListener): () => void {
  rollers.add(listener);
  return () => {
    rollers.delete(listener);
  };
}

/**
 * Throw these. Returns whether anything was listening — the one place this bus
 * answers back, because the board has to know whether to throw them itself.
 */
export function emitRoll(request: RollRequest): boolean {
  if (rollers.size === 0) return false;
  for (const listener of [...rollers]) listener(request);
  return true;
}

/** Listen for dice coming to rest. */
export function onLand(listener: LandListener): () => void {
  landers.add(listener);
  return () => {
    landers.delete(listener);
  };
}

/** A die has stopped, here. */
export function emitLand(landing: Landing): void {
  for (const listener of [...landers]) listener(landing);
}
