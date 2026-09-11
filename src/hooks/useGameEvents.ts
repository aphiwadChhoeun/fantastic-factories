"use client";

import { useEffect, useRef } from "react";
import type { GameState } from "@/engine";
import { diffDeals, type Deal, type GameEvent } from "@/lib/events";

/**
 * Turns a sequence of boards into a sequence of things that happened.
 *
 * The work itself is in `lib/events.ts`; this only remembers the last board and
 * runs after paint. After, deliberately: by then the DOM has already moved, so
 * a listener that wants to know *where* something is — to emit sparks off it,
 * or to fly a card at it — can measure rather than guess.
 *
 * `onEvent` is called once per event and must be stable, or this re-subscribes
 * on every render.
 */
export function useGameEvents(
  state: GameState,
  /** Which deal this board belongs to. A reset is not a move — see `diffDeals`. */
  seed: number,
  onEvent: (event: GameEvent) => void,
): void {
  const previous = useRef<Deal>({ seed, state });

  useEffect(() => {
    const before = previous.current;
    previous.current = { seed, state };
    // Strict Mode runs this twice on mount. The second pass compares the board
    // with itself and finds nothing, so the double is harmless.
    for (const event of diffDeals(before, { seed, state })) onEvent(event);
  }, [state, seed, onEvent]);
}
