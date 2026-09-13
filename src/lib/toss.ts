/**
 * The throw.
 *
 * The engine rolled the face before anything was drawn, so this is not a roll:
 * it is a lie, told convincingly, about a number that already exists. Every
 * throw here ends at rest showing the face it was given, and the only thing in
 * question is how it gets there. See docs/dice.md §1.3, method C — keyframed,
 * no physics engine, and no bytes.
 *
 * Kept whole and pure so that it can be checked without being watched: a
 * tumble is the one thing on this board that cannot be read off a screenshot.
 */

import type { DieFace } from "@/engine";
import { between, either, seedOf, spread } from "./seed";

/** How long one die is in the air. */
export const TOSS_MS = 620;

/**
 * Between one die leaving the hand and the next.
 *
 * Shorter than the 60–90ms docs/dice.md §4.1 asks for, because that figure is
 * there to keep a solver from exploding two bodies spawned inside each other,
 * and there is no solver here. What is left is the look of a handful thrown
 * rather than four dice dropped down four chutes, and a shorter gap does that
 * without leaving the last die hanging in the air waiting its turn.
 */
export const TOSS_STAGGER_MS = 55;

/**
 * Where the flight is at each keyframe, as a fraction of it.
 *
 * The shape is one long fall and then two bounces, quickly: a die is on the
 * table for most of the time it is settling, which is what stops the whole
 * thing reading as a balloon coming down.
 */
export const TOSS_TIMES = [0, 0.08, 0.52, 0.68, 0.8, 0.9, 1] as const;

/** What each of those six stretches does. Falls accelerate, bounces do not. */
export const TOSS_EASE = ["easeIn", "easeIn", "easeOut", "easeIn", "easeOut", "easeIn"] as const;

/** How long each face is up while the die is still falling. */
const FACE_MS = 85;

/** Every value a keyframe list has to carry, in the order TOSS_TIMES gives. */
export type TossKeyframes = {
  readonly x: readonly number[];
  readonly y: readonly number[];
  readonly rotate: readonly number[];
  readonly rotateX: readonly number[];
  readonly rotateY: readonly number[];
  readonly scale: readonly number[];
  readonly opacity: readonly number[];
};

export type Toss = {
  /** How long this die waits before it is thrown. */
  readonly delay: number;
  readonly duration: number;
  readonly keyframes: TossKeyframes;
  /**
   * The faces it shows on the way down, ending on the one it was dealt. A die
   * turning over in the air shows numbers it is not going to land on, which is
   * most of what makes the landing feel like an outcome rather than a reveal.
   */
  readonly faces: readonly DieFace[];
  /** How long the faces keep changing for — it stops turning once it lands. */
  readonly tumbleMs: number;
};

/**
 * The faces a die turns over on its way down.
 *
 * Never the same number twice running — a die that sticks on a face has
 * stopped tumbling — and never the dealt face until the end, so that landing
 * is a change rather than the last of several identical frames.
 */
function facesFor(next: () => number, face: DieFace): readonly DieFace[] {
  const count = Math.floor(between(next, 4, 7));
  const faces: DieFace[] = [];
  let last = face;
  for (let index = 0; index < count - 1; index++) {
    let candidate = last;
    while (candidate === last || candidate === face) {
      candidate = (1 + Math.floor(next() * 6)) as DieFace;
    }
    faces.push(candidate);
    last = candidate;
  }
  faces.push(face);
  return faces;
}

/**
 * How one die is thrown: when, from where, and through what.
 *
 * `index` is its place in the handful, which is the only thing here that is
 * not about the die itself — dice thrown on the same tick read as scripted
 * however different their arcs are.
 */
export function tossFor(dieId: string, face: DieFace, index: number): Toss {
  const next = spread(seedOf(dieId));

  // In from above and to one side. The lateral distance is what makes it a
  // throw rather than a drop.
  const fromY = -between(next, 90, 150);
  const fromX = between(next, -70, 70);
  // Spun in the plane of the table, which is the rotation a board seen from
  // above actually shows. Sometimes hard, sometimes barely.
  const spin = between(next, 220, 640) * either(next);
  /*
   * ...and leaned, but never as far as a quarter turn. A die here is a face
   * rather than a cube, and a face rotated past ninety degrees is edge-on,
   * which is to say invisible: the tilt has to stop short of proving that the
   * die has no sides.
   */
  const tiltX = between(next, -46, 46);
  const tiltY = between(next, -46, 46);
  // How high it comes off the table, and then off that.
  const bounce = between(next, 10, 20);

  const duration = TOSS_MS + between(next, -60, 60);

  return {
    delay: index * TOSS_STAGGER_MS,
    duration,
    faces: facesFor(next, face),
    // It stops turning over when it first hits the table.
    tumbleMs: duration * TOSS_TIMES[2],
    keyframes: {
      x: [fromX, fromX * 0.92, 0, 0, 0, 0, 0],
      y: [fromY, fromY * 0.92, 0, -bounce, 0, -bounce / 3, 0],
      rotate: [spin, spin * 0.9, spin * 0.12, spin * 0.05, 0, 0, 0],
      rotateX: [tiltX, tiltX * 0.9, 0, 0, 0, 0, 0],
      rotateY: [tiltY, tiltY * 0.9, 0, 0, 0, 0, 0],
      // Nearer the eye on the way in, and squarely on the table at the end.
      scale: [1.18, 1.16, 1, 1.03, 1, 1.01, 1],
      // Not a fade so much as a refusal to pop into existence a frame before
      // it starts moving: by the second keyframe it is simply there.
      opacity: [0, 1, 1, 1, 1, 1, 1],
    },
  };
}

/** How long the whole handful takes, for whatever has to outlast it. */
export function tossTotalMs(count: number): number {
  // The worst case of the jitter above, so this is never short.
  return Math.max(0, count - 1) * TOSS_STAGGER_MS + TOSS_MS + 60;
}

/** How many faces it turns through before it lands, and how fast. */
export function faceStepMs(toss: Toss): number {
  return Math.max(FACE_MS, toss.tumbleMs / toss.faces.length);
}
