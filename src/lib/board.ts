/**
 * Legal moves, re-indexed for direct manipulation.
 *
 * `legalMoves` is a flat list, which suits a list of buttons. A board needs the
 * opposite question answered: given this card, or this die, what can I do with
 * it? Everything here is derived — the engine stays the only source of truth
 * about what is legal.
 */

import type { Die, HqSectionId, Move } from "@/engine";

/** Where one die may go, by the id of the thing it would land on. */
export type DieTargets = {
  /** Headquarters section id -> the placement. */
  readonly sections: ReadonlyMap<HqSectionId, Move>;
  /**
   * Compound card id -> the activations this die takes part in. A perk that
   * wants two dice appears under both of them, and playing it spends both.
   *
   * A list rather than a move, because a perk can want more than dice: the
   * Black Market offers one activation per blueprint in hand it could eat.
   */
  readonly activations: ReadonlyMap<string, readonly Move[]>;
};

export type BoardMoves = {
  /**
   * Market card id -> the moves that take it. A blueprint has exactly one; a
   * contractor has one per blueprint in hand that could pay for it, which is
   * why this is a list and not a move.
   */
  readonly takes: ReadonlyMap<string, readonly Move[]>;
  /**
   * Hand card id -> the moves that build it, one per blueprint that could be
   * discarded to pay. Building takes no die, so it is not a drag target.
   */
  readonly builds: ReadonlyMap<string, readonly Move[]>;
  /**
   * Compound card id -> a perk that takes no dice off the table at all. There
   * is nothing to drag onto it, so it is clicked instead.
   *
   * A list, because such a perk can still offer a choice: the Golem sells a
   * die at any face the energy stretches to.
   */
  readonly freeActivations: ReadonlyMap<string, readonly Move[]>;
  /**
   * Compound card id -> the activations that work a market card instead of
   * this one — the Replicator. Clicked, whether or not the copied perk wants
   * dice, because the question they ask first is *which card*, and that is
   * answered by pointing at the row.
   *
   * Kept out of `freeActivations` so no move is in both: a borrowing move
   * that wants dice is still a drop target under each of them.
   */
  readonly copies: ReadonlyMap<string, readonly Move[]>;
  /** Die id -> where that die can go. */
  readonly dice: ReadonlyMap<string, DieTargets>;
  /**
   * Forced by the end-of-phase limits, and empty the rest of the time. The
   * resource ones have nothing on the board to point at, so they are buttons;
   * a card discard is a click on the card, like a build.
   */
  readonly discards: {
    readonly resources: readonly Move[];
    readonly cards: ReadonlyMap<string, readonly Move[]>;
  };
};

const NO_TARGETS: DieTargets = { sections: new Map(), activations: new Map() };

function targetsFor(dice: Map<string, DieTargets>, dieId: string): DieTargets {
  const existing = dice.get(dieId);
  if (existing) return existing;

  const fresh: DieTargets = { sections: new Map(), activations: new Map() };
  dice.set(dieId, fresh);
  return fresh;
}

function push(index: Map<string, Move[]>, key: string, move: Move): void {
  const options = index.get(key);
  if (options) options.push(move);
  else index.set(key, [move]);
}

