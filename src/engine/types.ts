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

/**
 * The face on the other side of the die. Opposite faces on a d6 always add up
 * to seven, so a 5 turns over to a 2.
 */
export function oppositeFace(face: DieFace): DieFace {
  return (7 - face) as DieFace;
}

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

/**
 * The two resources that are *stock* rather than score, and so are what the
 * end-of-phase limit counts. Goods are neither spent nor capped.
 */
export type Stock = "metal" | "energy";

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
  | { readonly kind: "extraDice"; readonly count: number; readonly chosen: boolean }
  /**
   * Discard a blueprint from hand and take its build cost back as metal and
   * energy — the Black Market. Never more than `max` in total: a card that
   * cost more than that pays out only part, and the player says which part.
   *
   * Which card, and which part, ride on the move rather than the card, so this
   * is the one effect that cannot resolve on its own.
   */
  | { readonly kind: "discardForResources"; readonly max: number }
  /**
   * Turn an unspent die over to the face on the other side — the Dojo. The die
   * is not spent and does not go on the card: it stays on the table showing
   * its new face, to be used for whatever it now fits.
   *
   * Which die rides on the move, so this is one of the effects that cannot
   * resolve on its own.
   */
  | { readonly kind: "flipDie" }
  /**
   * Nudge an unspent die `by` pips — the Fitness Center takes one off. Like a
   * flip, the die stays on the table at its new face.
   *
   * A step that would run off the die is simply not allowed, which is why a 1
   * cannot be taken any lower.
   */
  | { readonly kind: "stepDie"; readonly by: number }
  /**
   * Gain this resource equal to the face of the die placed on the perk — the
   * Foundry turns energy into metal at whatever rate the die says.
   */
  | { readonly kind: "gainByFace"; readonly resource: keyof Resources }
  /**
   * An extra die at a face the player buys outright — the Golem. The face is
   * on the move rather than on the table, and the perk's `costByFace` is what
   * charges for it, so a 5 costs five.
   *
   * White and lent for the round, like a contractor's dice.
   */
  | { readonly kind: "gainDie" };

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
 * The tool is what building costs: to build a blueprint you discard a
 * different blueprint of the same tool from hand. It is also what a contractor
 * slot's token asks for. It is not the card's `type` — that is what the card
 * *is*, and the tool is only what it is worth as payment.
 */
export const BLUEPRINT_TOOLS = ["hammer", "wrench", "gear", "shovel"] as const;

export type BlueprintTool = (typeof BLUEPRINT_TOOLS)[number];

/**
 * What a blueprint is, printed as a coloured band across the card: Production
 * blue, Utility yellow, Training red, Monument grey, Special purple.
 *
 * Nothing in the rules turns on it yet — it is the card's identity, and the
 * cards that care about type have not been written.
 */
export const BLUEPRINT_CATEGORIES = [
  "production",
  "utility",
  "training",
  "monument",
  "special",
] as const;

export type BlueprintCategory = (typeof BLUEPRINT_CATEGORIES)[number];

/**
 * The automaton opponent answers for its compound with one die per type of
 * card in it, in that type's own colour. Four types, four dice.
 *
 * Monument has no die and so never produces — it is the one printed type the
 * automaton cannot turn into goods.
 */
export const AUTOMA_PRODUCTION: readonly {
  readonly color: DieColor;
  readonly category: BlueprintCategory;
}[] = [
  { color: "red", category: "training" },
  { color: "blue", category: "production" },
  { color: "purple", category: "special" },
  { color: "yellow", category: "utility" },
];

/** The fifth die. It answers for no cards; it decides what the automaton takes. */
export const AUTOMA_MARKET_COLOR: DieColor = "green";

/**
 * One die of each colour, rolled together at the top of the automaton's turn.
 * Never white — that is a contractor's loan, and the automaton takes none.
 */
export const AUTOMA_DIE_COLORS: readonly DieColor[] = [
  ...AUTOMA_PRODUCTION.map((pair) => pair.color),
  AUTOMA_MARKET_COLOR,
];

type CardBase = {
  readonly id: string;
  readonly name: string;
};

/**
 * What a perk demands of the dice put on it, beyond their count.
 *
 * `consecutive` means a run with no gaps and no repeats — 2, 3, 4.
 */
export type DicePattern = "any" | "matching" | "consecutive";

