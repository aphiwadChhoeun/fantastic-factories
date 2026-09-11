"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createRandomAi } from "@/ai";
import {
  applyMove,
  createInitialState,
  currentPlayer,
  legalMoves,
  type GameState,
  type Move,
} from "@/engine";
import { loadGame, saveGame, type SavedGame } from "@/lib/storage";

/**
 * Pause before the AI acts, so a human can follow what happened.
 *
 * Long enough to outlast the board's own animations — a card drafted out of
 * the market is still travelling at 450ms, and playing over the top of it
 * re-renders the board out from under a move the player has not finished
 * watching. See docs/motion.md.
 */
const AI_THINK_MS = 720;

function freshGame(seed: number): SavedGame {
  return { seed, state: createInitialState({ seed }) };
}

/**
 * The game, and everything the board needs to drive it.
 *
 * The seed is held here rather than by the caller because a save is the two
 * together: a state restored beside the wrong seed would deal a different
 * game the moment anything reached for the deck.
 */
export function useGame(initialSeed: number) {
  // Read during the first render rather than in an effect. That is safe only
  // because `useMounted` keeps the board off the screen until the second
  // render — see the note there.
  const [game, setGame] = useState<SavedGame>(() => loadGame() ?? freshGame(initialSeed));
  const { seed, state } = game;

  // Offset the AI's seed so it does not march in lockstep with the dice.
  const ai = useMemo(() => createRandomAi(seed + 1000), [seed]);

  const moves = useMemo(() => legalMoves(state), [state]);
  const active = currentPlayer(state);
  const isAiTurn = !state.gameOver && active.isAi;

  // Every state the game passes through is written, so a refresh at any moment
  // comes back where it left off.
  useEffect(() => {
    saveGame(game);
  }, [game]);

  const play = useCallback((move: Move) => {
    setGame((current) => ({ ...current, state: applyMove(current.state, move) }));
  }, []);

  const reset = useCallback((nextSeed: number) => setGame(freshGame(nextSeed)), []);

  /**
   * Writes state without going through a move. The debug tools in `src/dev`
   * are the only caller, and they are compiled out of a production build —
   * nothing in the game itself may use this.
   */
  const debug = useCallback(
    (update: (current: GameState) => GameState) =>
      setGame((current) => ({ ...current, state: update(current.state) })),
    [],
  );

  useEffect(() => {
    if (!isAiTurn) return;
    // The move is chosen outside the updater: `chooseMove` advances the AI's
    // own RNG, and React may invoke an updater more than once.
    const timer = setTimeout(
      () => setGame({ seed, state: applyMove(state, ai.chooseMove(state)) }),
      AI_THINK_MS,
    );
    return () => clearTimeout(timer);
  }, [isAiTurn, seed, state, ai]);

  return { seed, state, moves, active, isAiTurn, play, reset, debug };
}
