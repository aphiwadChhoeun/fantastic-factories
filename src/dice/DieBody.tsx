"use client";

import { useEffect, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { RigidBody, RoundCuboidCollider, type RapierRigidBody } from "@react-three/rapier";
import { Euler, Quaternion, Vector3 } from "three";
import { steerToward, tipToward, upFace } from "./faces";
import { materialsFor } from "./materials";
import type { Rolling } from "./bus";
import { BEVEL, BODY, DEADLINE_MS, HALF, TRAY, throwFor } from "./throw";

/** Below this in both speed and spin, a die has stopped for the eye's purposes. */
const AT_REST = 0.6;

/** ...for this many frames running, so a die at the top of a bounce is not "still". */
const STILL_FRAMES = 8;

/**
 * How much of what is left the hard correction takes each frame. A quarter
 * puts the owed face up inside about four frames and finishes inside eight,
 * which is the ~140ms docs/dice.md §1.3 asks for.
 */
const HARD_CORRECTION = 0.25;

type Props = {
  die: Rolling;
  index: number;
  count: number;
  /** Called once, when it has come to rest, with where it is in the world. */
  onSettled: (id: string, at: Vector3) => void;
};

/**
 * One die, simulated.
 *
 * The body is thrown by `throwFor` and steered onto its face by `steerToward`,
 * both of which are pure and both of which are tested against this same solver
 * in `simulate.test.ts` — 24 throws in 24 landing on the number the engine
 * rolled, inside the tray, with no frame of the correction turning the die
 * further than the tumble already is. What is left here is the plumbing.
 */
export function DieBody({ die, index, count, onSettled }: Props) {
  const body = useRef<RapierRigidBody>(null);
  const settled = useRef(false);
  const still = useRef(0);
  const since = useRef(0);
  const thrown = useRef(throwFor(die.id, index, count));
  const materials = materialsFor(die.color);

  // Thrown from the effect rather than at creation, so the stagger is real:
  // bodies made on the same tick and overlapping are what a solver explodes
  // apart, and that is what "the dice bounced off the screen" actually is.
  useEffect(() => {
    const toss = thrown.current;
    const start = setTimeout(() => {
      const rb = body.current;
      if (!rb) return;
      rb.setTranslation(toss.from, true);
      // A random starting pose, so the tumble does not begin from the same
      // one every time. Most of "organic" is here rather than in the impulse.
      const pose = new Quaternion().setFromEuler(
        new Euler(toss.spin.x, toss.spin.y, toss.spin.z),
      );
      rb.setRotation({ x: pose.x, y: pose.y, z: pose.z, w: pose.w }, true);
      rb.setLinvel({ x: 0, y: 0, z: 0 }, true);
      rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
      rb.applyImpulse(toss.impulse, true);
      rb.applyTorqueImpulse(toss.torque, true);
      since.current = performance.now();
    }, toss.delay);

    return () => clearTimeout(start);
  }, []);

  useFrame(() => {
    const rb = body.current;
    if (!rb || settled.current || since.current === 0) return;

    const linear = rb.linvel();
    const angular = rb.angvel();
    const speed = Math.hypot(linear.x, linear.y, linear.z);
    const spin = Math.hypot(angular.x, angular.y, angular.z);
    const rotation = new Quaternion().copy(rb.rotation() as Quaternion);

    /*
     * Anything outside the tray has escaped, however it managed it — see
     * docs/dice.md §4.2. Put it back rather than letting the player watch a
     * die leave the board: the face is already decided, so nothing about the
     * game is affected by the throw being taken again.
     */
    const at = rb.translation();
    if (Math.abs(at.x) > TRAY.x + 2 || Math.abs(at.z) > TRAY.z + 2 || at.y < -4) {
      rb.setTranslation({ x: 0, y: TRAY.height, z: 0 }, true);
      rb.setLinvel({ x: 0, y: -4, z: 0 }, true);
      return;
    }

    const steered = steerToward(rotation, die.face, Math.max(speed, spin));
    if (steered) rb.setRotation({ x: steered.x, y: steered.y, z: steered.z, w: steered.w }, true);

    const showing = upFace(rotation) === die.face;
    const resting = speed < AT_REST && spin < AT_REST;
    still.current = resting ? still.current + 1 : 0;

    /*
     * Down, and on the right number: nothing left to do. The body is switched
     * off rather than left asleep, because a stepped world with a settled body
     * in it still costs a broadphase pass every frame — docs/dice.md §1.4.
     */
    if (showing && still.current >= STILL_FRAMES) {
      settled.current = true;
      rb.setEnabled(false);
      onSettled(die.id, new Vector3(at.x, at.y, at.z));
      return;
    }

    /*
     * Out of time. A die balanced on a corner can take very nearly for ever,
     * and the engine already knows the answer, so at the deadline it stops
     * being asked nicely: the remaining turn is taken over a few frames while
     * the die is essentially still, which the eye reads as the final settle.
     * About one throw in six needs this.
     */
    if (performance.now() - since.current > DEADLINE_MS) {
      const { axis, angle } = tipToward(rotation, die.face);
      const target = new Quaternion().setFromAxisAngle(axis, angle).multiply(rotation);
      const next = rotation.clone().slerp(target, HARD_CORRECTION);
      rb.setRotation({ x: next.x, y: next.y, z: next.z, w: next.w }, true);
      rb.setAngvel({ x: 0, y: 0, z: 0 }, true);
      if (upFace(next) === die.face) {
        settled.current = true;
        rb.setEnabled(false);
        onSettled(die.id, new Vector3(at.x, at.y, at.z));
      }
    }
  });

  return (
    <RigidBody
      ref={body}
      // Off the floor until its turn comes, so a die waiting to be thrown is
      // not lying in the tray being hit by the ones already in the air.
      position={[0, TRAY.height * 3, 0]}
      colliders={false}
      restitution={BODY.restitution}
      friction={BODY.friction}
      linearDamping={BODY.linearDamping}
      angularDamping={BODY.angularDamping}
      // Fast body, thin wall, one step: that is what tunnelling is, and what
      // "the die went through the table" looks like. See docs/dice.md §4.2.
      ccd
    >
      {/*
       * Chamfered, like a real die. The bevel is why it tumbles instead of
       * catching an edge and stopping dead, and it is worth more than it
       * sounds.
       */}
      <RoundCuboidCollider
        args={[HALF * (1 - BEVEL), HALF * (1 - BEVEL), HALF * (1 - BEVEL), HALF * BEVEL]}
      />
      <mesh>
        <boxGeometry args={[HALF * 2, HALF * 2, HALF * 2]} />
        {materials.map((material, index) => (
          <primitive key={index} object={material} attach={`material-${index}`} />
        ))}
      </mesh>
    </RigidBody>
  );
}
