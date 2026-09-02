"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createRandomAi } from "@/ai";
import { applyMove, createInitialState, currentPlayer, legalMoves, type Move } from "@/engine";

/** Pause before the AI acts, so a human can follow what happened. */
const AI_THINK_MS = 450;

export function useGame(seed: number) {
  const [state, setState] = useState(() => createInitialState({ seed }));

  // Offset the AI's seed so it does not march in lockstep with the dice.
  const ai = useMemo(() => createRandomAi(seed + 1000), [seed]);

  const moves = useMemo(() => legalMoves(state), [state]);
  const active = currentPlayer(state);
  const isAiTurn = !state.gameOver && active.isAi;

  const play = useCallback((move: Move) => {
    setState((current) => applyMove(current, move));
  }, []);

  const reset = useCallback(
    (nextSeed: number = seed) => setState(createInitialState({ seed: nextSeed })),
    [seed],
  );

  useEffect(() => {
    if (!isAiTurn) return;
    // The move is chosen outside the updater: `chooseMove` advances the AI's
    // own RNG, and React may invoke an updater more than once.
    const timer = setTimeout(() => setState(applyMove(state, ai.chooseMove(state))), AI_THINK_MS);
    return () => clearTimeout(timer);
  }, [isAiTurn, state, ai]);

  return { state, moves, active, isAiTurn, play, reset };
}
