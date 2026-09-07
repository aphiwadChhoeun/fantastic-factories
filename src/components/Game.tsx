"use client";

import { useMemo, useState } from "react";
import { PHASE_LABELS, type Move } from "@/engine";
import { useGame } from "@/hooks/useGame";
import { indexMoves, paymentsFor } from "@/lib/board";
import { GameLog } from "./GameLog";
import { Marketplace, type MarketInteraction } from "./Marketplace";
import { MoveList } from "./MoveList";
import { PlayerPanel, type PanelInteraction } from "./PlayerPanel";
import styles from "./game.module.css";

/**
 * Fixed so the server-rendered HTML and the first client render agree. A new
 * seed only ever comes from a click, which happens after hydration.
 */
const DEFAULT_SEED = 1;

export function Game() {
  const [seed, setSeed] = useState(DEFAULT_SEED);
  const { state, moves, active, isAiTurn, play, reset } = useGame(seed);

  /** The contractor waiting on a payment, once one has been clicked. */
  const [chosen, setChosen] = useState<string | null>(null);
  const [dragged, setDragged] = useState<string | null>(null);

  const board = useMemo(() => indexMoves(moves), [moves]);
  const playable = !state.gameOver && !isAiTurn;

  // Both selections are checked against the current move list rather than
  // cleared when it changes: a card that has been taken, or a die that has
  // been spent, simply stops being selected.
  const choosingPaymentFor = chosen && (board.takes.get(chosen)?.length ?? 0) > 1 ? chosen : null;
  const dragging = dragged && board.dice.has(dragged) ? dragged : null;

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

  /**
   * A blueprint is taken outright. A contractor needs a blueprint discarded as
   * payment: with one candidate that is unambiguous, with several the player
   * picks, and clicking the contractor again backs out.
   */
  function selectMarketCard(cardId: string) {
    const options = board.takes.get(cardId) ?? [];
    if (options.length === 0) return;
    if (options.length === 1) {
      play(options[0]);
      return;
    }
    setChosen(choosingPaymentFor === cardId ? null : cardId);
  }

  const marketInteraction: MarketInteraction | undefined = playable
    ? {
        takeable: new Set(board.takes.keys()),
        choosingPaymentFor,
        onSelect: selectMarketCard,
      }
    : undefined;

  const payments = choosingPaymentFor
    ? paymentsFor(board.takes.get(choosingPaymentFor) ?? [])
    : null;

  function panelFor(playerIndex: number): PanelInteraction | undefined {
    if (!playable || playerIndex !== state.currentPlayerIndex) return undefined;
    return {
      movableDice: new Set(board.dice.keys()),
      dragging,
      onDragChange: setDragged,
      targets: dragging ? (board.dice.get(dragging) ?? null) : null,
      payments,
      onPlay: (move: Move) => play(move),
    };
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Fantastic Factories</h1>
        <span className={styles.status}>{status}</span>
      </header>

      <div className={styles.columns}>
        <div className={styles.stack}>
          <Marketplace
            contractors={state.contractors}
            blueprints={state.blueprints}
            interaction={marketInteraction}
          />
          {state.players.map((player, index) => (
            <PlayerPanel
              key={player.id}
              player={player}
              active={!state.gameOver && index === state.currentPlayerIndex}
              hideHand={player.isAi}
              interaction={panelFor(index)}
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
