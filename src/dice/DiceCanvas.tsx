"use client";

import { useCallback, useMemo, type CSSProperties } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { CuboidCollider, Physics } from "@react-three/rapier";
import type { Vector3 } from "three";
import { emitLand, type RollRequest } from "./bus";
import { DieBody } from "./DieBody";
import { GRAVITY, TIME_STEP, TRAY } from "./throw";

/**
 * How much of the tray's depth to leave as margin around it, so a die never
 * bounces off a wall that is off the edge of the picture.
 */
const MARGIN = 1.15;

/** Vertical field of view. Narrow enough that the tray is not fish-eyed. */
const FOV = 50;

/** Far enough up that the tray's depth exactly fills the view, plus margin. */
const HEIGHT = (TRAY.z * MARGIN) / Math.tan(((FOV / 2) * Math.PI) / 180);

/**
 * The walls, as half-extents and centres. Invisible, and three units thick
 * because a thin wall is a wall a fast die crosses in a single step.
 */
const WALLS: readonly [[number, number, number], [number, number, number]][] = [
  [[TRAY.wall, TRAY.height, TRAY.z + TRAY.wall], [TRAY.x + TRAY.wall, 0, 0]],
  [[TRAY.wall, TRAY.height, TRAY.z + TRAY.wall], [-TRAY.x - TRAY.wall, 0, 0]],
  [[TRAY.x + TRAY.wall, TRAY.height, TRAY.wall], [0, 0, TRAY.z + TRAY.wall]],
  [[TRAY.x + TRAY.wall, TRAY.height, TRAY.wall], [0, 0, -TRAY.z - TRAY.wall]],
];

/**
 * Reports where each die stopped, in viewport pixels.
 *
 * Inside the canvas because that is where the camera is. Projection is one
 * line and it is the whole of the handoff in docs/dice.md §2.1: the DOM dice
 * mount at exactly these coordinates and gather themselves into the tray row
 * from there, so the swap has nothing to give it away.
 */
function useLandingReport(within: RollRequest["within"]) {
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);

  return useCallback(
    (id: string, at: Vector3) => {
      const ndc = at.clone().project(camera);
      emitLand({
        id,
        x: within.left + ((ndc.x + 1) / 2) * size.width,
        y: within.top + ((1 - ndc.y) / 2) * size.height,
      });
    },
    [camera, size.width, size.height, within.left, within.top],
  );
}

function Tray({ dice, within }: { dice: RollRequest["dice"]; within: RollRequest["within"] }) {
  const report = useLandingReport(within);

  return (
    <>
      {/* Lit from above and slightly to one side, so the chamfer reads. */}
      <ambientLight intensity={1.5} />
      <directionalLight position={[6, 14, 6]} intensity={2.2} />

      <CuboidCollider
        args={[TRAY.x + TRAY.wall, 1, TRAY.z + TRAY.wall]}
        position={[0, -1, 0]}
        restitution={0.12}
        friction={0.85}
      />
      {WALLS.map(([args, position], index) => (
        <CuboidCollider key={index} args={args} position={position} friction={0.85} />
      ))}

      {dice.map((die, index) => (
        <DieBody
          key={die.id}
          die={die}
          index={index}
          count={dice.length}
          onSettled={report}
        />
      ))}
    </>
  );
}

/**
 * The dice, simulated, over the panel they belong to.
 *
 * A default export because this module is the lazy-loading boundary — see
 * `DiceLayer`. Everything Rapier gets pulled in from here down, and nothing
 * above this line may import it.
 *
 * `frameloop` is left on rather than on demand, which is the opposite of the
 * particle canvas: a physics world has to be stepped, and this whole component
 * only exists while dice are in the air. The way it stops costing anything is
 * that it unmounts, which is docs/dice.md §1.4's advice taken literally.
 */
export default function DiceCanvas({ request }: { request: RollRequest }) {
  const { within } = request;
  /*
   * `<Canvas>` writes `position: relative` and a 100% box onto its own wrapper
   * as inline styles and merges anything passed in over the top, so a class
   * cannot win without `!important` — the same reason the particle canvas puts
   * its overlay here rather than in a stylesheet.
   */
  const overlay = useMemo<CSSProperties>(
    () => ({
      position: "fixed",
      left: within.left,
      top: within.top,
      width: within.width,
      height: within.height,
      // Over the board, under a die being carried. Dice are not a target:
      // every click goes to the panel underneath.
      zIndex: 20,
      pointerEvents: "none",
    }),
    [within.left, within.top, within.width, within.height],
  );

  return (
    <Canvas
      style={overlay}
      camera={{ position: [0, HEIGHT, 0], fov: FOV, near: 0.1, far: HEIGHT * 4 }}
      /*
       * Straight down at the tray, because the board is a table seen from
       * above and a die tumbling toward the player would be a different game
       * in the same window. `up` has to be set before the camera is aimed —
       * a camera looking along its own up axis has no idea which way round it
       * is — and R3F aims the default camera for us, so it is done again here.
       */
      onCreated={({ camera }) => {
        camera.up.set(0, 0, -1);
        camera.lookAt(0, 0, 0);
        camera.updateProjectionMatrix();
      }}
      dpr={[1, 2]}
      gl={{ alpha: true, antialias: true, powerPreference: "low-power" }}
    >
      {/*
       * Fixed rather than varying, so a frame hitch cannot produce a step big
       * enough to put a die through a wall.
       */}
      <Physics gravity={[GRAVITY.x, GRAVITY.y, GRAVITY.z]} timeStep={TIME_STEP}>
        <Tray dice={request.dice} within={within} />
      </Physics>
    </Canvas>
  );
}
