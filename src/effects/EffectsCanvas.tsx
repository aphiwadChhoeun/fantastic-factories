"use client";

import type { CSSProperties } from "react";
import { Canvas } from "@react-three/fiber";
import { Embers } from "./Embers";

/**
 * The overlay, and why it is not in a stylesheet.
 *
 * `<Canvas>` writes `position: relative`, `pointer-events: auto` and a 100%
 * box onto its own wrapper as *inline* styles, and merges anything passed in
 * over the top. A class cannot beat that without `!important`, so this is the
 * one place where inline wins on the merits.
 *
 * `fixed` rather than a canvas per card: a burst has to outlive whatever threw
 * it, and one canvas is one WebGL context where several would each want their
 * own. z-index 10 puts it over a card — including a hovered one at 5 — and
 * under a die in flight at 60, so sparks stay behind the thing in your hand.
 */
const OVERLAY: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 10,
  // Sparks are not a target. Every click goes to the board underneath.
  pointerEvents: "none",
};

/**
 * The whole 3D surface of the game: one canvas, and one thing drawn on it.
 *
 * A default export because this module is the lazy-loading boundary — see
 * EmbersLayer. Everything `three` gets pulled in from here down, so nothing
 * above this line may import it.
 */
export default function EffectsCanvas() {
  return (
    <Canvas
      style={OVERLAY}
      /*
       * Orthographic at zoom 1, which is the decision that makes one world
       * unit one CSS pixel — see `toWorld`. A perspective camera would buy
       * nothing here (there is no depth to see) and would cost the pixel
       * correspondence, which is the only reason the shader's constants are
       * readable.
       */
      orthographic
      camera={{ position: [0, 0, 100], zoom: 1, near: 0.1, far: 1000 }}
      /*
       * The whole performance story, in one prop. A turn-based board is idle
       * almost all of the time, and on demand the loop is not merely cheap
       * while nothing is happening — it is not running. Embers ask for frames
       * while they are alive and stop asking when they die.
       */
      frameloop="demand"
      // Capped, because a 3× phone drawing additive sprites is fill-bound and
      // nobody can see the difference on a spark.
      dpr={[1, 2]}
      gl={{
        // Round sprites with soft edges. There is nothing here to alias.
        antialias: false,
        alpha: true,
        powerPreference: "low-power",
      }}
    >
      <Embers />
    </Canvas>
  );
}
