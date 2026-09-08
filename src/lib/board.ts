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
   * Compound card id -> the activation this die takes part in. A perk that
   * wants two dice appears under both of them, and playing it spends both.
   */
  readonly activations: ReadonlyMap<string, Move>;
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
  /** Die id -> where that die can go. */
  readonly dice: ReadonlyMap<string, DieTargets>;
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
  const dice = new Map<string, DieTargets>();
  const faces = new Map(rolled.map((die) => [die.id, die.face]));

  for (const move of moves) {
    switch (move.type) {
      case "draft":
        push(takes, move.cardId, move);
        break;
      case "build":
        push(builds, move.cardId, move);
        break;
      case "placeDie":
        (targetsFor(dice, move.dieId).sections as Map<HqSectionId, Move>).set(move.section, move);
        break;
      case "activate": {
        // A perk only ever reads faces, so two dice showing the same number are
        // interchangeable in it. The engine enumerates one move per face rather
        // than one per pair, so index it under every die that could stand in —
        // otherwise the third of three matching dice looks inert on the card.
        const wanted = new Set(move.dieIds.map((id) => faces.get(id)));
        const standIns = rolled.filter((die) => !die.spent && wanted.has(die.face));
        const targets = standIns.length > 0 ? standIns.map((die) => die.id) : move.dieIds;
        for (const dieId of targets) {
          (targetsFor(dice, dieId).activations as Map<string, Move>).set(move.cardId, move);
        }
        break;
      }
      default:
        // rollDice, setDie and endPhase have nothing on the board to point at.
        break;
    }
  }

  return { takes, builds, dice };
}

/**
 * The blueprints in hand that could pay for a pending choice, by card id.
 * Taking a contractor and building a blueprint both cost a card from hand, so
 * both go through here.
 */
export function paymentsFor(options: readonly Move[]): ReadonlyMap<string, Move> {
  const payments = new Map<string, Move>();
  for (const move of options) {
    if (move.type === "build" || (move.type === "draft" && move.kind === "contractor")) {
      payments.set(move.paymentCardId, move);
    }
  }
  return payments;
}

export { NO_TARGETS };
