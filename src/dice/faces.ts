/**
 * Which way a die is facing, and how to turn it.
 *
 * The constraint the whole of `src/dice` is built around: **physics must never
 * decide a face**. The engine rolled it off a seeded generator before any of
 * this was drawn, wrote it to `localStorage` on the same tick, and 387 tests
 * depend on it. A simulation that produced its own outcome would be a second,
 * disagreeing source of truth — so the roll is not a roll. It is a lie, told
 * convincingly, about a number that already exists. See docs/dice.md §0.
 *
 * This module is what makes the lie land: it says which face a tumbling body
 * is showing, and the shortest turn that would bring up the one it owes.
 *
 * Pure, and dependent on nothing but `three`'s maths, so the part of the
 * physics that has a right answer can be tested without a canvas, a frame, or
 * anyone watching. The part that only has a *feel* is in `throw.ts`.
 */

import { Quaternion, Vector3 } from "three";
import { DIE_FACES, oppositeFace, type DieFace } from "@/engine";
import { MOVING, STEER, STEER_CAP } from "./throw";

/**
 * Which way each face looks, in the die's own frame.
 *
 * Opposite faces sum to seven, as they do on a real die, which is what makes
 * this table and the box texture's face order agree. Y is up here because the
 * tray's floor is the XZ plane — see `DiceCanvas`.
 */
export const NORMALS: Record<DieFace, Vector3> = {
  1: new Vector3(0, 1, 0),
  6: new Vector3(0, -1, 0),
  2: new Vector3(0, 0, 1),
  5: new Vector3(0, 0, -1),
  3: new Vector3(1, 0, 0),
  4: new Vector3(-1, 0, 0),
};

export const UP = new Vector3(0, 1, 0);

/** Whichever face is pointing most nearly at the ceiling. */
export function upFace(rotation: Quaternion): DieFace {
  let best: DieFace = 1;
  let bestDot = -Infinity;
  for (const face of DIE_FACES) {
    const dot = NORMALS[face].clone().applyQuaternion(rotation).dot(UP);
    if (dot > bestDot) {
      bestDot = dot;
      best = face;
    }
  }
  return best;
}

/**
 * The shortest rotation that would bring `face` up, as an axis and an angle.
 *
 * Used two ways: as a torque impulse while the die is still moving, which
 * reads as the last micro-settle rather than as a cheat, and as a hard
 * correction if the die runs out of time.
 */
export function tipToward(rotation: Quaternion, face: DieFace): { axis: Vector3; angle: number } {
  const normal = NORMALS[face].clone().applyQuaternion(rotation);
  const axis = new Vector3().crossVectors(normal, UP);
  const angle = Math.acos(Math.min(1, Math.max(-1, normal.dot(UP))));
  /*
   * Already up, or exactly upside down. The cross product is nothing usable in
   * both cases, and they need opposite things: nothing at all for the first,
   * and any horizontal axis at all for the second, since every one of them is
   * equally short.
   */
  if (axis.lengthSq() < 1e-6) return { axis: new Vector3(1, 0, 0), angle };
  return { axis: axis.normalize(), angle };
}

/**
 * A rotation showing `face`, spun by `spin` radians about the vertical.
 *
 * Where a die ends up when it runs out of time: the hard correction slerps to
 * this rather than to a fixed pose, so a die that has to be straightened still
 * keeps whichever way round it happened to be lying. A die that snapped to
 * north as well as to a number would be the tell.
 */
export function restingRotation(face: DieFace, spin = 0): Quaternion {
  const settle = new Quaternion().setFromUnitVectors(NORMALS[face].clone(), UP);
  return new Quaternion().setFromAxisAngle(UP, spin).multiply(settle);
}

/** Whether these two faces are the same one. Reads better than the equality. */
export function isOpposite(a: DieFace, b: DieFace): boolean {
  return b === oppositeFace(a);
}

/**
 * The pose to put a settling die in this step, or null to leave it alone.
 *
 * Method A from docs/dice.md §1.3, with the correction steered rather than
 * shoved — see the note on `STEER` for the measurement that decided that. The
 * principle is the doc's and is the whole reason this works: the die is still
 * genuinely moving, so the last of the turn reads as the final micro-settle
 * rather than as a cheat. Above `MOVING` it is still being thrown and nothing
 * is decided yet.
 *
 * The share grows as the die dies, so most of the correction happens while
 * there is most tumble to hide it in, and the cap keeps any one frame smaller
 * than the motion it is hiding behind.
 */
export function steerToward(
  rotation: Quaternion,
  face: DieFace,
  /** The greater of how fast it is travelling and how fast it is spinning. */
  motion: number,
): Quaternion | null {
  if (motion > MOVING) return null;
  if (upFace(rotation) === face) return null;

  const { axis, angle } = tipToward(rotation, face);
  if (angle < 1e-4) return null;

  const share = Math.min(
    STEER * (1 - motion / MOVING),
    ((STEER_CAP * Math.PI) / 180) / angle,
  );
  const target = new Quaternion().setFromAxisAngle(axis, angle).multiply(rotation);
  return rotation.clone().slerp(target, share);
}
