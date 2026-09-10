"use client";

import { useSyncExternalStore } from "react";

/** Nothing ever changes, so React never has to re-subscribe. */
const subscribe = () => () => {};

/**
 * False while the page is prerendered and through the first client render,
 * true from the second on.
 *
 * The saved game lives in `localStorage`, which the build-time render cannot
 * see — so the HTML shipped in `out/` and the browser's first render would
 * disagree about which game is on the board, and hydration would fail. Holding
 * the board back for a single render is what keeps them agreeing.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
