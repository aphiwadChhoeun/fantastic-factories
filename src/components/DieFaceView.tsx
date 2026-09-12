"use client";

import { useEffect, useState } from "react";
import { m, useReducedMotion } from "motion/react";
import type { DieFace } from "@/engine";
import { turnMs, turnTo } from "@/lib/dice";
import styles from "./game.module.css";

/**
 * A beat of slack after the turn before the die is called settled, so that an
 * animation which is actually running has always finished first and the commit
 * below changes nothing anyone can see.
 */
const SETTLE_MS = 60;

/**
 * The number on a die, and the turn that put it there.
 *
 * A face never simply becomes another number. Something turned the die over —
 * a Dojo flip, a Fitness Center step, a re-roll — and a die that swaps its
 * numeral in place has no weight at all: it reads as a label being edited
 * rather than as an object being handled.
 *
 * So the die keeps showing the face it already had until the turn that brings
 * the new one up has finished. `shown` lagging the prop is the whole mechanism;
 * everything else is geometry out of `lib/dice.ts`.
 *
 * This covers every way a face changes except a throw, which does not exist
 * yet: a re-roll turns rather than tumbles for now, which is still a die being
 * handled. See docs/dice.md §0 and §5.
 */
export function DieFaceView({ face }: { face: DieFace }) {
  /** The face on top. Behind `face` for as long as the turn takes. */
  const [shown, setShown] = useState<DieFace>(face);
  const turn = turnTo(shown, face);
  const still = useReducedMotion();

  /*
   * The turn is over after a fixed time, whether or not the animation meant to
   * fill it ever ran.
   *
   * `onAnimationComplete` is the obvious place for this and the wrong one: it
   * hangs off `requestAnimationFrame`, which a browser stops for a window it
   * is not painting, and it may not fire at all for a player who has asked for
   * less motion — Motion drops the transform rather than animating it. Either
   * way the die would be left showing a face the game no longer says it has,
   * which is the board lying about the state rather than dressing it up.
   *
   * So the clock commits the face and the animation only decorates the wait.
   */
  useEffect(() => {
    if (turn === 0) return;
    const settle = setTimeout(() => setShown(face), still ? 0 : turnMs(turn) + SETTLE_MS);
    return () => clearTimeout(settle);
  }, [face, turn, still]);

  return (
    /*
     * Keyed on the face it settled at, so committing the turn hands back an
     * unrotated die rather than animating the rotation away again. The swap is
     * invisible: the frame before it and the frame after it are the same
     * numeral, upright, facing the player.
     */
    <m.span
      key={shown}
      className={styles.dieTurn}
      // The cube turns by the opposite of the angle the incoming face is held
      // at, which is what lands that face squarely at zero rather than merely
      // near it.
      animate={{ rotateX: -turn }}
      // Nothing to animate *to* on arrival: a die that has just been rolled or
      // handed over is showing its face from the first frame.
      initial={false}
      transition={{ duration: turnMs(turn) / 1000, ease: [0.3, 0.85, 0.35, 1] }}
    >
      <span>{shown}</span>
      {/*
        * The face coming up, held where it would be on the cube — on the
        * underside for a step, right round the back for a flip. Hidden by
        * `backface-visibility` until the turn has carried it past edge-on, so
        * the two are never both readable.
        */}
      {turn !== 0 && <span style={{ transform: `rotateX(${turn}deg)` }}>{face}</span>}
    </m.span>
  );
}
