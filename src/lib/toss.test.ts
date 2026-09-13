import { describe, expect, it } from "vitest";
import { DIE_FACES, type DieFace } from "@/engine";
import {
  faceStepMs,
  TOSS_EASE,
  TOSS_STAGGER_MS,
  TOSS_TIMES,
  tossFor,
  tossTotalMs,
} from "./toss";

/** Every throw a handful of dice could be, for the properties that must hold. */
function every(): ReturnType<typeof tossFor>[] {
  const tosses = [];
  for (const face of DIE_FACES) {
    for (let index = 0; index < 6; index++) {
      tosses.push(tossFor(`die-${face}-${index}`, face, index));
    }
  }
  return tosses;
}

describe("a die being thrown", () => {
  it("always comes to rest, whatever it did on the way", () => {
    // The one thing that cannot be got wrong: the engine rolled the face
    // before any of this was drawn, and the die has to end up in its slot.
    for (const toss of every()) {
      const { x, y, rotate, rotateX, rotateY, scale, opacity } = toss.keyframes;
      expect(x.at(-1)).toBe(0);
      expect(y.at(-1)).toBe(0);
      expect(rotate.at(-1)).toBe(0);
      expect(rotateX.at(-1)).toBe(0);
      expect(rotateY.at(-1)).toBe(0);
      expect(scale.at(-1)).toBe(1);
      expect(opacity.at(-1)).toBe(1);
    }
  });

  it("lands on the face it was dealt", () => {
    for (const face of DIE_FACES) {
      const toss = tossFor(`green-${face}`, face, 0);
      expect(toss.faces.at(-1)).toBe(face);
    }
  });

  it("shows other faces on the way down, and never that one early", () => {
    for (const toss of every()) {
      const dealt = toss.faces.at(-1);
      expect(toss.faces.length).toBeGreaterThanOrEqual(4);
      expect(toss.faces.slice(0, -1)).not.toContain(dealt);
    }
  });

  it("never shows the same face twice running", () => {
    // A die that sticks on a number has stopped tumbling and started blinking.
    for (const toss of every()) {
      for (let index = 1; index < toss.faces.length; index++) {
        expect(toss.faces[index]).not.toBe(toss.faces[index - 1]);
      }
    }
  });

  it("comes in from off the table", () => {
    for (const toss of every()) {
      // Above where it lands, always — a die thrown up into its slot is a
      // die falling out of the floor.
      expect(toss.keyframes.y[0]).toBeLessThan(-80);
      expect(Math.abs(toss.keyframes.x[0])).toBeGreaterThan(0);
    }
  });

  it("never leans far enough to show that the die is flat", () => {
    // Past a quarter turn a face is edge-on, which is to say gone.
    for (const toss of every()) {
      for (const lean of [...toss.keyframes.rotateX, ...toss.keyframes.rotateY]) {
        expect(Math.abs(lean)).toBeLessThan(90);
      }
    }
  });

  it("bounces off the table rather than through it", () => {
    for (const toss of every()) {
      // Up is negative. Nothing after the first landing may go below zero.
      for (const height of toss.keyframes.y.slice(2)) {
        expect(height).toBeLessThanOrEqual(0);
      }
      // ...and it does leave the table again, twice.
      expect(toss.keyframes.y[3]).toBeLessThan(0);
      expect(toss.keyframes.y[5]).toBeLessThan(0);
      expect(Math.abs(toss.keyframes.y[5])).toBeLessThan(Math.abs(toss.keyframes.y[3]));
    }
  });

  it("gives every value the same number of keyframes as there are times", () => {
    // Motion reads one `times` across the lot, so a list of the wrong length
    // is a die that arrives somewhere else entirely.
    for (const toss of every()) {
      for (const values of Object.values(toss.keyframes)) {
        expect(values).toHaveLength(TOSS_TIMES.length);
      }
    }
    expect(TOSS_EASE).toHaveLength(TOSS_TIMES.length - 1);
  });

  it("throws the same way every time for the same die", () => {
    // Off the id rather than off `Math.random`: a re-render must not re-throw,
    // and the server and the browser must not disagree.
    expect(tossFor("blue-2-0", 3, 0)).toEqual(tossFor("blue-2-0", 3, 0));
  });

  it("throws different dice differently", () => {
    const first = tossFor("blue-2-0", 3, 0);
    const second = tossFor("blue-2-1", 3, 0);

    expect(second.keyframes.rotate[0]).not.toBe(first.keyframes.rotate[0]);
  });

  it("staggers the handful rather than dropping it all at once", () => {
    const handful = [0, 1, 2, 3].map((index) => tossFor(`die-${index}`, 4, index));

    expect(handful.map((toss) => toss.delay)).toEqual([0, 55, 110, 165]);
    expect(TOSS_STAGGER_MS).toBe(55);
  });

  it("says how long the whole handful takes, and is never short about it", () => {
    const handful = [0, 1, 2, 3, 4, 5].map((index) => tossFor(`die-${index}`, 2 as DieFace, index));
    const last = Math.max(...handful.map((toss) => toss.delay + toss.duration));

    expect(tossTotalMs(handful.length)).toBeGreaterThanOrEqual(last);
  });

  it("turns the faces over while it is still in the air", () => {
    for (const toss of every()) {
      expect(faceStepMs(toss) * toss.faces.length).toBeLessThanOrEqual(toss.duration);
    }
  });
});
