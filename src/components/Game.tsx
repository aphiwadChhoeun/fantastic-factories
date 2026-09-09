"use client";

import { useMemo, useState } from "react";
import { PHASE_LABELS, type Move } from "@/engine";
import { useGame } from "@/hooks/useGame";
import { indexMoves, paymentOf, paymentsFor } from "@/lib/board";
import { describeMove } from "@/lib/format";
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

/**
 * A choice in progress, as the parts of it settled so far. Held as ids rather
 * than as moves so that every render can re-check it against the live move
 * list: a card that has been taken, or a die that has been spent, simply stops
 * being a choice.
 */
type Pending = {
  /** The card clicked, or dropped on. */
  readonly cardId: string;
  /** The die dropped on it, when the choice started with a drag. */
  readonly dieId?: string;
  /** The blueprint being discarded to pay, once that much is settled. */
  readonly paymentCardId?: string;
};

export function Game() {
  const [seed, setSeed] = useState(DEFAULT_SEED);
  const { state, moves, active, isAiTurn, play, reset } = useGame(seed);

  const [pending, setPending] = useState<Pending | null>(null);
  const [dragged, setDragged] = useState<string | null>(null);

  const board = useMemo(() => indexMoves(moves, active.dice), [moves, active.dice]);
  const playable = !state.gameOver && !isAiTurn;

  /** Every move that still fits a choice: taking a card, building, working. */
  function optionsFor(choice: Pending): readonly Move[] {
    // A card in hand can be over the limit and buildable at the same time, so
    // the sources are gathered rather than the first one winning.
    const all = choice.dieId
      ? (board.dice.get(choice.dieId)?.activations.get(choice.cardId) ?? [])
      : [
          ...(board.takes.get(choice.cardId) ?? []),
          ...(board.builds.get(choice.cardId) ?? []),
          ...(board.discards.cards.get(choice.cardId) ?? []),
          ...(board.freeActivations.get(choice.cardId) ?? []),
        ];
    return choice.paymentCardId
      ? all.filter((move) => paymentOf(move) === choice.paymentCardId)
      : all;
  }

  const options = pending ? optionsFor(pending) : [];
  // A choice stands only while more than one move still fits it, so one that
  // has been settled — or overtaken — needs no clearing.
  const choice = options.length > 1 ? pending : null;
  const dragging = dragged && board.dice.has(dragged) ? dragged : null;

  const payers = new Set(
    options.map(paymentOf).filter((cardId): cardId is string => cardId !== undefined),
  );
  // With several blueprints in hand that could pay, the hand is the next
  // question. Anything still open after that is spelled out as buttons —
  // which resources the Black Market pays, or which run works an Assembly Line.
  const payments = choice && payers.size > 1 ? paymentsFor(options) : null;
  // A move that spends no card cannot be picked by highlighting one, so it is
  // always spelled out. That is what keeps "discard this card" reachable on a
  // card you could also build, where the rest of the options want a payment.
  const open = choice ? (payments ? options.filter((move) => !paymentOf(move)) : options) : [];
  const choices = open.map((move) => ({ move, label: describeMove(state, move) }));

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

  /** Plays a choice the moment only one move fits it, and otherwise asks on. */
  function resolve(next: Pending) {
    const fitting = optionsFor(next);
    if (fitting.length === 0) return;

    setPending(fitting.length === 1 ? null : next);
    if (fitting.length === 1) play(fitting[0]);
  }

  /**
   * A blueprint in the row is taken outright. Taking a contractor, building a
   * blueprint and feeding the Black Market all cost a card discarded from
   * hand: with one candidate that is unambiguous, with several the player
   * picks, and clicking the card being paid for again backs out.
   */
  function selectCard(cardId: string) {
    if (choice?.cardId === cardId) {
      setPending(null);
      return;
    }

    // Mid-choice, a click in hand names the payment rather than starting over.
    if (choice && payments?.has(cardId)) {
      resolve({ ...choice, paymentCardId: cardId });
      return;
    }
    resolve({ cardId });
  }

  const marketInteraction: MarketInteraction | undefined = playable
    ? {
        takeable: new Set(board.takes.keys()),
        choosingPaymentFor: choice?.cardId ?? null,
        onSelect: selectCard,
      }
    : undefined;

  function panelFor(playerIndex: number): PanelInteraction | undefined {
    if (!playable || playerIndex !== state.currentPlayerIndex) return undefined;
    return {
      movableDice: new Set(board.dice.keys()),
      dragging,
      onDragChange: setDragged,
      targets: dragging ? (board.dice.get(dragging) ?? null) : null,
      buildable: new Set(board.builds.keys()),
      freeActivations: board.freeActivations,
      discardable: new Set(board.discards.cards.keys()),
      discards: board.discards.resources.map((move) => ({
        move,
        label: describeMove(state, move),
      })),
      payments,
      choices,
      pending: choice?.cardId ?? null,
      onSelectCard: selectCard,
      onDropDie: (cardId: string) => {
        if (dragging) resolve({ cardId, dieId: dragging });
      },
      onPlay: (move: Move) => {
        setPending(null);
        play(move);
      },
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
