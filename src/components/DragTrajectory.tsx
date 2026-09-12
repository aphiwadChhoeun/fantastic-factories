"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { m, useMotionTemplate, useMotionValue, useSpring, type MotionValue } from "motion/react";
import type { Point } from "@/lib/aim";
import styles from "./game.module.css";

/**
 * How quickly the far end catches up. Sprung rather than snapped, so a die
 * swept past three slots draws one line that whips between them rather than
 * three lines appearing in three places.
 */
const CATCH_UP = { stiffness: 400, damping: 30 } as const;

type Props = {
  /** The middle of the die in hand, live, in viewport pixels. */
  from: { readonly x: MotionValue<number>; readonly y: MotionValue<number> };
  /** The middle of what it is aimed at, or null while it is aimed at nothing. */
  to: Point | null;
};

/**
 * The line from the die in hand to where it would land.
 *
 * One path over the whole board, in SVG rather than canvas: it is a single
 * stroke, CSS can travel the dashes along it for free, and a canvas would mean
 * a second render loop for one line.
 *
 * Portalled to the body because it is `position: fixed` and the die it belongs
 * to is inside several transformed ancestors — and a transformed ancestor is
 * what `fixed` measures itself against, which would pin the line to the tray
 * rather than to the viewport. Nothing in `.page` opens a stacking context, so
 * the ladder still holds: cards at 5, embers at 10, this at 30, and the die
 * being carried at 60, over its own line.
 */
export function DragTrajectory({ from, to }: Props) {
  // Held as motion values so that the far end moving does not re-render the
  // board — and so the spring has something to track.
  const aimX = useMotionValue(to?.x ?? 0);
  const aimY = useMotionValue(to?.y ?? 0);
  const x = useSpring(aimX, CATCH_UP);
  const y = useSpring(aimY, CATCH_UP);

  const toX = to?.x;
  const toY = to?.y;
  useEffect(() => {
    // Nothing to point at: the line fades where it is rather than whipping
    // back to the origin on the way out.
    if (toX === undefined || toY === undefined) return;
    aimX.set(toX);
    aimY.set(toY);
  }, [toX, toY, aimX, aimY]);

  /*
   * A quadratic with the control point out level with the die, so the line
   * leaves the hand flat and arrives at the slot from above, like a field line.
   * A straight line reads as a ruler, which is the wrong idea entirely.
   */
  const path = useMotionTemplate`M ${from.x} ${from.y} Q ${x} ${from.y} ${x} ${y}`;

  return createPortal(
    <svg className={styles.trajectory} aria-hidden>
      <m.path
        className={styles.trajectoryLine}
        d={path}
        initial={{ opacity: 0 }}
        animate={{ opacity: to ? 0.85 : 0 }}
        transition={{ duration: 0.14 }}
      />
      {/* A bloom at the aiming end, so the line has somewhere to arrive. */}
      <m.circle
        className={styles.trajectoryBloom}
        cx={x}
        cy={y}
        r={6}
        initial={{ opacity: 0 }}
        animate={{ opacity: to ? 0.5 : 0 }}
        transition={{ duration: 0.14 }}
      />
    </svg>,
    document.body,
  );
}
