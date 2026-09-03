/**
 * Domain types for Fantastic Factories.
 *
 * These nouns are real; the *rules* that manipulate them in `rules.ts` are a
 * deliberately thin slice. Fill the rules in against these types.
 */

import type { Rng } from "./rng";

export type DieFace = 1 | 2 | 3 | 4 | 5 | 6;

/** Each player takes one colour; every die they roll carries it. */
export const DIE_COLORS = ["red", "blue", "green", "purple", "yellow", "white"] as const;

export type DieColor = (typeof DIE_COLORS)[number];

export type Die = {
  readonly id: string;
  readonly face: DieFace;
  readonly color: DieColor;
  /** Set once the die has been spent on a build or an activation this round. */
  readonly spent: boolean;
};

/**
 * Metal builds, energy powers, goods score.
 *
 * Blueprints are paid for in metal, which is why players start with some and
 * none of them start with goods.
 */
export type Resources = {
  readonly metal: number;
  readonly energy: number;
  readonly goods: number;
};

/** What die face a building or a contractor demands. */
export type ActivationRequirement =
  | { readonly kind: "any" }
  | { readonly kind: "exact"; readonly face: DieFace }
  | { readonly kind: "atLeast"; readonly face: DieFace }
  | { readonly kind: "atMost"; readonly face: DieFace };

/**
 * What activating a building or taking a contractor does.
 *
 * TODO: the real game has many more effect kinds (gain a worker, place a die
 * on another building, copy an effect, place goods on this card...). Add
 * variants here and handle them in `applyEffect`.
 */
export type Effect =
  | { readonly kind: "gain"; readonly resources: Partial<Resources> }
  | { readonly kind: "draw"; readonly count: number };

export type CardKind = "blueprint" | "contractor";

/**
 * Every blueprint carries one of four tool types, colour-coded on the card.
 *
 * TODO: currently descriptive only — nothing in the rules reads a blueprint's
 * type yet. Effects that count tools in a compound would go through here.
 */
export const BLUEPRINT_TYPES = ["hammer", "wrench", "gear", "shovel"] as const;

export type BlueprintType = (typeof BLUEPRINT_TYPES)[number];

type CardBase = {
  readonly id: string;
  readonly name: string;
};

/** Built into your compound, where it can be activated once per round. */
export type BlueprintCard = CardBase & {
  readonly kind: "blueprint";
  /** Its tool type — hammer, wrench, gear or shovel. */
  readonly type: BlueprintType;
  /** Resources spent to construct it. */
  readonly buildCost: Resources;
  /** Minimum die face that can be assigned to construct it. */
  readonly buildRequirement: DieFace;
  readonly activation: ActivationRequirement;
  readonly effect: Effect;
};

/**
 * Taken from the market by paying its slot's token. The effect resolves the
 * moment you take it and the card is discarded — it never enters your hand.
 */
export type ContractorCard = CardBase & {
  readonly kind: "contractor";
  readonly effect: Effect;
};

export type Card = BlueprintCard | ContractorCard;

/** A blueprint standing in a player's compound. */
export type Building = {
  readonly card: BlueprintCard;
  /** Reset during cleanup — a building activates at most once per round. */
  readonly activated: boolean;
};

/** A card type's row, draw deck, and discard pile. */
export type CardPool<T extends Card> = {
  readonly row: readonly T[];
  readonly deck: readonly T[];
  readonly discard: readonly T[];
};

/**
 * One position in the contractor row.
 *
 * The token belongs to the slot, not to the card sitting on it: taking the
 * contractor leaves the token behind for whatever refills the slot. Paying it
 * means discarding a blueprint whose tool type matches.
 */
export type ContractorSlot = {
  readonly token: BlueprintType;
  readonly card: ContractorCard | null;
};

/** The contractor row: four tokened slots, plus deck and discard. */
export type ContractorMarket = {
  readonly slots: readonly ContractorSlot[];
  readonly deck: readonly ContractorCard[];
  readonly discard: readonly ContractorCard[];
};

export type Player = {
  readonly id: string;
  readonly name: string;
  readonly isAi: boolean;
  readonly color: DieColor;
  /**
   * Blueprints only. Contractors resolve and are discarded the instant they
   * are taken, so they can never be held.
   */
  readonly hand: readonly BlueprintCard[];
  /** The area in front of the player, where built blueprints stand. */
  readonly compound: readonly Building[];
  readonly resources: Resources;
  readonly dice: readonly Die[];
  /** How many dice this player rolls each round. */
  readonly workforce: number;
};

/**
 * A round runs market -> work -> cleanup.
 *
 * In the published game, building and activating both happen during the work
 * phase by assigning dice, which is how it is modelled here.
 */
export type Phase = "market" | "work" | "cleanup";

export const PHASE_LABELS: Record<Phase, string> = {
  market: "Market Phase",
  work: "Work Phase",
  cleanup: "Cleanup",
};

/**
 * Every legal action is one variant of this union. The UI and the AI both go
 * through `legalMoves` / `applyMove` and know nothing else about the rules.
 *
 * There is no blind draw: during the Market Phase cards can only be taken
 * face-up from the two rows. Cards still enter hand from the deck through card
 * effects, which is not a move.
 */
export type Move =
  /** Take a face-up blueprint from the blueprint row. Free. */
  | { readonly type: "draft"; readonly kind: "blueprint"; readonly cardId: string }
  /**
   * Take a face-up contractor, paying its slot's token by discarding a
   * blueprint of the matching tool type. Its effect resolves immediately and
   * the contractor is discarded.
   */
  | {
      readonly type: "draft";
      readonly kind: "contractor";
      readonly cardId: string;
      /** The blueprint discarded as payment. Must match the slot's token. */
      readonly paymentCardId: string;
    }
  | { readonly type: "rollDice" }
  | { readonly type: "build"; readonly cardId: string; readonly dieId: string }
  | { readonly type: "activate"; readonly cardId: string; readonly dieId: string }
  | { readonly type: "endPhase" };

export type GameState = {
  readonly rng: Rng;
  readonly round: number;
  readonly phase: Phase;
  readonly players: readonly Player[];
  readonly currentPlayerIndex: number;
  readonly blueprints: CardPool<BlueprintCard>;
  readonly contractors: ContractorMarket;
  readonly log: readonly string[];
  readonly gameOver: boolean;
  /** Index into `players`, or null while the game is running or on a draw. */
  readonly winner: number | null;
};
