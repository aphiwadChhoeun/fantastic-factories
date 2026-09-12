"use client";

import { useState } from "react";

/**
 * How long a list was the last time anyone looked, so that whatever is past
 * that point can be said to have just arrived.
 *
 * This is what keeps a die landing in a socket from playing on every page
 * load. A slot that has just been struck and a slot that was struck four
 * rounds ago render exactly the same, and a mount animation cannot tell them
 * apart — a board restored from `localStorage` mounts a compound of dice that
 * have been standing there all game, and every one of them would strike.
 *
 * Answered from the component's own history rather than from an event, because
 * an event would have to name the slot as well as the card, and the component
 * is the only thing that already knows how many it had.
 */
export function useGrowth(length: number): number {
  /** How long it was before the last change. */
  const [seen, setSeen] = useState(length);
  /** ...and how long it was at that change, for noticing the next one. */
  const [current, setCurrent] = useState(length);

  /*
   * Adjusted during the render rather than in an effect, which is React's own
   * answer to state derived from a prop's history: setting state on the way
   * past restarts this render before anything is committed, where an effect
   * would commit one paint with the wrong answer and then paint again.
   *
   * A ref would be the obvious place to keep this and is the wrong one — a
   * value read during a render has to be one that re-renders when it changes,
   * or what a component draws starts depending on what else happened to make
   * it draw.
   */
  if (current !== length) {
    setCurrent(length);
    setSeen(current);
  }

  return seen;
}
