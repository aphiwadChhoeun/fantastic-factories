/**
 * Domain types for Fantastic Factories.
 *
 * These nouns are real; the *rules* that manipulate them in `rules.ts` are a
 * deliberately thin slice. Fill the rules in against these types.
 */

import type { Rng } from "./rng";

export type DieFace = 1 | 2 | 3 | 4 | 5 | 6;

/** Every face, for enumerating the choices a `setDie` move offers. */
export const DIE_FACES: readonly DieFace[] = [1, 2, 3, 4, 5, 6];

/** Each player takes one colour; every die they roll carries it. */
export const DIE_COLORS = ["red", "blue", "green", "purple", "yellow", "white"] as const;

export type DieColor = (typeof DIE_COLORS)[number];

export type Die = {
  readonly id: string;
  readonly face: DieFace;
  readonly color: DieColor;
  /**
   * A white die lent by a contractor for one Work Phase, rather than one of
   * the player's own workforce. Flagged rather than inferred from the colour,
   * since a player can be seated on white.
   */
  readonly extra: boolean;
  /** Set once the die has been spent on a build or an activation this round. */
  readonly spent: boolean;
};

/** Contractor dice are white, whatever colour the player is seated on. */
export const EXTRA_DIE_COLOR: DieColor = "white";

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
  | { readonly kind: "draw"; readonly count: number }
  /**
   * Draw blueprints off the deck until one is not already standing in the
   * compound, then build it at once for nothing — no die, no build cost. The
   * duplicates passed over are discarded.
   */
  | { readonly kind: "buildFromDeck" }
  /**
   * Reveal the top blueprint and take metal and energy equal to its build
   * cost. The card itself is revealed only, then discarded.
   */
  | { readonly kind: "revealForResources" }
  /**
   * Set the face of up to `count` of your own dice instead of rolling them,
   * at the start of this round's Work Phase.
   */
  | { readonly kind: "chooseOwnFaces"; readonly count: number }
  /**
   * Extra white dice for this round's Work Phase, discarded with everything
   * else at cleanup. `chosen` dice have their face picked by the player once
   * the roll is on the table; the rest are rolled with it.
   */
  | { readonly kind: "extraDice"; readonly count: number; readonly chosen: boolean };

/**
 * The three sections of the Headquarters tile. Dice go on them during the Work
 * Phase; the tile itself is never built, bought or discarded.
 */
export const HQ_SECTION_IDS = ["research", "generate", "mine"] as const;

export type HqSectionId = (typeof HQ_SECTION_IDS)[number];

/** What a single die placed on a section pays out. */
export type HqReward =
  /** One blueprint off the top of the deck — Research. */
  | { readonly kind: "drawBlueprint" }
  /** Energy equal to the die's own face — Generate. */
  | { readonly kind: "energyByFace" }
  /** The same haul whatever the face — Mine. */
  | { readonly kind: "gain"; readonly resources: Partial<Resources> };

export type HqSection = {
  readonly id: HqSectionId;
  readonly name: string;
  /** How many dice the section takes in a round. */
  readonly slots: number;
  /** Which faces it will take. */
  readonly accepts: ActivationRequirement;
  readonly reward: HqReward;
};

/**
 * The faces standing on each section this round, in the order they went down.
 * Cleared at cleanup with the dice themselves.
 *
 * Faces rather than dice, because that is all the tile cares about: the payout
 * reads the face, and matching faces on one section pay a bonus.
 */
export type HqPlacements = Readonly<Record<HqSectionId, readonly DieFace[]>>;

export const NO_PLACEMENTS: HqPlacements = { research: [], generate: [], mine: [] };

export type CardKind = "blueprint" | "contractor";

/**
 * Every blueprint carries one of four tool symbols, colour-coded on the card.
 *
 * The symbol is what building costs: to build a blueprint you discard a
 * different blueprint of the same symbol from hand. It is also what a
 * contractor slot's token asks for.
 */
export const BLUEPRINT_TYPES = ["hammer", "wrench", "gear", "shovel"] as const;

export type BlueprintType = (typeof BLUEPRINT_TYPES)[number];

type CardBase = {
  readonly id: string;
  readonly name: string;
};

/**
 * What a blueprint does once it is standing in your compound: dice go on it,
 * and it pays out. Usable once per round.
 */
