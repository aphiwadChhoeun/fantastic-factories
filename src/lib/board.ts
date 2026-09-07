/**
 * Legal moves, re-indexed for direct manipulation.
 *
 * `legalMoves` is a flat list, which suits a list of buttons. A board needs the
 * opposite question answered: given this card, or this die, what can I do with
 * it? Everything here is derived — the engine stays the only source of truth
 * about what is legal.
 */

import type { HqSectionId, Move } from "@/engine";

/** Where one die may go, by the id of the thing it would land on. */
export type DieTargets = {
  /** Headquarters section id -> the placement. */
  readonly sections: ReadonlyMap<HqSectionId, Move>;
  /** Hand card id -> the build. */
  readonly builds: ReadonlyMap<string, Move>;
  /** Compound card id -> the activation. */
  readonly activations: ReadonlyMap<string, Move>;
};

export type BoardMoves = {
  /**
   * Market card id -> the moves that take it. A blueprint has exactly one; a
   * contractor has one per blueprint in hand that could pay for it, which is
   * why this is a list and not a move.
   */
  readonly takes: ReadonlyMap<string, readonly Move[]>;
  /** Die id -> where that die can go. */
  readonly dice: ReadonlyMap<string, DieTargets>;
};

const NO_TARGETS: DieTargets = {
  sections: new Map(),
  builds: new Map(),
  activations: new Map(),
};

function targetsFor(dice: Map<string, DieTargets>, dieId: string): DieTargets {
  const existing = dice.get(dieId);
  if (existing) return existing;

  const fresh: DieTargets = { sections: new Map(), builds: new Map(), activations: new Map() };
  dice.set(dieId, fresh);
  return fresh;
}

export function indexMoves(moves: readonly Move[]): BoardMoves {
  const takes = new Map<string, Move[]>();
  const dice = new Map<string, DieTargets>();

  for (const move of moves) {
    switch (move.type) {
      case "draft": {
        const options = takes.get(move.cardId);
        if (options) options.push(move);
        else takes.set(move.cardId, [move]);
        break;
      }
      case "placeDie":
        (targetsFor(dice, move.dieId).sections as Map<HqSectionId, Move>).set(move.section, move);
        break;
      case "build":
        (targetsFor(dice, move.dieId).builds as Map<string, Move>).set(move.cardId, move);
        break;
      case "activate":
        (targetsFor(dice, move.dieId).activations as Map<string, Move>).set(move.cardId, move);
        break;
      default:
        // rollDice, setDie and endPhase have nothing on the board to point at.
        break;
    }
  }

  return { takes, dice };
}

/** The payment options on a contractor's take moves, by hand card id. */
export function paymentsFor(options: readonly Move[]): ReadonlyMap<string, Move> {
  const payments = new Map<string, Move>();
  for (const move of options) {
    if (move.type === "draft" && move.kind === "contractor") {
      payments.set(move.paymentCardId, move);
    }
  }
  return payments;
}

export { NO_TARGETS };
