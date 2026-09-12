"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import {
  animate,
  m,
  useMotionValue,
  useSpring,
  useTransform,
  useVelocity,
} from "motion/react";
import type { Die } from "@/engine";
import { aimAt, middleOf, pullOf, type Aim, type Point, type Target } from "@/lib/aim";
import { DIE_SWATCHES } from "@/lib/colors";
import { DieFaceView } from "./DieFaceView";
import { DragTrajectory } from "./DragTrajectory";
import styles from "./game.module.css";

/** How a die gets back to the tray, whether or not it found a home. */
const SETTLE = { type: "spring", stiffness: 620, damping: 42, mass: 0.6 } as const;

/**
 * The lean toward whatever the die is aimed at. Stiff and well damped: the die
 * should arrive at the offset rather than wobble into it, because the pointer
 * is still moving and a second oscillation on top of that reads as lag.
 */
const MAGNET = { stiffness: 700, damping: 30 } as const;

/**
 * Where the pointer is, whatever kind of event carried it.
 *
 * Motion hands its drag callbacks the native event, and `info.point` is not
 * used here on purpose: it is page-space, and hit-testing wants client-space.
 * Reading the event directly removes the conversion, and with it the chance of
 * getting the conversion wrong only once the page happens to be scrolled.
 */
function clientPointOf(event: MouseEvent | TouchEvent | PointerEvent): Point | null {
  if ("clientX" in event) return { x: event.clientX, y: event.clientY };
  const touch = event.changedTouches?.[0] ?? event.touches?.[0];
  return touch ? { x: touch.clientX, y: touch.clientY } : null;
}

/**
 * Everywhere this die may land, measured once.
 *
 * `data-drop` is the board's own answer to what is legal: a section or a card
 * only carries one while it would actually take the die being held, so there
 * is no separate legality check to get wrong here. Measured at the start of
 * the drag rather than on every move — eight `getBoundingClientRect` calls per
 * pointer event is a forced layout per pointer event, and nothing on the board
 * moves while a die is in the air.
 *
 * A `data-lands` inside one of them, where there is one, is the spot the die
 * actually ends up in: a Headquarters section is a whole card wide and will
 * take a drop anywhere on it, but the die goes into one particular slot, and
 * aiming at the middle of the card would point the line at the section's
 * heading instead.
 */
function measureTargets(): readonly Target[] {
  const targets: Target[] = [];
  for (const element of document.querySelectorAll("[data-drop]")) {
    const id = element.getAttribute("data-drop");
    if (!id) continue;
    const lands = element.querySelector("[data-lands]");
    targets.push({
      id,
      box: element.getBoundingClientRect(),
      at: lands ? middleOf(lands.getBoundingClientRect()) : undefined,
    });
  }
  return targets;
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
  /** The `data-drop` the die is aimed at, so the board can light it up. */
  onAim: (drop: string | null) => void;
  /** Let go. The drop is null if the die was let go at nothing. */
  onRelease: (drop: string | null) => void;
};

/**
 * A die you pick up and put somewhere.
 *
 * Motion's drag rather than the browser's. HTML5 drag-and-drop cannot be
 * styled — you get the browser's ghost image, which looks like a file being
 * moved rather than a die being placed — and, more to the point, it does not
 * work on touch at all. Half the ways of playing this game could not move a
 * die.
 *
 * Two layers, and the split is load-bearing: the outer one is dragged and the
 * inner one is magnetised, so that the gesture and the attraction never write
 * to the same transform. Anything else fighting `drag` for `x` and `y` is felt
 * by the player as stickiness. See docs/dice.md §2.3.
 */