/**
 * What a blueprint does once it is standing in your compound: dice go on it,
 * and it pays out. Usable once per round.
 */
export type BlueprintPerk = {
  /** How many dice it takes. They all go on at once. Some take none. */
  readonly dice: number;
  readonly pattern: DicePattern;
  /** Which faces it will take at all. */
  readonly accepts: ActivationRequirement;
  /** Resources paid to use it, on top of the dice. Usually nothing. */
  readonly cost: Resources;
  /**
   * A price read off a face rather than printed: this much of this resource,
   * equal to the face the perk turns on. The Concrete Plant takes two matching
   * dice and charges metal equal to the pair, so a 3, 3 costs 3 metal; the
   * Golem charges for the face it hands over rather than one on the table.
   *
   * Charged once, not per die, and added to `cost`.
   */
  readonly costByFace?: keyof Resources;
  readonly effect: Effect;
};

/** Built into your compound, where its perk can be used once per round. */
export type BlueprintCard = CardBase & {
  readonly kind: "blueprint";
  /**
   * What the card is — Production, Utility, Training, Monument or Special.
   * Required: every blueprint in the deck is a real card with a printed type,
   * and the automaton reads types off its dice, so a card without one would
   * quietly answer to nothing.
   */
  readonly type: BlueprintCategory;
  /** Its tool symbol — hammer, wrench, gear or shovel. What it pays for. */
  readonly tool: BlueprintTool;
  /** Resources spent to build it, on top of discarding a matching tool. */
  readonly buildCost: Resources;
  /**
   * Score it is worth at the end, per copy standing. Absent means none — most
   * of the placeholder blueprints are worth nothing yet.
   */
  readonly prestige?: number;
  /**
   * Extra score for holding at least one, however many you hold. The Beacon
   * is worth one each plus one for the set, so four of them score five.
   */
  readonly prestigeBonus?: number;
  /**
   * Exempt from the one-of-each rule: the Beacon is meant to be stacked.
   */
  readonly duplicable?: boolean;
  /** Some blueprints are pure score, and do nothing once standing. */
  readonly perk?: BlueprintPerk;
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
   * once, so this is either empty or full. Cleared at cleanup.
   */
  readonly dice: readonly DieFace[];
  /**
   * Whether the perk has been used this round. Usually that is the same as
   * having dice on it — but a perk can cost energy and no dice at all, and
   * that one has nothing to show for itself but this.
   */
  readonly worked: boolean;
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
  readonly token: BlueprintTool;
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
   * discarding another blueprint of the same tool, plus its resource cost.
   */
  | {
      readonly type: "build";
      readonly cardId: string;
      /** The blueprint discarded to pay. Same tool, different card. */
      readonly paymentCardId: string;
    }
  /**
   * Thrown away to come down to the end-of-phase limits: one resource, or one
   * blueprint out of hand. Legal only while over a limit, and one at a time,
   * so the count can be watched falling.
   */
  | { readonly type: "discard"; readonly kind: "resource"; readonly resource: Stock }
  | { readonly type: "discard"; readonly kind: "card"; readonly cardId: string }
  /**
   * The automaton's whole Market Phase, read off its green die: take a card
   * from the row, or reveal one and sweep a row away.
   *
   * Illegal for a human, and the only move an automaton is offered — which is
   * what lets any `Ai` implementation play it correctly.
   */
  | { readonly type: "automaMarket" }
  /**
   * The automaton's whole Work Phase: each of its four remaining dice pays a
   * good if its face is at most the number of cards of that die's type.
   */
  | { readonly type: "automaWork" }
  /** Uses a building's perk, putting all the dice it asks for on at once. */
  | {
      readonly type: "activate";
      readonly cardId: string;
      readonly dieIds: readonly string[];
      /**
       * A blueprint discarded from hand, for a perk that eats one — the Black
       * Market. Every other perk leaves this out.
       */
      readonly paymentCardId?: string;
      /**
       * Which resources to take, when the payout is capped and so has to be
       * chosen. Only the Black Market pays this way.
       */
      readonly gain?: Resources;
      /**
       * The die a perk acts on rather than spends — the Dojo turns it over.
       * Never one of `dieIds`: it is not paid, and it does not go on the card.
       */
      readonly targetDieId?: string;
      /**
       * The face bought, for a perk that hands over a die — the Golem. It is
       * what the die will show and what it costs, both.
       */
      readonly face?: DieFace;
    }
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
