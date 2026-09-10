import { describe, expect, it } from "vitest";
import {
  createInitialState,
  END_COMPOUND_SIZE,
  END_GOODS,
  MAX_ROUNDS,
  createBlueprintDeck,
  type GameState,
  type Player,
} from "@/engine";
import { describeEnding, describeWinner } from "./format";

function patch(state: GameState, index: number, player: Partial<Player>): GameState {
  return {
    ...state,
    players: state.players.map((current, i) => (i === index ? { ...current, ...player } : current)),
  };
}

describe("describing how a game ended", () => {
  const state = createInitialState({ seed: 3 });

  it("names the player who reached the goods threshold", () => {
    const over = patch(state, 0, { resources: { metal: 0, energy: 0, goods: END_GOODS } });

    expect(describeEnding(over)).toBe(`You reached ${END_GOODS} goods`);
  });

  it("names the player who filled a compound", () => {
    const standing = createBlueprintDeck()
      .slice(0, END_COMPOUND_SIZE)
      .map((card) => ({ card, dice: [], worked: false }));
    const over = patch(state, 1, { compound: standing });

    expect(describeEnding(over)).toBe(`AI built a compound of ${END_COMPOUND_SIZE}`);
  });

  it("names both when both got there in the same round", () => {
    const rich = { metal: 0, energy: 0, goods: END_GOODS };
    const over = patch(patch(state, 0, { resources: rich }), 1, { resources: rich });

    expect(describeEnding(over)).toBe(`You and AI reached ${END_GOODS} goods`);
  });

  it("reads goods first, since a player can trip both at once", () => {
    const standing = createBlueprintDeck()
      .slice(0, END_COMPOUND_SIZE)
      .map((card) => ({ card, dice: [], worked: false }));
    const over = patch(state, 0, {
      resources: { metal: 0, energy: 0, goods: END_GOODS },
      compound: standing,
    });

    expect(describeEnding(over)).toBe(`You reached ${END_GOODS} goods`);
  });

  it("falls back to the round cap, which is the only other way out", () => {
    expect(describeEnding(state)).toBe(`The round cap of ${MAX_ROUNDS} was reached`);
  });
});

describe("describing who won", () => {
  const state = createInitialState({ seed: 3 });

  it("addresses the human player rather than talking about them", () => {
    // "You wins" is what a template gets you, and it reads terribly.
    expect(describeWinner({ ...state, winner: 0 })).toBe("You win");
  });

  it("talks about the automaton, which is not being spoken to", () => {
    expect(describeWinner({ ...state, winner: 1 })).toBe("AI wins");
  });

  it("says so when nobody won", () => {
    expect(describeWinner({ ...state, winner: null })).toBe("A draw");
  });
});
