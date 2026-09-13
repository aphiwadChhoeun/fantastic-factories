import { describe, expect, it } from "vitest";
import { Euler, Quaternion, Vector3 } from "three";
import { DIE_FACES, oppositeFace } from "@/engine";
import { NORMALS, restingRotation, tipToward, UP, upFace } from "./faces";

/** A rotation nobody would arrive at on purpose, for the awkward cases. */
function awkward(seed: number): Quaternion {
  return new Quaternion().setFromEuler(new Euler(seed * 1.1, seed * 2.3, seed * 0.7));
}

describe("which face a die is showing", () => {
  it("puts opposite faces on opposite sides, as a real die does", () => {
    for (const face of DIE_FACES) {
      const across = NORMALS[oppositeFace(face)];
      expect(NORMALS[face].clone().add(across).length()).toBeCloseTo(0);
    }
  });

  it("reads a 1 off a die that has not been turned at all", () => {
    expect(upFace(new Quaternion())).toBe(1);
  });

  it("reads back every face it is asked to show", () => {
    for (const face of DIE_FACES) {
      expect(upFace(restingRotation(face))).toBe(face);
    }
  });

  it("still reads it back however the die is spun about the vertical", () => {
    // The spin is the one thing a settled die is allowed to keep, so it must
    // not change the number.
    for (const face of DIE_FACES) {
      for (const spin of [0.3, 1.2, Math.PI, 4.8]) {
        expect(upFace(restingRotation(face, spin))).toBe(face);
      }
    }
  });
});

describe("turning a die onto the face it owes", () => {
  it("asks for no turn at all when the face is already up", () => {
    for (const face of DIE_FACES) {
      expect(tipToward(restingRotation(face), face).angle).toBeCloseTo(0);
    }
  });

  it("asks for a half turn when the face is underneath", () => {
    for (const face of DIE_FACES) {
      const upsideDown = restingRotation(oppositeFace(face));
      expect(tipToward(upsideDown, face).angle).toBeCloseTo(Math.PI);
    }
  });

  it("gives an axis that is usable even then", () => {
    // Upside down, every horizontal axis is equally short and the cross
    // product is nothing at all. A zero axis would be a die that never turns.
    for (const face of DIE_FACES) {
      const { axis } = tipToward(restingRotation(oppositeFace(face)), face);
      expect(axis.length()).toBeCloseTo(1);
    }
  });

  it("brings the owed face up from anywhere, in one turn", () => {
    // The whole job: whatever the tumble left, this is the correction that
    // makes the body agree with the number the engine already rolled.
    for (const face of DIE_FACES) {
      for (let seed = 1; seed <= 12; seed++) {
        const rotation = awkward(seed);
        const { axis, angle } = tipToward(rotation, face);
        const turned = new Quaternion()
          .setFromAxisAngle(axis, angle)
          .multiply(rotation);

        expect(upFace(turned)).toBe(face);
      }
    }
  });

  it("never asks for more than a half turn", () => {
    // Longer than that and there was a shorter way round, which a player
    // watching the die settle would see as it going the wrong way.
    for (const face of DIE_FACES) {
      for (let seed = 1; seed <= 12; seed++) {
        expect(tipToward(awkward(seed), face).angle).toBeLessThanOrEqual(Math.PI + 1e-9);
      }
    }
  });

  it("turns about an axis that is level", () => {
    // A die on a table tips over an edge. A correction with any vertical
    // component to it would be spinning the die on the spot instead.
    for (const face of DIE_FACES) {
      for (let seed = 1; seed <= 12; seed++) {
        const { axis, angle } = tipToward(awkward(seed), face);
        if (angle < 1e-6) continue;
        expect(Math.abs(axis.dot(UP))).toBeLessThan(1e-6);
      }
    }
  });
});

describe("the vertical", () => {
  it("is the axis the tray's floor is flat to", () => {
    expect(UP.equals(new Vector3(0, 1, 0))).toBe(true);
  });
});
