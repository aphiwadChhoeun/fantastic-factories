import { describe, expect, it } from "vitest";
import { anchorIn, toWorld } from "./screen";

const CARD = { left: 100, top: 200, width: 164, height: 228 } as const;

describe("anchorIn", () => {
  it("centres horizontally, whichever edge is asked for", () => {
    for (const edge of ["top", "center", "bottom"] as const) {
      expect(anchorIn(CARD, edge).x).toBe(182);
    }
  });

  it("takes the middle by default", () => {
    expect(anchorIn(CARD)).toEqual({ x: 182, y: 314 });
  });

  it("takes the top edge", () => {
    expect(anchorIn(CARD, "top").y).toBe(200);
  });

  it("takes the bottom edge", () => {
    // Sparks come off the base of a factory, which is `top + height` and not
    // `top` — the one that is easy to get backwards.
    expect(anchorIn(CARD, "bottom").y).toBe(428);
  });
});

describe("toWorld", () => {
  it("puts the middle of the viewport at the origin", () => {
    expect(toWorld(600, 400, 1200, 800)).toEqual([0, 0]);
  });

  it("flips y, because the page counts downwards and the scene counts up", () => {
    expect(toWorld(600, 0, 1200, 800)).toEqual([0, 400]);
    expect(toWorld(600, 800, 1200, 800)).toEqual([0, -400]);
  });

  it("keeps x in the same direction", () => {
    expect(toWorld(0, 400, 1200, 800)).toEqual([-600, 0]);
    expect(toWorld(1200, 400, 1200, 800)).toEqual([600, 0]);
  });

  it("is one world unit to the pixel", () => {
    // The invariant the shader's constants rely on: a 40px step on the page is
    // a 40 unit step in the scene, at any viewport size.
    const [near] = toWorld(300, 0, 1200, 800);
    const [far] = toWorld(340, 0, 1200, 800);
    expect(far - near).toBe(40);
  });
});
