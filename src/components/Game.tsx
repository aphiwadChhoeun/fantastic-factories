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

  /**
   * The card waiting on a payment, once one has been clicked: a contractor
   * being taken, or a blueprint being built. Both cost a card from hand.
   */
  const [chosen, setChosen] = useState<string | null>(null);
  const [dragged, setDragged] = useState<string | null>(null);

  const board = useMemo(() => indexMoves(moves, active.dice), [moves, active.dice]);
  const playable = !state.gameOver && !isAiTurn;

  /** Every way to pay for `cardId`, whether it is taken or built. */
  const optionsFor = (cardId: string): readonly Move[] =>
    board.takes.get(cardId) ?? board.builds.get(cardId) ?? [];

  // Both selections are checked against the current move list rather than
  // cleared when it changes: a card that has been taken, or a die that has
  // been spent, simply stops being selected.
  const choosingPaymentFor = chosen && optionsFor(chosen).length > 1 ? chosen : null;
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
   * A blueprint in the row is taken outright. Taking a contractor and building
   * a blueprint both cost a card discarded from hand: with one candidate that
   * is unambiguous, with several the player picks, and clicking the card again
   * backs out.
   */
  function selectCard(cardId: string) {
    if (choosingPaymentFor === cardId) {
      setChosen(null);
      return;
    }

    // Mid-choice, a click in hand is the payment rather than a new choice.
    const pending = choosingPaymentFor ? paymentsFor(optionsFor(choosingPaymentFor)) : null;
    const payment = pending?.get(cardId);
    if (payment) {
      setChosen(null);
      play(payment);
      return;
    }

    const options = optionsFor(cardId);
    if (options.length === 0) return;
    if (options.length === 1) {
      play(options[0]);
      return;
    }
    setChosen(cardId);
  }

  const marketInteraction: MarketInteraction | undefined = playable
    ? {
        takeable: new Set(board.takes.keys()),
        choosingPaymentFor,
        onSelect: selectCard,
      }
    : undefined;

  const payments = choosingPaymentFor ? paymentsFor(optionsFor(choosingPaymentFor)) : null;

  function panelFor(playerIndex: number): PanelInteraction | undefined {
    if (!playable || playerIndex !== state.currentPlayerIndex) return undefined;
    return {
      movableDice: new Set(board.dice.keys()),
      dragging,
      onDragChange: setDragged,
      targets: dragging ? (board.dice.get(dragging) ?? null) : null,
      buildable: new Set(board.builds.keys()),
      payments,
      pending: choosingPaymentFor,
      onSelectCard: selectCard,
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
