import { createRng, legalMoves, pick, type GameState, type Move } from "@/engine";
import type { Ai } from "./types";

/**
 * Picks uniformly from the legal moves. Deliberately terrible, and the
 * yardstick every real AI has to beat.
 *
 * It keeps its own RNG rather than drawing from `state.rng`, so thinking does
 * not perturb the dice. Seeded, so a given AI plays the same game twice.
 */
export function createRandomAi(seed = 1): Ai {
  let rng = createRng(seed);

  return {
    name: "Random",
    chooseMove(state: GameState): Move {
      const moves = legalMoves(state);
      if (moves.length === 0) {
        throw new Error("No legal moves available");
      }
      const [move, next] = pick(moves, rng);
      rng = next;
      return move;
    },
  };
}
