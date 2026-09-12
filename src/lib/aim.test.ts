import { describe, expect, it } from "vitest";
import { aimAt, pullOf, SNAP_RADIUS, type Target } from "./aim";

/** A die-sized slot, by its middle. */
function slot(id: string, x: number, y: number, width = 34, height = 34): Target {
  return { id, box: { left: x - width / 2, top: y - height / 2, width, height } };
}

describe("what a die is aimed at", () => {
  it("finds nothing when everything is out of reach", () => {
    expect(aimAt({ x: 0, y: 0 }, [slot("hq:mine", 500, 500)])).toBeNull();
  });

  it("finds the one target within reach", () => {
    const aim = aimAt({ x: 100, y: 100 }, [slot("hq:mine", 130, 100)]);

    expect(aim?.id).toBe("hq:mine");
    expect(aim?.dx).toBe(30);
    expect(aim?.dy).toBe(0);
    expect(aim?.distance).toBe(30);
  });

  it("takes the nearest of several within reach", () => {
    const aim = aimAt({ x: 100, y: 100 }, [
      slot("hq:mine", 140, 100),
      slot("hq:generate", 120, 100),
      slot("hq:research", 160, 100),
    ]);

    expect(aim?.id).toBe("hq:generate");
  });

  it("gives the middle of the target, for the line to arrive at", () => {
    const aim = aimAt({ x: 100, y: 100 }, [slot("hq:mine", 120, 140)]);

    expect(aim?.at).toEqual({ x: 120, y: 140 });
  });

  it("prefers a target the pointer is inside to a nearer middle elsewhere", () => {
    // The case this exists for: a compound card is far taller than the snap
    // radius, so a die dropped squarely on one is nowhere near its middle.
    const card: Target = { id: "card:dojo", box: { left: 0, top: 0, width: 152, height: 228 } };
    const aim = aimAt({ x: 76, y: 210 }, [card, slot("hq:mine", 76, 250)]);

    expect(aim?.id).toBe("card:dojo");
  });

  it("still takes the nearest middle when the pointer is inside two", () => {
    const wide: Target = { id: "card:wide", box: { left: 0, top: 0, width: 200, height: 200 } };
    const tight: Target = { id: "card:tight", box: { left: 140, top: 140, width: 40, height: 40 } };

    expect(aimAt({ x: 150, y: 150 }, [wide, tight])?.id).toBe("card:tight");
  });

  it("aims at where the die lands rather than at the middle of the target", () => {
    // A Headquarters section takes the drop anywhere on it, but the die goes
    // into one slot near the bottom of it.
    const section: Target = {
      id: "hq:mine",
      box: { left: 0, top: 0, width: 152, height: 228 },
      at: { x: 30, y: 180 },
    };
    const aim = aimAt({ x: 40, y: 200 }, [section]);

    expect(aim?.at).toEqual({ x: 30, y: 180 });
    expect(aim?.dx).toBe(-10);
    expect(aim?.dy).toBe(-20);
  });

  it("reaches exactly as far as the radius says", () => {
    const targets = [slot("hq:mine", 100 + SNAP_RADIUS, 100)];

    expect(aimAt({ x: 100, y: 100 }, targets)).not.toBeNull();
    expect(aimAt({ x: 99, y: 100 }, targets)).toBeNull();
  });
});

describe("how far the die leans toward it", () => {
  it("does not lean at nothing", () => {
    expect(pullOf(null)).toEqual({ x: 0, y: 0 });
  });

  it("closes more of the gap the nearer the target is", () => {
    // The *share* of the gap, not the pixels. A die nearly on its target has
    // hardly any gap left to close, so the lean is at its widest somewhere in
    // the middle of the reach and fades out at both ends — which is what makes
    // it read as attraction rather than as a snap.
    const near = pullOf(aimAt({ x: 100, y: 100 }, [slot("s", 108, 100)]));
    const far = pullOf(aimAt({ x: 100, y: 100 }, [slot("s", 160, 100)]));

    expect(near.x / 8).toBeGreaterThan(far.x / 60);
  });

  it("never pulls the die off the pointer altogether", () => {
    for (let gap = 1; gap <= SNAP_RADIUS; gap++) {
      const pull = pullOf(aimAt({ x: 0, y: 0 }, [slot("s", gap, 0)]));
      // Short of the target, always: the pointer is where the player put it.
      expect(pull.x).toBeLessThan(gap);
      expect(pull.x).toBeGreaterThanOrEqual(0);
    }
  });

  it("does not tug a die that is already over its target", () => {
    const card: Target = { id: "card:dojo", box: { left: 0, top: 0, width: 152, height: 228 } };
    const pull = pullOf(aimAt({ x: 76, y: 210 }, [card]));

    expect(Math.hypot(pull.x, pull.y)).toBe(0);
  });
});
