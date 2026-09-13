"use client";

import { useEffect, useMemo, useState, type RefObject } from "react";
import { useReducedMotion } from "motion/react";
import type { DieFace } from "@/engine";
import { onLand } from "@/dice/bus";
import { DICE_PHYSICS } from "@/dice/flag";
import { throwTotalMs } from "@/dice/throw";
import { faceStepMs, tossFor, type Toss } from "@/lib/toss";

/** A beat of slack, so the keyframes have landed before the throw is over. */
const SETTLE_MS = 60;

/** How far the die has to come to join the row, once the canvas is done with it. */
export type Gather = { readonly x: number; readonly y: number };

export type Tossing = {
  /** The keyframed throw, or null once the die is on the table. */
  readonly toss: Toss | null;
  /** The face showing right now, which is not the dealt one until it lands. */
  readonly face: DieFace;
  /**
   * Whether the die is being thrown somewhere else — in the canvas, where it
   * is a simulated body rather than a numeral. The DOM die keeps its place in
   * the row all the while, and is not drawn.
   */
  readonly waiting: boolean;
  /** Where it came to rest out there, relative to where it belongs in here. */
  readonly gather: Gather | null;
};

/**
 * A die in the air.
 *
 * Two ways of being there, and the board does not care which. Either the throw
 * is keyframed here — an arc, a spin and a handful of faces turning over, all
 * of it decided by `lib/toss.ts` — or the physics canvas is switched on, in
 * which case the die is a body over in `src/dice` and this waits for it to
 * report where it stopped. See docs/dice.md §1.3 for why there are two, and
 * §2.1 for why the handoff is invisible.
 *
 * Everything is on timers rather than on animation callbacks, for the same
 * reason as everywhere else in `src/components`: `requestAnimationFrame` stops
 * for a window the browser is not painting, and a die whose landing is
 * announced by the animation is a die that never lands at all if nobody was
 * looking. The throw is decoration over a state machine that runs on a clock.
 */
export function useToss(
  dieId: string,
  face: DieFace,
  /** Its place in the handful, which is all the stagger needs. */
  index: number,
  /** Whether this die was thrown, rather than arriving some other way. */
  thrown: boolean,
  /** The die's own place in the row, for working out how far it has to come. */
  grip: RefObject<HTMLElement | null>,
): Tossing {
  const still = useReducedMotion();
  /*
   * Decided once, at the moment the die mounts. `thrown` is worked out from a
   * tray that the very next render has already caught up with, and a throw
   * that read it again would stop halfway down.
   */
  const [launched] = useState(thrown);
  /** Which of the tumbling faces is up. */
  const [step, setStep] = useState(0);
  /**
   * ...and whether it is down.
   *
   * Kept apart from the step on purpose. Ending the throw when the last face
   * comes up looks equivalent and is not: the die would stop tumbling in the
   * same breath as it showed the dealt number, and `DieFaceView` would read
   * that as a *turn* from whatever was up a moment ago — so the die landed by
   * rolling over one last time, with both numbers on it at once.
   */
  const [landed, setLanded] = useState(false);
  /** Where the simulated die stopped, once it has. */
  const [gather, setGather] = useState<Gather | null>(null);

  /** Whether this throw is happening in the canvas rather than here. */
  const simulated = DICE_PHYSICS && launched && !still;

  /*
   * Not while anyone has asked for less motion: docs/dice.md §4.3 is explicit
   * that there is no throw at all then, and the dice simply arrive showing
   * their faces. Recomputed rather than frozen because `useReducedMotion` can
   * answer a beat after the first render.
   */
  const toss = useMemo(
    () => (launched && !still && !DICE_PHYSICS ? tossFor(dieId, face, index) : null),
    [launched, still, dieId, face, index],
  );

  useEffect(() => {
    if (!toss) return;

    const stepMs = faceStepMs(toss);
    // One timer per face, plus one for the landing. Few enough to be plain,
    // and every one of them cancelled if the die leaves the board mid-throw.
    const turning = toss.faces.map((_, at) =>
      setTimeout(() => setStep(at + 1), toss.delay + at * stepMs),
    );
    const landing = setTimeout(() => setLanded(true), toss.delay + toss.duration + SETTLE_MS);

    return () => {
      for (const timer of turning) clearTimeout(timer);
      clearTimeout(landing);
    };
  }, [toss]);

  useEffect(() => {
    if (!simulated) return;

    const heard = onLand((landing) => {
      if (landing.id !== dieId) return;
      // Measured here, as the news arrives, because *here* is where the die
      // has to end up: the offset is the distance from where the body stopped
      // on screen to the slot this die keeps in the row.
      const box = grip.current?.getBoundingClientRect();
      setGather(
        box
          ? {
              x: landing.x - (box.left + box.width / 2),
              y: landing.y - (box.top + box.height / 2),
            }
          : { x: 0, y: 0 },
      );
    });

    /*
     * ...and a floor under it. A canvas that never loads, a chunk that fails,
     * a body that is still rolling when the world is torn down — none of them
     * may leave a die invisible. The face is already decided, so the worst
     * this costs is a throw nobody saw.
     */
    const giveUp = setTimeout(() => setGather((at) => at ?? { x: 0, y: 0 }), throwTotalMs(6) + 600);

    return () => {
      heard();
      clearTimeout(giveUp);
    };
  }, [simulated, dieId, grip]);

  return {
    toss: landed ? null : toss,
    // Before the first face is up the die is showing nothing anyone can see —
    // it is still off the table at nought opacity — so the dealt face does as
    // well as any other. The last one in the list is that face, which is what
    // makes the landing a change of nothing.
    face: toss && !landed ? (toss.faces[Math.max(0, step - 1)] ?? face) : face,
    waiting: simulated && gather === null,
    gather,
  };
}
