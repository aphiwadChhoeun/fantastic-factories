import { describe, expect, it } from "vitest";
import { DIE_FACES, oppositeFace } from "@/engine";
import { HALF_TURN_MS, QUARTER_TURN_MS, turnTo, turnMs } from "./dice";

describe("the turn that brings a face up", () => {
  it("does not turn a die that is already showing the face", () => {
    for (const face of DIE_FACES) expect(turnTo(face, face)).toBe(0);
  });

  it("turns a die over onto its opposite face", () => {
    expect(turnTo(1, 6)).toBe(180);
    expect(turnTo(5, 2)).toBe(-180);
  });

  it("tips a die over one edge onto a neighbour", () => {
    expect(turnTo(3, 5)).toBe(90);
    expect(turnTo(6, 2)).toBe(-90);
  });

  it("turns up for a bigger face and down for a smaller one", () => {
    // The Fitness Center takes a pip off. Nothing else on the table says that
    // the die went backwards, so the direction of the turn has to.
    expect(turnTo(4, 5)).toBe(90);
    expect(turnTo(5, 4)).toBe(-90);
  });

  it("is a half turn for opposite faces and a quarter for every other pair", () => {
    // The whole rule, and the reason none of this needs to know which perk
    // fired: on a cube there is no third answer.
    for (const from of DIE_FACES) {
      for (const to of DIE_FACES) {
        if (from === to) continue;
        expect(Math.abs(turnTo(from, to))).toBe(to === oppositeFace(from) ? 180 : 90);
      }
    }
  });

  it("is symmetric in size and opposite in direction", () => {
    for (const from of DIE_FACES) {
      for (const to of DIE_FACES) {
        // Distinct faces only: negating the zero of a die that did not move
        // gives -0, which is a fact about arithmetic and not about dice.
        if (from === to) continue;
        expect(turnTo(to, from)).toBe(-turnTo(from, to));
      }
    }
  });
});

describe("how long a turn takes", () => {
  it("gives a half turn longer than a quarter", () => {
    expect(turnMs(180)).toBe(HALF_TURN_MS);
    expect(turnMs(-180)).toBe(HALF_TURN_MS);
    expect(turnMs(90)).toBe(QUARTER_TURN_MS);
    expect(turnMs(-90)).toBe(QUARTER_TURN_MS);
  });

  it("takes no time at all to leave a die alone", () => {
    expect(turnMs(turnTo(2, 2))).toBe(0);
  });
});
