import { describe, expect, it } from "vitest";
import { createRandomAi } from "@/ai";
import {
  applyMove,
  createInitialState,
  currentPlayer,
  legalMoves,
  MARKETPLACE_SIZE,
  MAX_ROUNDS,
  STARTING_HAND,
  type GameState,
  type Move,
} from "@/engine";

/** Guards against a rules bug turning a test run into an infinite loop. */
const MOVE_LIMIT = 20_000;

function playToEnd(state: GameState, choose: (state: GameState) => Move): GameState {
  let current = state;
  let moves = 0;
  while (!current.gameOver) {
    if (moves++ > MOVE_LIMIT) throw new Error("game exceeded the move limit");
    current = applyMove(current, choose(current));
  }
  return current;
}

/** Always acts if it can, so builds and activations actually get exercised. */
function greedy(state: GameState): Move {
  const moves = legalMoves(state);
  return moves.find((move) => move.type !== "endPhase") ?? moves[0];
}

describe("setup", () => {
  it("deals a hand, a starting building, and a marketplace", () => {
    const state = createInitialState({ seed: 42 });

    expect(state.players).toHaveLength(2);
    expect(state.players[0].isAi).toBe(false);
    expect(state.players[1].isAi).toBe(true);
    expect(state.marketplace).toHaveLength(MARKETPLACE_SIZE);
    for (const player of state.players) {
      expect(player.hand).toHaveLength(STARTING_HAND);
      expect(player.buildings).toHaveLength(1);
    }
  });

  it("is deterministic — one seed always deals the same game", () => {
    expect(createInitialState({ seed: 7 })).toEqual(createInitialState({ seed: 7 }));
  });

  it("deals different games for different seeds", () => {
    const a = createInitialState({ seed: 1 });
    const b = createInitialState({ seed: 2 });
    expect(a.marketplace).not.toEqual(b.marketplace);
  });
});

describe("legalMoves", () => {
  it("offers every market card plus a blind draw during the market phase", () => {
    const state = createInitialState({ seed: 3 });
    const moves = legalMoves(state);

    expect(moves.filter((move) => move.type === "draftFromMarket")).toHaveLength(MARKETPLACE_SIZE);
    expect(moves.filter((move) => move.type === "drawFromDeck")).toHaveLength(1);
  });

  it("requires a roll before anything else in the work phase", () => {
    let state = createInitialState({ seed: 3 });
    state = applyMove(state, { type: "drawFromDeck" }); // player 0
    state = applyMove(state, { type: "drawFromDeck" }); // player 1 — market ends

    expect(state.phase).toBe("work");
    expect(legalMoves(state)).toEqual([{ type: "rollDice" }]);
  });

  it("returns nothing once the game is over", () => {
    const finished = playToEnd(createInitialState({ seed: 5 }), greedy);
    expect(finished.gameOver).toBe(true);
    expect(legalMoves(finished)).toEqual([]);
  });
});

describe("applyMove", () => {
  it("does not mutate the state it was given", () => {
    const state = createInitialState({ seed: 9 });
    const snapshot = structuredClone(state);

    applyMove(state, { type: "drawFromDeck" });

    expect(state).toEqual(snapshot);
  });

  it("moves a drafted card from the marketplace into the hand", () => {
    const state = createInitialState({ seed: 11 });
    const target = state.marketplace[0];

    const next = applyMove(state, { type: "draftFromMarket", cardId: target.id });

    expect(next.marketplace.map((card) => card.id)).not.toContain(target.id);
    expect(next.players[0].hand.map((card) => card.id)).toContain(target.id);
    expect(next.currentPlayerIndex).toBe(1);
  });

  it("rejects a move that is not legal right now", () => {
    const state = createInitialState({ seed: 11 });
    expect(() => applyMove(state, { type: "rollDice" })).toThrow(/work phase/);
  });

  it("rejects drafting a card that is not on the market", () => {
    const state = createInitialState({ seed: 11 });
    expect(() => applyMove(state, { type: "draftFromMarket", cardId: "nope" })).toThrow(/nope/);
  });

  it("replays identically from the same seed and move list", () => {
    const seed = 21;
    const ai = createRandomAi(seed);
    const moves: Move[] = [];

    let state = createInitialState({ seed });
    for (let i = 0; i < 40 && !state.gameOver; i++) {
      const move = ai.chooseMove(state);
      moves.push(move);
      state = applyMove(state, move);
    }

    const replayed = moves.reduce(applyMove, createInitialState({ seed }));
    expect(replayed).toEqual(state);
  });
});

describe("a full game", () => {
  it("terminates under random play without throwing", () => {
    const ai = createRandomAi(99);
    const finished = playToEnd(createInitialState({ seed: 4 }), (state) => ai.chooseMove(state));

    expect(finished.gameOver).toBe(true);
    expect(finished.round).toBeLessThanOrEqual(MAX_ROUNDS + 1);
  });

  it("lets a greedy player build an engine that pays out", () => {
    const finished = playToEnd(createInitialState({ seed: 8 }), greedy);
    const [player] = finished.players;

    expect(player.buildings.length).toBeGreaterThan(1);
    expect(finished.log.filter((line) => line.includes("built")).length).toBeGreaterThan(0);
    expect(finished.log.filter((line) => line.includes("activated")).length).toBeGreaterThan(0);
    // Greedy spends goods the moment it has them, so energy is where the
    // surplus shows up.
    expect(player.resources.energy).toBeGreaterThan(0);
    // Reached a real end condition rather than running into the round cap.
    expect(finished.round).toBeLessThan(MAX_ROUNDS);
  });

  it("names a winner or an explicit draw", () => {
    const finished = playToEnd(createInitialState({ seed: 8 }), greedy);
    expect(finished.winner === null || finished.players[finished.winner]).toBeTruthy();
  });

  it("keeps the player to act consistent with the phase", () => {
    const state = createInitialState({ seed: 13 });
    expect(currentPlayer(state)).toBe(state.players[0]);
  });
});
