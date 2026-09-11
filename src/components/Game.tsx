"use client";

import { useCallback, useMemo, useState } from "react";
import { domMax, LazyMotion, MotionConfig } from "motion/react";
import { PHASE_LABELS, type Move } from "@/engine";
import { DEV_TOOLS } from "@/dev/flag";
import { burstFromCard, burstFromHq } from "@/effects/cardBurst";
import { EmbersLayer } from "@/effects/EmbersLayer";
import { useFlashes } from "@/hooks/useFlashes";
import { useGame } from "@/hooks/useGame";
import { useGameEvents } from "@/hooks/useGameEvents";
import { useMounted } from "@/hooks/useMounted";
import type { GameEvent } from "@/lib/events";
import {
  borrowOf,
  borrowsFor,
  indexMoves,
  needsBorrow,
  paymentsFor,
  paymentsOf,
} from "@/lib/board";
import { describeMove, describeWinner } from "@/lib/format";
import { DevPanel } from "./DevPanel";
import { GameLog } from "./GameLog";
import { GameOver } from "./GameOver";
import { Marketplace, type MarketInteraction } from "./Marketplace";
import { MoveList } from "./MoveList";
import { PlateButton } from "./PlateButton";
import { PlayerPanel, type PanelInteraction } from "./PlayerPanel";
import styles from "./game.module.css";

/** What a first-time visitor is dealt. Every later seed comes from a click. */
const DEFAULT_SEED = 1;

/** How long a card stays lit after it is built, or after its perk fires. */
const FLASH_MS = 500;

/**
 * How long a card counts as having just arrived somewhere. Roughly as long as
 * the travel itself takes, so the lean unwinds as the card settles.
 */
const ARRIVE_MS = 440;

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
  /**
   * The face-up blueprint being copied, once that much is settled — clicking
   * the Replicator asks the row before it asks anything else.
   */
  readonly borrowCardId?: string;
  /**
   * The blueprints picked out of hand to pay with so far, in click order. A
   * list because a perk can eat more than one, and the player names them one
   * at a time — the Recycling Plant wants two.
   */
  readonly paying?: readonly string[];
};