export type BlueprintPerk = {
  /** How many dice it takes. They all go on at once. */
  readonly dice: number;
  /** Every die placed must show the same face. */
  readonly matching: boolean;
  /** Which faces it will take at all. */
  readonly accepts: ActivationRequirement;
  /** Resources paid to use it, on top of the dice. Usually nothing. */
  readonly cost: Resources;
  readonly effect: Effect;
};

/** Built into your compound, where its perk can be used once per round. */
export type BlueprintCard = CardBase & {
  readonly kind: "blueprint";
  /** Its tool symbol — hammer, wrench, gear or shovel. */
  readonly type: BlueprintType;
  /** Resources spent to build it, on top of discarding a matching symbol. */
  readonly buildCost: Resources;
  readonly perk: BlueprintPerk;
};

/**
 * Taken from the market by paying its slot's token. The effect resolves the
 * moment you take it and the card is discarded — it never enters your hand.
 */
export type ContractorCard = CardBase & {
  readonly kind: "contractor";
  /**
   * Charged on top of the slot's token. Most contractors cost only the token,
   * and leave this undefined.
   */
  readonly extraCost?: Resources;
  readonly effect: Effect;
};

export type Card = BlueprintCard | ContractorCard;

/**
 * A blueprint standing in a player's compound.
 *
 * No compound may hold two of the same blueprint. Copies of a card share a
 * name and differ only by id, so the rules compare names.
 */
export type Building = {
  readonly card: BlueprintCard;
  /**
   * The faces standing on its perk this round. A perk takes all its dice at
   * once, so this is either empty or full — and full means the perk has been
   * used. Cleared at cleanup.
   */
  readonly dice: readonly DieFace[];
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

/**
 * Contractor benefits that land in this round's Work Phase and expire with it.
 * Each count is what is *left* to spend: `applyMove` decrements as they go, and
 * cleanup clears the lot.
 */
export type WorkPerks = {
  /** Own dice whose face may be set instead of rolled — the Foreman. */
  readonly chooseOwnFaces: number;
  /** Extra white dice to roll alongside your own — Hired Hands. */
  readonly extraRolled: number;
  /** Extra white dice whose face you pick after the roll — the Specialist. */
  readonly extraChosen: number;
};

export const NO_PERKS: WorkPerks = { chooseOwnFaces: 0, extraRolled: 0, extraChosen: 0 };

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
  /**
   * The area in front of the player, where built blueprints stand. The
   * Headquarters is not part of it — that tile is not a blueprint.
   */
  readonly compound: readonly Building[];
  /** Dice standing on the Headquarters sections this round. */
  readonly headquarters: HqPlacements;
  readonly resources: Resources;
  /**
   * This round's dice: own-colour ones from the workforce, plus any white
   * extras a contractor handed over. Cleared at cleanup.
   */
  readonly dice: readonly Die[];
  /**
   * Set by `rollDice`, cleared at cleanup. Dice can be on the table before the
   * roll — a Foreman lets you place them — so the count is not the test for
   * whether a player has rolled.
   */
  readonly rolled: boolean;
  /** How many dice this player rolls each round. */
  readonly workforce: number;
  readonly perks: WorkPerks;
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
  /** Rolls everything still owed this round: your workforce, plus white extras. */
  | { readonly type: "rollDice" }
  /**
   * Puts one die on the table at a face of your choosing rather than rolling
   * it: one of your own before the roll (Foreman), or a white extra after it
   * (Specialist).
   */
  | { readonly type: "setDie"; readonly face: DieFace }
  /** Puts a die on one of the Headquarters sections and takes its payout. */
  | { readonly type: "placeDie"; readonly section: HqSectionId; readonly dieId: string }
  /**
   * Builds a blueprint from hand into the compound. No die: you pay by
   * discarding another blueprint of the same symbol, plus its resource cost.
   */
  | {
      readonly type: "build";
      readonly cardId: string;
      /** The blueprint discarded to pay. Same symbol, different card. */
      readonly paymentCardId: string;
    }
  /** Uses a building's perk, putting all the dice it asks for on at once. */
  | { readonly type: "activate"; readonly cardId: string; readonly dieIds: readonly string[] }
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
