"use client";

import { useSyncExternalStore } from "react";

/**
 * A phone turned on its side, written out exactly as `game.module.css` writes
 * it at the foot of the file.
 *
 * Two copies of one breakpoint is one more than anybody wants, and there is no
 * way to have a single copy: a media query cannot be read back out of a
 * stylesheet, and a custom property cannot be a query. So it is written twice
 * and said so here — the stylesheet's copy is the one with the reasoning
 * attached, and this one has to follow it.
 */
const SHORT_LANDSCAPE = "(orientation: landscape) and (max-height: 500px)";

function subscribe(onChange: () => void): () => void {
  const query = window.matchMedia(SHORT_LANDSCAPE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * Whether the board is in its sideways shape — which is the one shape where a
 * card face is too small to read, and so the one shape where tapping a card
 * opens it rather than playing it. See `CardZoom`.
 *
 * False through the prerender and the first client render, like `useMounted`:
 * the build has no viewport to measure. Nothing calls this before the board has
 * mounted, so the false is never painted.
 */
export function useShortLandscape(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(SHORT_LANDSCAPE).matches,
    () => false,
  );
}
