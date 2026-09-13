"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { useReducedMotion } from "motion/react";
import { onRoll, type RollRequest } from "./bus";
import { DICE_PHYSICS } from "./flag";
import { throwTotalMs } from "./throw";

/**
 * Lazily, and only in the browser.
 *
 * Rapier is a WASM build on top of the `three` the board already carries, and
 * it exists to animate an outcome the engine decided before the canvas was
 * mounted. So it is not allowed anywhere near the first load: `dynamic` puts
 * it in a chunk of its own that is fetched the first time anyone actually
 * rolls, and `ssr: false` because there is no physics world to prerender into
 * and no server at runtime to prerender on.
 */
const DiceCanvas = dynamic(() => import("./DiceCanvas"), { ssr: false });

/**
 * The board's one point of contact with the simulated dice.
 *
 * Three gates, all of them checked before the component is ever rendered,
 * which is what decides whether the chunk is requested at all: the flag, the
 * player's stated preference about motion, and whether anyone has rolled yet.
 * A visitor who has asked for less motion does not download a physics engine
 * in order not to use it.
 *
 * Mounted only while dice are in the air. A stepped world with nothing moving
 * in it still costs a broadphase pass a frame, and the cheapest way not to pay
 * that is for the world not to exist — docs/dice.md §1.4.
 */
export function DiceLayer() {
  const reduced = useReducedMotion();
  const [request, setRequest] = useState<RollRequest | null>(null);

  useEffect(() => {
    if (!DICE_PHYSICS || reduced) return;
    return onRoll(setRequest);
  }, [reduced]);

  useEffect(() => {
    if (!request) return;
    /*
     * Taken down on a clock rather than when the last die reports in. A die
     * that never settles must not leave a canvas running for the rest of the
     * game, and the board has already been told where every die that did
     * settle ended up — see `useToss`, which is not waiting on this either.
     */
    const done = setTimeout(
      () => setRequest(null),
      throwTotalMs(request.dice.length) + 400,
    );
    return () => clearTimeout(done);
  }, [request]);

  if (!DICE_PHYSICS || reduced || !request) return null;
  return <DiceCanvas request={request} />;
}