export function DraggableDie({ die, movable, held, bounds, onPick, onAim, onRelease }: Props) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const grip = useRef<HTMLSpanElement>(null);
  /** The last place the pointer actually was, for working out the drop. */
  const at = useRef<Point | null>(null);
  /** Where the die sits when it is not being carried, in viewport pixels. */
  const anchor = useRef<Point>({ x: 0, y: 0 });
  /** Everywhere it may land. Empty unless it is in hand. */
  const targets = useRef<readonly Target[]>([]);
  /** What it is aimed at, as of the last pointer move. */
  const aim = useRef<Aim | null>(null);
  /**
   * ...and the same thing in state, because the line has to be drawn to it.
   * Set only when the *target* changes rather than on every move, so carrying
   * a die across the board is a handful of renders and not sixty a second.
   */
  const [aimed, setAimed] = useState<Aim | null>(null);
  /**
   * Off the table: being carried, or on its way back. Not the same as `held`,
   * which the board clears the moment the move is played — a die still flying
   * home has to keep clearing the cards it passes over, or it finishes the
   * journey underneath one of them.
   */
  const [lifted, setLifted] = useState(false);

  // Measured once the drag is under way rather than as it starts: the targets
  // are marked by the same render that puts this die in hand, so at the moment
  // the gesture begins there is not yet a `data-drop` on the board.
  useEffect(() => {
    targets.current = held ? measureTargets() : [];
  }, [held]);

  /** How far the die is leaning toward what it is aimed at. */
  const wantX = useMotionValue(0);
  const wantY = useMotionValue(0);
  const pullX = useSpring(wantX, MAGNET);
  const pullY = useSpring(wantY, MAGNET);

  /** Where the die actually is on the screen — carried, and leaning. */
  const liveX = useTransform([x, pullX], ([dx, pull]: number[]) => anchor.current.x + dx + pull);
  const liveY = useTransform([y, pullY], ([dy, pull]: number[]) => anchor.current.y + dy + pull);

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

  /** Takes aim, and tells the board only when the answer has changed. */
  function takeAim(next: Aim | null) {
    aim.current = next;
    const pull = pullOf(next);
    wantX.set(pull.x);
    wantY.set(pull.y);
    if ((next?.id ?? null) === (aimed?.id ?? null)) return;
    setAimed(next);
    onAim(next?.id ?? null);
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
      ref={grip}
      className={[styles.dieGrip, movable && styles.dieMovable].filter(Boolean).join(" ")}
      style={{
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
        // Where the die started from, so the line has somewhere to come out
        // of. Taken here rather than in the effect above because the effect
        // runs after the paint, and by then the line has already been drawn
        // once from wherever this last happened to be. Less whatever the drag
        // has already moved it: the gesture begins at the threshold, not at
        // the touch.
        const box = grip.current?.getBoundingClientRect();
        if (box) {
          anchor.current = {
            x: box.left + box.width / 2 - x.get(),
            y: box.top + box.height / 2 - y.get(),
          };
        }
        setLifted(true);
        onPick();
      }}
      onDrag={(event) => {
        const point = clientPointOf(event);
        if (!point) return;
        at.current = point;
        takeAim(aimAt(point, targets.current));
      }}
      onDragEnd={(event) => {
        // The end event carries the final position on every input except a
        // cancelled touch, where the last move is the best that is known.
        const point = clientPointOf(event) ?? at.current;
        const landing = point ? aimAt(point, targets.current) : aim.current;
        at.current = null;
        takeAim(null);
        onRelease(landing?.id ?? null);
        // After the move, so a die that has just been spent still gets home.
        home();
      }}
      title={`${die.color} ${die.face} — ${die.spent ? "spent" : "available"}`}
    >
      <m.span
        className={[styles.die, die.spent && styles.dieSpent, held && styles.dieHeld]
          .filter(Boolean)
          .join(" ")}
        style={{ ...DIE_SWATCHES[die.color], x: pullX, y: pullY }}
        /*
         * A die arrives showing its face rather than being thrown onto the
         * table. That is exactly right for the ones that are never thrown — a
         * Foreman's die is *chosen*, and there is a legal path through the
         * game where a player throws nothing all evening — and it is what a
         * rolled die does until the tumble exists. See docs/dice.md §0.
         */
        initial={{ opacity: 0, scale: 0.72 }}
        // Bigger in the hand. On this layer rather than as a `whileDrag` on
        // the gesture, because the gesture belongs to the layer above.
        animate={{ opacity: 1, scale: held ? 1.18 : 1 }}
        transition={{ type: "spring", stiffness: 420, damping: 30 }}
      >
        <DieFaceView face={die.face} />
      </m.span>
      {held && <DragTrajectory from={{ x: liveX, y: liveY }} to={aimed?.at ?? null} />}
    </m.span>
  );
}
