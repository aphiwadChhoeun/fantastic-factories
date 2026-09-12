"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Things set to go off later, and cancelled if the board goes away first.
 *
 * The landing sequence is three beats in a row — the die strikes the socket,
 * the charge runs up the card, the factory fires — and the engine resolves all
 * of it in one synchronous move. So the board has to hold the last two back and
 * play them in time, which means timers, which means something has to own them:
 * a game abandoned mid-sequence must not come back to fire sparks off a card
 * that is no longer on the page. See docs/dice.md §3.
 */
export function useFuses(): (ms: number, light: () => void) => void {
  const burning = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const pending = burning.current;
    return () => {
      for (const fuse of pending) clearTimeout(fuse);
      pending.clear();
    };
  }, []);

  return useCallback((ms: number, light: () => void) => {
    // Nothing to wait for. Straight through rather than through a zero-delay
    // timer, so a sequence that has been turned off is not one tick late.
    if (ms <= 0) {
      light();
      return;
    }

    const fuse = setTimeout(() => {
      burning.current.delete(fuse);
      light();
    }, ms);
    burning.current.add(fuse);
  }, []);
}
