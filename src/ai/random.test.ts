import { describe, expect, it } from "vitest";
import { createRandomAi } from "@/ai";
import { createInitialState, legalMoves } from "@/engine";

describe("random ai", () => {
  it("only ever returns a legal move", () => {
    const state = createInitialState({ seed: 2 });
    const legal = legalMoves(state);
    const ai = createRandomAi(5);

    for (let i = 0; i < 50; i++) {
      expect(legal).toContainEqual(ai.chooseMove(state));
    }
  });

  it("is deterministic for a given seed", () => {
    const state = createInitialState({ seed: 2 });
    const a = createRandomAi(5);
    const b = createRandomAi(5);

    for (let i = 0; i < 20; i++) {
      expect(a.chooseMove(state)).toEqual(b.chooseMove(state));
    }
  });

  it("does not always pick the same move", () => {
    const state = createInitialState({ seed: 2 });
    const ai = createRandomAi(5);
    const seen = new Set<string>();

    for (let i = 0; i < 30; i++) {
      seen.add(JSON.stringify(ai.chooseMove(state)));
    }

    expect(seen.size).toBeGreaterThan(1);
  });
});
