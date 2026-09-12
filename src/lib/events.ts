/**
 * What just happened, worked out by comparing two states.
 *
 * `applyMove` is a pure transition: it hands back a new board and says nothing
 * about the verb that produced it. Animation needs the verb — a card that
 * *moved* looks nothing like a card that is merely somewhere new — so rather
 * than teach the engine about presentation, the difference is read off the two
 * boards on the way past. The engine stays the only source of truth, and it
 * still does not know an animation exists.
 *
 * Derived, like everything else in here. Nothing below is stored.
 */

import { HQ_SECTION_IDS, type DieFace, type GameState, type HqSectionId, type Phase } from "@/engine";

export type GameEvent =
  /** A card left the market and is now in a hand. */
  | { readonly kind: "drafted"; readonly cardId: string; readonly playerIndex: number }
  /** A blueprint is standing in a compound that was not standing before. */
  | { readonly kind: "built"; readonly cardId: string; readonly playerIndex: number }
  /**
   * A die was stood up on a Headquarters section.
   *
   * The face comes with it because it is the part a player watches: matching
   * faces on one section pay a bonus, so which number landed is the news.
   */
  | {
      readonly kind: "placed";
      readonly playerIndex: number;
      readonly section: HqSectionId;
      readonly face: DieFace;
    }
  /** A perk was worked. What it paid out comes with it. */
  | {
      readonly kind: "produced";
      readonly cardId: string;
      readonly playerIndex: number;
      readonly goods: number;
      /**
       * Whether a die was struck into the card to work it, rather than the
       * perk being clicked. It is the difference between one gesture and two:
       * a die landing and a factory firing at the same instant are two
       * animations that happen to be adjacent, so a landing gets the charge
       * between them and a click does not. See docs/dice.md §3.
       */
      readonly byDie: boolean;
    }
  /** Stock moved, whatever moved it. Deltas, so a loss is negative. */
  | {
      readonly kind: "gained";
      readonly playerIndex: number;
      readonly metal: number;
      readonly energy: number;
      readonly goods: number;
    }
  | { readonly kind: "turn"; readonly playerIndex: number }
  | { readonly kind: "phase"; readonly phase: Phase };

/** A board, and which deal it belongs to. */
export type Deal = { readonly seed: number; readonly state: GameState };

/**
 * Every event between one deal and the next.
 *
 * Two boards from different seeds are two different games, and the difference
 * between them is not a list of things that happened — it is a new deal. Left
 * unguarded, **New game** reads as the opponent having built its entire
 * opening compound in a single turn, and the board lights up accordingly.
 */
export function diffDeals(before: Deal, after: Deal): readonly GameEvent[] {
  if (before.seed !== after.seed) return [];
  return diffStates(before.state, after.state);
}

/**
 * Every event between one board and the next, in the order a player would say
 * them. Returns nothing at all when the two are the same object, which is the
 * common case — most renders are not moves.
 */
export function diffStates(before: GameState, after: GameState): readonly GameEvent[] {
  if (before === after) return [];

  const events: GameEvent[] = [];

  for (const [playerIndex, now] of after.players.entries()) {
    const was = before.players[playerIndex];
    // A seed change deals a different game; nothing about it is a transition.
    if (!was) continue;

    // Drafting: in hand now, in nobody's hand before. Checked against the
    // whole of the old hand rather than the market, because a card can also
    // arrive from the deck — drawing is not drafting, but both land here, and
    // the market is what tells them apart.
    const heldBefore = new Set(was.hand.map((card) => card.id));
    const marketBefore = new Set([
      ...before.blueprints.row.map((card) => card.id),
      ...before.contractors.slots.flatMap((slot) => (slot.card ? [slot.card.id] : [])),
    ]);
    for (const card of now.hand) {
      if (!heldBefore.has(card.id) && marketBefore.has(card.id)) {
        events.push({ kind: "drafted", cardId: card.id, playerIndex });
      }
    }

    const stoodBefore = new Map(was.compound.map((building) => [building.card.id, building]));
    for (const building of now.compound) {
      const then = stoodBefore.get(building.card.id);
      if (!then) {
        events.push({ kind: "built", cardId: building.card.id, playerIndex });
        continue;
      }
      // `worked` is how a building remembers it has fired this round, so its
      // rising edge is the moment the perk paid out. The falling edge is
      // cleanup, which is not a thing that happened to anyone.
      if (!then.worked && building.worked) {
        events.push({
          kind: "produced",
          cardId: building.card.id,
          playerIndex,
          goods: now.resources.goods - was.resources.goods,
          // Read off the same two buildings rather than remembered from a
          // separate event: whether dice arrived with the firing is a fact
          // about this card between these two boards, and nothing outside
          // has to hold it.
          byDie: building.dice.length > then.dice.length,
        });
      }
    }

    /*
     * Headquarters placements only ever grow within a round: a die stands up
     * and stays up, and the tile is swept between rounds. So a longer list is
     * a placement and a shorter one is that sweep, which is not something a
     * player did — comparing lengths is enough, and comparing faces would
     * wrongly call two dice showing the same number one die.
     *
     * Before the resource delta below, so that "placed a 5 on Generate" comes
     * out ahead of the energy it paid.
     */
    for (const section of HQ_SECTION_IDS) {
      const standing = now.headquarters[section];
      for (let index = was.headquarters[section].length; index < standing.length; index++) {
        events.push({ kind: "placed", playerIndex, section, face: standing[index] });
      }
    }

    const metal = now.resources.metal - was.resources.metal;
    const energy = now.resources.energy - was.resources.energy;
    const goods = now.resources.goods - was.resources.goods;
    if (metal !== 0 || energy !== 0 || goods !== 0) {
      events.push({ kind: "gained", playerIndex, metal, energy, goods });
    }
  }

  if (before.currentPlayerIndex !== after.currentPlayerIndex) {
    events.push({ kind: "turn", playerIndex: after.currentPlayerIndex });
  }
  if (before.phase !== after.phase) {
    events.push({ kind: "phase", phase: after.phase });
  }

  return events;
}