export function indexMoves(moves: readonly Move[], rolled: readonly Die[] = []): BoardMoves {
  const takes = new Map<string, Move[]>();
  const builds = new Map<string, Move[]>();
  const freeActivations = new Map<string, Move[]>();
  const copies = new Map<string, Move[]>();
  const dice = new Map<string, DieTargets>();
  const discardResources: Move[] = [];
  const discardCards = new Map<string, Move[]>();
  const faces = new Map(rolled.map((die) => [die.id, die.face]));

  for (const move of moves) {
    switch (move.type) {
      case "draft":
        push(takes, move.cardId, move);
        break;
      case "build":
        push(builds, move.cardId, move);
        break;
      case "discard":
        if (move.kind === "card") push(discardCards, move.cardId, move);
        else discardResources.push(move);
        break;
      case "placeDie":
        (targetsFor(dice, move.dieId).sections as Map<HqSectionId, Move>).set(move.section, move);
        break;
      case "activate": {
        // A perk that changes dice names them without spending them, so those
        // — not the empty `dieIds` — are what get dropped on the card.
        const named = move.targetDieIds ?? [];
        const involved = named.length > 0 ? named : move.dieIds;
        // Copying is always a click first: the card to copy has to be named
        // before there is anything to say about dice.
        if (move.borrowCardId !== undefined) push(copies, move.cardId, move);
        else if (involved.length === 0) push(freeActivations, move.cardId, move);
        // Nothing on the table to point at, so there is no drag to index.
        if (involved.length === 0) break;
        // A perk only ever reads faces, so two dice showing the same number are
        // interchangeable in it. The engine enumerates one move per face rather
        // than one per pair, so index it under every die that could stand in —
        // otherwise the third of three matching dice looks inert on the card.
        const wanted = new Set(involved.map((id) => faces.get(id)));
        const standIns = rolled.filter((die) => !die.spent && wanted.has(die.face));
        const targets = standIns.length > 0 ? standIns.map((die) => die.id) : involved;
        for (const dieId of targets) {
          push(targetsFor(dice, dieId).activations as Map<string, Move[]>, move.cardId, move);
        }
        break;
      }
      default:
        // rollDice, setDie and endPhase have nothing on the board to point at.
        break;
    }
  }

  return {
    takes,
    builds,
    freeActivations,
    copies,
    dice,
    discards: { resources: discardResources, cards: discardCards },
  };
}

/** The face-up blueprint a move copies, if it copies one. */
export function borrowOf(move: Move): string | undefined {
  return move.type === "activate" ? move.borrowCardId : undefined;
}

/**
 * Whether any of these moves works a card in the row — the question the board
 * has to put to the player before it puts any other.
 */
export function needsBorrow(options: readonly Move[]): boolean {
  return options.some((move) => borrowOf(move) !== undefined);
}

/**
 * The face-up blueprints that could answer a pending choice, by card id —
 * which card the Replicator copies. Shaped like `paymentsFor`, because it is
 * the same question asked of the row instead of the hand.
 */
export function borrowsFor(options: readonly Move[]): ReadonlyMap<string, readonly Move[]> {
  const borrows = new Map<string, Move[]>();
  for (const move of options) {
    const cardId = borrowOf(move);
    if (cardId) push(borrows, cardId, move);
  }
  return borrows;
}

/**
 * The blueprints a move spends out of hand. Usually none or one — the
 * Recycling Plant is the card that eats two.
 */
export function paymentsOf(move: Move): readonly string[] {
  switch (move.type) {
    case "draft":
      return move.kind === "contractor" ? [move.paymentCardId] : [];
    case "build":
      return [move.paymentCardId];
    case "activate":
      return move.paymentCardIds ?? [];
    default:
      return [];
  }
}

/**
 * The blueprints in hand that could pay for a pending choice, by card id.
 * Taking a contractor, building a blueprint and feeding the Black Market all
 * cost a card from hand, so all three go through here.
 *
 * A list per card, because paying with it need not settle everything: the
 * Black Market still has to be told which resources to take for it, and the
 * Recycling Plant wants a second card.
 *
 * `settled` names the cards already picked, which drop out — they are behind
 * the player rather than in front of them.
 */
export function paymentsFor(
  options: readonly Move[],
  settled: readonly string[] = [],
): ReadonlyMap<string, readonly Move[]> {
  const already = new Set(settled);
  const payments = new Map<string, Move[]>();
  for (const move of options) {
    for (const cardId of paymentsOf(move)) {
      if (!already.has(cardId)) push(payments, cardId, move);
    }
  }
  return payments;
}

export { NO_TARGETS };
