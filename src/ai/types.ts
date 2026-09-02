import type { GameState, Move } from "@/engine";

/**
 * The whole surface an opponent has to implement.
 *
 * Swapping the random baseline for a heuristic, an MCTS search, or a scripted
 * bot means writing one more file that satisfies this — nothing else changes.
 * `chooseMove` must return a move from `legalMoves(state)`.
 */
export type Ai = {
  readonly name: string;
  chooseMove(state: GameState): Move;
};
