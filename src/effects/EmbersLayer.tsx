"use client";

import dynamic from "next/dynamic";
import { useReducedMotion } from "motion/react";
import { EMBERS } from "./flag";

/**
 * Lazily, and only in the browser.
 *
 * `three` is around ten times the size of everything else this game ships,
 * for an effect that is pure decoration, so it is not allowed anywhere near
 * the first load: `dynamic` puts it in a chunk of its own that is fetched
 * after the board is already playable. `ssr: false` because there is no
 * WebGL context to prerender into, and no server at runtime to prerender on.
 */
const EffectsCanvas = dynamic(() => import("./EffectsCanvas"), { ssr: false });

/**
 * The board's one point of contact with the canvas.
 *
 * Both gates are checked before the component is ever rendered, which is what
 * decides whether the chunk is requested at all — a visitor who has asked for
 * less motion does not download a particle engine to not use it.
 */
export function EmbersLayer() {
  const reduced = useReducedMotion();
  if (!EMBERS || reduced) return null;
  return <EffectsCanvas />;
}
