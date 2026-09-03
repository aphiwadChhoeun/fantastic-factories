"use client";

import { useState } from "react";
import { PHASE_LABELS } from "@/engine";
import { useGame } from "@/hooks/useGame";
import { GameLog } from "./GameLog";
import { Marketplace } from "./Marketplace";
import { MoveList } from "./MoveList";
import { PlayerPanel } from "./PlayerPanel";
import styles from "./game.module.css";

/**
 * Fixed so the server-rendered HTML and the first client render agree. A new
 * seed only ever comes from a click, which happens after hydration.
 */
const DEFAULT_SEED = 1;

export function Game() {
  const [seed, setSeed] = useState(DEFAULT_SEED);
  const { state, moves, active, isAiTurn, play, reset } = useGame(seed);

  const status = state.gameOver
    ? state.winner === null
      ? "Game over — a draw"
      : `Game over — ${state.players[state.winner].name} wins`
    : `Round ${state.round} · ${PHASE_LABELS[state.phase]} · ${active.name} to act`;

  function newGame() {
    const next = seed + 1;
    setSeed(next);
    reset(next);
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Fantastic Factories</h1>
        <span className={styles.status}>{status}</span>
      </header>

      <div className={styles.columns}>
        <div className={styles.stack}>
          <Marketplace contractors={state.contractors} blueprints={state.blueprints} />
          {state.players.map((player, index) => (
            <PlayerPanel
              key={player.id}
              player={player}
              active={!state.gameOver && index === state.currentPlayerIndex}
              hideHand={player.isAi}
            />
          ))}
        </div>

        <div className={styles.stack}>
          <MoveList state={state} moves={moves} waiting={isAiTurn} onPlay={play} />
          <button type="button" className={styles.resetButton} onClick={newGame}>
            New game (seed {seed + 1})
          </button>
          <GameLog entries={state.log} />
        </div>
      </div>
    </main>
  );
}
