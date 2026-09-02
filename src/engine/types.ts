/**
 * Domain types for Fantastic Factories.
 *
 * These nouns are real; the *rules* that manipulate them in `rules.ts` are a
 * deliberately thin slice. Fill the rules in against these types.
 */

import type { Rng } from "./rng";

export type DieFace = 1 | 2 | 3 | 4 | 5 | 6;

export type Die = {
  readonly id: string;
  readonly face: DieFace;
  /** Set once the die has been spent on a build or an activation this round. */
  readonly spent: boolean;
};

export type Resources = {
  readonly goods: number;
  readonly energy: number;
};

/** What die face a building demands before it will activate. */
export type ActivationRequirement =
  | { readonly kind: "any" }
  | { readonly kind: "exact"; readonly face: DieFace }
  | { readonly kind: "atLeast"; readonly face: DieFace }
  | { readonly kind: "atMost"; readonly face: DieFace };

/**
 * What activating a building does.
 *
 * TODO: the real game has many more effect kinds (gain a worker, place a die
 * on another building, copy an effect, place goods on this card...). Add
 * variants here and handle them in `applyEffect`.
 */
export type Effect =
  | { readonly kind: "gain"; readonly resources: Partial<Resources> }
  | { readonly kind: "draw"; readonly count: number };

/** A card is a blueprint in hand and a building once constructed. */
export type Card = {
  readonly id: string;
  readonly name: string;
  /** Resources spent to construct it. */
  readonly buildCost: Resources;
  /** Minimum die face that can be assigned to construct it. */
  readonly buildRequirement: DieFace;
  readonly activation: ActivationRequirement;
  readonly effect: Effect;
};

export type Building = {
  readonly card: Card;
  /** Reset during cleanup — a building activates at most once per round. */
  readonly activated: boolean;
};

export type Player = {
  readonly id: string;
  readonly name: string;
  readonly isAi: boolean;
  readonly hand: readonly Card[];
  readonly buildings: readonly Building[];
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

/**
 * Every legal action is one variant of this union. The UI and the AI both go
 * through `legalMoves` / `applyMove` and know nothing else about the rules.
 */
export type Move =
  | { readonly type: "draftFromMarket"; readonly cardId: string }
  | { readonly type: "drawFromDeck" }
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
  /** Face-up cards available to draft during the market phase. */
  readonly marketplace: readonly Card[];
  readonly deck: readonly Card[];
  readonly discard: readonly Card[];
  readonly log: readonly string[];
  readonly gameOver: boolean;
  /** Index into `players`, or null while the game is running or on a draw. */
  readonly winner: number | null;
};
