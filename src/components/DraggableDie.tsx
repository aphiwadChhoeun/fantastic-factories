"use client";

import { useRef, useState, type RefObject } from "react";
import { animate, m, useMotionValue, useSpring, useTransform, useVelocity } from "motion/react";
import type { Die } from "@/engine";
import { DIE_SWATCHES } from "@/lib/colors";
import styles from "./game.module.css";

/** Where a die was let go, in viewport pixels. */
export type DropPoint = { readonly x: number; readonly y: number };

/** How a die gets back to the tray, whether or not it found a home. */
const SETTLE = { type: "spring", stiffness: 620, damping: 42, mass: 0.6 } as const;

/**
 * Where the pointer is, whatever kind of event carried it.
 *
 * Motion hands its drag callbacks the native event, and `info.point` is not
 * used here on purpose: it is page-space, and hit-testing wants client-space.
 * Reading the event directly removes the conversion, and with it the chance of
 * getting the conversion wrong only once the page happens to be scrolled.
 */
function clientPointOf(event: MouseEvent | TouchEvent | PointerEvent): DropPoint | null {
  if ("clientX" in event) return { x: event.clientX, y: event.clientY };
  const touch = event.changedTouches?.[0] ?? event.touches?.[0];
  return touch ? { x: touch.clientX, y: touch.clientY } : null;
}

type Props = {
  die: Die;
  /** Whether this die has anywhere to go. Anything else is not worth picking up. */
  movable: boolean;
  /** Whether this is the die currently in hand. */
  held: boolean;
  /** The panel the die may be dragged around inside. */
  bounds: RefObject<HTMLElement | null>;
  onPick: () => void;
  /** Let go. The point is null if the gesture never produced one. */
  onRelease: (at: DropPoint | null) => void;
};

/**
 * A die you pick up and put somewhere.
 *
 * Motion's drag rather than the browser's. HTML5 drag-and-drop cannot be
 * styled — you get the browser's ghost image, which looks like a file being
 * moved rather than a die being placed — and, more to the point, it does not
 * work on touch at all. Half the ways of playing this game could not move a
 * die.
 */
export function DraggableDie({ die, movable, held, bounds, onPick, onRelease }: Props) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  /** The last place the pointer actually was, for working out the drop. */
  const at = useRef<DropPoint | null>(null);
  /**
   * Off the table: being carried, or on its way back. Not the same as `held`,
   * which the board clears the moment the move is played — a die still flying
   * home has to keep clearing the cards it passes over, or it finishes the
   * journey underneath one of them.
   */
  const [lifted, setLifted] = useState(false);

  /**
   * Back to the tray, explicitly.
   *
   * `dragSnapToOrigin` would do this, but it is part of the gesture, and the
   * gesture does not survive a successful drop: playing the move spends the
   * die, which drops it out of `movableDice`, which turns `drag` off in the
   * same tick. The snap-back is torn down with it and the die is left
   * stranded on top of whatever it was dropped on — behind it, in fact, once
   * it stops being lifted.
   */
  function home() {
    // Both axes, because either one can be the long way round: a die dragged
    // straight sideways is already home vertically, and hanging the landing
    // on that axis alone drops it out of the air mid-flight.
    let flying = 2;
    const landed = () => {
      flying -= 1;
      if (flying === 0) setLifted(false);
    };
    animate(x, 0, { ...SETTLE, onComplete: landed });
    animate(y, 0, { ...SETTLE, onComplete: landed });
  }

  /*
   * Heavy things lean into their own motion. `drag` writes `x` itself, so
   * unlike a layout animation this is a MotionValue we own — real velocity is
   * available here, and the die can tip the way it is being thrown.
   */
  const spin = useVelocity(x);
  const lean = useSpring(useTransform(spin, [-1800, 0, 1800], [-14, 0, 14]), {
    stiffness: 260,
    damping: 26,
  });

  return (
    <m.span
      className={[
        styles.die,
        die.spent && styles.dieSpent,
        movable && styles.dieMovable,
        held && styles.dieHeld,
      ]
        .filter(Boolean)
        .join(" ")}
      style={{
        ...DIE_SWATCHES[die.color],
        x,
        y,
        rotate: lean,
        // Clears the panels and cards it is carried over, and stays clear of
        // them all the way back down.
        zIndex: lifted ? 60 : undefined,
      }}
      drag={movable}
      dragConstraints={bounds}
      // Low, because brass is not rubber. Half of this feels like a balloon on
      // a string.
      dragElastic={0.12}
      dragMomentum={false}
      dragTransition={{ bounceStiffness: 620, bounceDamping: 42 }}
      onDragStart={() => {
        setLifted(true);
        onPick();
      }}
      onDrag={(event) => {
        at.current = clientPointOf(event);
      }}
      onDragEnd={(event) => {
        // The end event carries the final position on every input except a
        // cancelled touch, where the last move is the best that is known.
        const point = clientPointOf(event) ?? at.current;
        at.current = null;
        onRelease(point);
        // After the move, so a die that has just been spent still gets home.
        home();
      }}
      whileDrag={{ scale: 1.18 }}
      transition={{ type: "spring", stiffness: 420, damping: 30 }}
      title={`${die.color} ${die.face} — ${die.spent ? "spent" : "available"}`}
    >
      {die.face}
    </m.span>
  );
}
