/**
 * The automaton opponent.
 *
 * It does not play the game a human plays. It never builds, never spends metal
 * or energy, never holds a card and never touches its Headquarters. It rolls
 * five coloured dice at the top of its turn and reads the whole turn off them:
 * green says what it takes from the market, and the other four say how many
 * goods its compound makes.
 *
 * The pure parts live here — dealing the opening compound, reading the dice,
 * counting and grouping. The state transitions stay in `rules.ts` with every
 * other one, so an automaton turn is still `Move`s through `applyMove` and a
 * seed plus a move list still replays a game exactly.
 */

import {
  AUTOMA_PRODUCTION,
  BLUEPRINT_CATEGORIES,
  type BlueprintCard,
  type BlueprintCategory,
  type Building,
  type Die,
  type DieFace,
} from "./types";

/** Blueprints stood up face-up in front of the automaton at setup. */
export const AUTOMA_COMPOUND_SIZE = 3;

/** What the green die tells the automaton to do with the market. */
export type AutomaMarketAction =
  /** Take the card standing at `index`, counting from the left. */
  | { readonly kind: "takeFromRow"; readonly index: number }
  /** Reveal the top blueprint, then sweep one whole row into its discard. */
  | { readonly kind: "revealAndSweep"; readonly sweep: "blueprints" | "contractors" };

/**
 * 1 to 4 point at the blueprint row, left to right. 5 and 6 both hand the
 * automaton the top of the deck and then clear a row out from under everyone.
 */
export function automaMarketAction(face: DieFace): AutomaMarketAction {
  if (face <= 4) return { kind: "takeFromRow", index: face - 1 };
  return { kind: "revealAndSweep", sweep: face === 5 ? "blueprints" : "contractors" };
}

/**
 * A card stood up in the automaton's compound. It is never built, so it has no
 * dice on it and is never worked — the shape is shared with a real building
 * because everything that reads a compound reads both.
 */
export function standing(card: BlueprintCard): Building {
  return { card, dice: [], worked: false };
}

/**
 * The automaton's compound is kept grouped by type, so what it produces can be
 * counted at a glance. Placeholder blueprints have no printed type and trail
 * the groups; within a group the order cards arrived is kept.
 */
export function groupByCategory(compound: readonly Building[]): Building[] {
  const rank = (building: Building) => {
    const index = building.card.type ? BLUEPRINT_CATEGORIES.indexOf(building.card.type) : -1;
    return index === -1 ? BLUEPRINT_CATEGORIES.length : index;
  };
  return [...compound].sort((a, b) => rank(a) - rank(b));
}

/** Cards of one type standing in a compound. Untyped cards count for nothing. */
export function countByCategory(
  compound: readonly Building[],
  category: BlueprintCategory,
): number {
  return compound.filter((building) => building.card.type === category).length;
}

/**
 * Deals the automaton's opening compound off the top of `draw`, which is left
 * holding whatever was not taken.
 *
 * A Monument dealt here is set aside and another card drawn in its place: the
 * automaton opens with three cards it can actually produce from. Set-aside
 * cards go to the blueprint discard, which is what the caller does with them.
 */
export function dealAutomaCompound(
  draw: BlueprintCard[],
  count: number,
): { compound: Building[]; setAside: BlueprintCard[] } {
  const compound: Building[] = [];
  const setAside: BlueprintCard[] = [];

  while (compound.length < count) {
    const card = draw.shift();
    if (!card) break; // an exhausted deck deals a short compound rather than hanging
    if (card.type === "monument") {
      setAside.push(card);
      continue;
    }
    compound.push(standing(card));
  }

  return { compound: groupByCategory(compound), setAside };
}

/** One die's verdict: what it answers for, and whether it paid. */
export type AutomaPayout = {
  readonly color: Die["color"];
  readonly category: BlueprintCategory;
  readonly face: DieFace;
  /** Cards of that type standing in the compound. */
  readonly standing: number;
  readonly produced: boolean;
};

/**
 * What the automaton's four production dice make of its compound: a die pays a
 * good when its face is at most the number of cards of its own type. So a 1
 * pays off a single card and a 6 needs six.
 *
 * A die whose colour is not on the table — it was spent, or never rolled — is
 * simply not counted.
 */
export function automaPayouts(
  compound: readonly Building[],
  dice: readonly Die[],
): AutomaPayout[] {
  const payouts: AutomaPayout[] = [];

  for (const { color, category } of AUTOMA_PRODUCTION) {
    const die = dice.find((d) => d.color === color && !d.spent);
    if (!die) continue;

    const count = countByCategory(compound, category);
    payouts.push({
      color,
      category,
      face: die.face,
      standing: count,
      produced: die.face <= count,
    });
  }

  return payouts;
}
