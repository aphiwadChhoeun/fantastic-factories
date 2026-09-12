"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { m, useReducedMotion } from "motion/react";
import type { DieFace } from "@/engine";
import styles from "./game.module.css";

/**
 * The impact.
 *
 * Stiff and underdamped, so it overshoots down through about 0.94 on its way
 * to rest: the 1.22 → 0.94 → 1 of docs/dice.md §3.1, as a spring rather than
 * as three keyframes. A spring only interpolates between a pair, and a
 * keyframe list is a new array on every render, which is an animation that
 * restarts whenever anything else on the board moves.
 */
const STRIKE = { type: "spring", stiffness: 700, damping: 16, mass: 0.6 } as const;

/** How long the impact takes to finish throwing things off. */
const STRIKE_MS = 380;

type Props = {
  face: DieFace;
  /**
   * Whether it arrived just now rather than having stood here all along.
   * Worked out by whatever holds the row, which is the only thing that knows
   * how many dice were there before — see `useGrowth`.
   */
  struck: boolean;
  className: string;
  style?: CSSProperties;
};

/**
 * A die that has come to rest in a socket — a Headquarters slot, or a slot on
 * a building's perk.
 *
 * The impact is the socket giving rather than the die bouncing, which is why
 * the scale starts over one and settles rather than starting under it: a die
 * that squashes on landing is rubber, and a socket that takes the blow is
 * brass. The die you were carrying is not this element — it springs back to
 * the tray and is spent — so the aether it was wearing while you aimed it
 * hands over here: the ring carries that colour off, and the spice glow
 * underneath says the thing is committed now.
 */
export function LandedDie({ face, struck, className, style }: Props) {
  /*
   * Decided once, at the moment this die mounts. `struck` is worked out from a
   * length that the very next render has already caught up with, so reading it
   * again later would put the ring out halfway through its flight.
   */
  const [landing, setLanding] = useState(struck);
  const reduced = useReducedMotion();
  const strikes = landing && !reduced;

  /*
   * ...and taken back down again on a clock, so a compound of a dozen dice is
   * not carrying two dozen spent rings at nought opacity. On a timer rather
   * than on `onAnimationComplete` for the same reason the turn in
   * `DieFaceView` is: that callback rides `requestAnimationFrame`, which a
   * browser stops for a window it is not painting, and a ring that never hears
   * it has finished is a ring that stays lit.
   */
  useEffect(() => {
    if (!landing) return;
    const spent = setTimeout(() => setLanding(false), STRIKE_MS);
    return () => clearTimeout(spent);
  }, [landing]);

  return (
    <m.span
      className={className}
      style={style}
      // `false` rather than a scale of 1: a die that was already standing here
      // when the page loaded has not landed, and must not be animated at all.
      initial={strikes ? { scale: 1.22 } : false}
      animate={{ scale: 1 }}
      transition={STRIKE}
    >
      {face}
      {strikes && (
        <>
          {/* The aim, leaving. */}
          <m.span
            className={styles.strikeRing}
            aria-hidden
            initial={{ opacity: 0.9, scale: 1 }}
            animate={{ opacity: 0, scale: 2.1 }}
            transition={{ duration: 0.28, ease: "easeOut" }}
          />
          {/* ...and what it left behind. */}
          <m.span
            className={styles.strikeGlow}
            aria-hidden
            initial={{ opacity: 0.9 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 0.34, ease: "easeOut" }}
          />
        </>
      )}
    </m.span>
  );
}
