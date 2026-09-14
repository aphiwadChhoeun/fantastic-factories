"use client";

import { useState } from "react";

/**
 * A panel that answers both to a button and to the game underneath it.
 *
 * Two things want to decide whether a panel is showing, and they want it at
 * different scales. The player's click is about right now — I have seen enough
 * of the row, get it out of my way — and has to stand for as long as "right
 * now" lasts. The game's own answer is about the turn: the market row is what
 * a Market Phase is *for*, and hiding it then would be hiding the phase.
 *
 * So the click wins until the moment the game moves on, and then the game's
 * answer replaces it. `key` is that moment, whatever the caller decides one is;
 * `wanted` is what the game would say if it were asked.
 *
 * Settled during the render rather than in an effect, the way `useGrowth` is.
 * An effect would commit one paint with the old answer and then correct it,
 * which on a panel the height of the market is the board visibly flinching.
 */
export function useAutoPanel(
  key: string,
  wanted: boolean,
): readonly [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(wanted);
  /** The moment this answer was settled for, for noticing the next one. */
  const [seen, setSeen] = useState(key);

  if (seen !== key) {
    setSeen(key);
    setOpen(wanted);
  }

  return [open, setOpen];
}