export function Game() {
  const { seed, state, moves, active, isAiTurn, play, reset, debug } = useGame(DEFAULT_SEED);

  const [pending, setPending] = useState<Pending | null>(null);
  const [dragged, setDragged] = useState<string | null>(null);
  /**
   * Whether the result has been waved away. Not saved with the game: coming
   * back to a finished one should show how it went, not assume you remember.
   */
  const [resultHidden, setResultHidden] = useState(false);

  const board = useMemo(() => indexMoves(moves, active.dice), [moves, active.dice]);
  const mounted = useMounted();
  const playable = !state.gameOver && !isAiTurn;

  /**
   * Cards lit by whatever the last move did. The engine says only what the
   * board *is*; `useGameEvents` works out what happened to it, which is the
   * difference between a card that is standing and a card that just went up.
   */
  const [flashing, flash] = useFlashes(FLASH_MS);
  /**
   * Cards that have just changed hands, which is the one thing a card cannot
   * work out for itself: crossing from the market to a hand unmounts it and
   * mounts a new one, so the arriving component has no memory of the journey.
   * Held here, where it outlives both.
   */
  const [arriving, arrive] = useFlashes(ARRIVE_MS);

  const onEvent = useCallback(
    (event: GameEvent) => {
      if (event.kind === "built" || event.kind === "produced") flash(event.cardId);
      if (event.kind === "built" || event.kind === "drafted") arrive(event.cardId);
      // Sparks off a factory that has just paid out, and off a slot a die has
      // just been struck into. Fire-and-forget: with the canvas switched off,
      // still loading, or gone for reduced motion, the burst is dropped and
      // nothing here has to know.
      if (event.kind === "produced") burstFromCard(event.cardId, event.goods);
      if (event.kind === "placed") burstFromHq(event.section);
    },
    [flash, arrive],
  );
  useGameEvents(state, seed, onEvent);

  // The board a refresh restores is not the board the build prerendered, so
  // nothing of it is drawn until the two can no longer disagree.
  if (!mounted) {
    return (
      <main className={styles.page}>
        <header className={styles.header}>
          <h1 className={styles.title}>Fantastic Factories</h1>
          <span className={styles.status}>Dealing…</span>
        </header>
      </main>
    );
  }

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
          ...(board.copies.get(choice.cardId) ?? []),
        ];
    // A move fits only if it settles the same way: the card being copied, and
    // everything picked out of hand. Each click narrows the field rather than
    // replacing the last answer.
    const paying = choice.paying ?? [];
    return all.filter((move) => {
      if (choice.borrowCardId && borrowOf(move) !== choice.borrowCardId) return false;
      const spends = paymentsOf(move);
      return paying.every((cardId) => spends.includes(cardId));
    });
  }

  const options = pending ? optionsFor(pending) : [];
  // Which card to copy comes first: until the Replicator has been told, there
  // is nothing to say about the dice or the price, since both are that card's.
  //
  // Asked even when only one card could answer it. Everywhere else a lone
  // option settles itself, but working a card in the row is the whole of the
  // Replicator, and firing it off without showing which card would leave the
  // player with no idea what just happened.
  const asksRow = pending !== null && !pending.borrowCardId && needsBorrow(options);
  // A choice otherwise stands only while more than one move still fits it, so
  // one that has been settled — or overtaken — needs no clearing.
  const choice = options.length > 1 || (asksRow && options.length > 0) ? pending : null;
  const dragging = dragged && board.dice.has(dragged) ? dragged : null;

  const settled = pending?.paying ?? [];
  const borrowers = borrowsFor(options);
  const borrowing = choice && asksRow ? borrowers : null;
  const payers = paymentsFor(options, settled);
  // With several blueprints in hand that could pay, the hand is the next
  // question. Anything still open after that is spelled out as buttons —
  // which resources the Black Market pays, or which run works an Assembly Line.
  const payments = choice && !borrowing && payers.size > 1 ? payers : null;
  // A move that cannot be picked by pointing at the card being asked for is
  // always spelled out instead. That is what keeps "discard this card"
  // reachable on a card you could also build, where the rest of the options
  // want a payment.
  const open = choice
    ? borrowing
      ? options.filter((move) => borrowOf(move) === undefined)
      : payments
        ? options.filter((move) => paymentsOf(move).length === settled.length)
        : options
    : [];
  const choices = open.map((move) => ({ move, label: describeMove(state, move) }));

  // Worth saying loudly: what is worth doing changes completely once there is
  // only one round left to do it in.
  const lastRound = !state.gameOver && state.finalRound === state.round;
  const status = state.gameOver
    ? `Game over · ${describeWinner(state)}`
    : `Round ${state.round}${lastRound ? " (last)" : ""} · ${PHASE_LABELS[state.phase]} · ` +
      `${active.name} to act`;

  function newGame() {
    setPending(null);
    setResultHidden(false);
    reset(seed + 1);
  }

  /** Plays a choice the moment only one move fits it, and otherwise asks on. */
  function resolve(next: Pending) {
    const fitting = optionsFor(next);
    if (fitting.length === 0) return;

    // Except a copy, which shows the row first however few cards are on it.
    const done = fitting.length === 1 && !(!next.borrowCardId && needsBorrow(fitting));
    setPending(done ? null : next);
    if (done) play(fitting[0]);
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

    // Mid-choice, a click in the row names the card being copied.
    if (choice && borrowing?.has(cardId)) {
      resolve({ ...choice, borrowCardId: cardId });
      return;
    }
    // And a click in hand names a payment rather than starting over. Cards add
    // up: a perk that eats two is fed one click at a time.
    if (choice && payments?.has(cardId)) {
      resolve({ ...choice, paying: [...(choice.paying ?? []), cardId] });
      return;
    }
    resolve({ cardId });
  }

  const marketInteraction: MarketInteraction | undefined = playable
    ? {
        takeable: new Set(board.takes.keys()),
        copyable: new Set(borrowing?.keys() ?? []),
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
      // A card is clicked to work it either because nothing is placed on it,
      // or because it copies and has to be asked what.
      workable: new Set([...board.freeActivations.keys(), ...board.copies.keys()]),
      discardable: new Set(board.discards.cards.keys()),
      discards: board.discards.resources.map((move) => ({
        move,
        label: describeMove(state, move),
      })),
      payments,
      spending: new Set(choice ? settled : []),
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
    /*
     * `domMax` rather than `domAnimation` because the board needs layout
     * animation and gestures, not just tweens; `strict` turns reaching for the
     * eagerly-loaded `motion` components into a build error rather than a
     * silent few kilobytes.
     *
     * `reducedMotion="user"` is the whole accessibility story for every
     * animation below this point, in one attribute.
     */
    <LazyMotion features={domMax} strict>
      <MotionConfig reducedMotion="user">
        {/*
          * While a choice is open, the board narrows to the cards that could
          * answer it — see the focus pull in game.module.css. The state is
          * already here; this only has to say so out loud.
          */}
        <main className={styles.page} data-choosing={choice ? "true" : undefined}>
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
                  market={state.blueprints.row}
                  flashing={flashing}
                  arriving={arriving}
                  interaction={panelFor(index)}
                />
              ))}
            </div>

            <div className={styles.stack}>
              <MoveList state={state} moves={moves} waiting={isAiTurn} onPlay={play} />
              {/*
                * The way back to a result that has been waved away. Only there
                * once there is one, and only while it is hidden — the dialog is
                * modal, so while it is up this button could not be clicked anyway.
                */}
              {state.gameOver && resultHidden && (
                <PlateButton full onClick={() => setResultHidden(false)}>
                  Show result
                </PlateButton>
              )}
              <PlateButton full onClick={newGame}>
                New game (seed {seed + 1})
              </PlateButton>
              {/* Folds to `false` in a production build, and the panel goes with it. */}
              {DEV_TOOLS && <DevPanel debug={debug} />}
              <GameLog entries={state.log} />
            </div>
          </div>

          {state.gameOver && !resultHidden && (
            <GameOver
              state={state}
              nextSeed={seed + 1}
              onNewGame={newGame}
              onDismiss={() => setResultHidden(true)}
            />
          )}

          {/*
            * Last, and `position: fixed`, so it covers the board rather than
            * taking a place in it. Nothing above it in this tree can see that
            * it is a WebGL canvas, and with the flag off it is not one.
            */}
          <EmbersLayer />
        </main>
      </MotionConfig>
    </LazyMotion>
  );
}
