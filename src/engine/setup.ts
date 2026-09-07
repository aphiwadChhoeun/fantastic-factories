import { createBlueprintDeck, createContractorDeck } from "./cards";
import { createRng, shuffle, type Rng } from "./rng";
import {
  BLUEPRINT_TYPES,
  DIE_COLORS,
  NO_PERKS,
  NO_PLACEMENTS,
  PHASE_LABELS,
  type BlueprintCard,
  type CardPool,
  type ContractorCard,
  type ContractorMarket,
  type DieColor,
  type GameState,
  type Player,
  type Resources,
} from "./types";

/**
 * Face-up cards per market row. There are two rows: contractors, blueprints.
 *
 * Four slots and four tool types means the contractor row carries one token of
 * each icon.
 */
export const MARKET_ROW_SIZE = 4;
/** Blueprints dealt to each player at setup. */
export const STARTING_HAND = 4;
/** Dice each player rolls per round, all in their own colour. */
export const STARTING_WORKFORCE = 4;

/** Metal to build with, energy to power it, no goods until you produce them. */
export const STARTING_RESOURCES: Resources = { metal: 1, energy: 2, goods: 0 };

/** Human first, then the AI seats, in palette order. */
export const DEFAULT_PLAYER_COLORS: readonly DieColor[] = ["blue", "red"];

export type SetupOptions = {
  readonly seed?: number;
  /** Human is always index 0; every later name becomes an AI seat. */
  readonly playerNames?: readonly string[];
  /** One colour per player. Defaults to blue, then red, then palette order. */
  readonly playerColors?: readonly DieColor[];
};

function resolveColors(count: number, requested?: readonly DieColor[]): DieColor[] {
  const colors = requested
    ? [...requested]
    : [...DEFAULT_PLAYER_COLORS, ...DIE_COLORS.filter((c) => !DEFAULT_PLAYER_COLORS.includes(c))];

  if (colors.length < count) {
    throw new Error(`Need ${count} player colours, got ${colors.length}`);
  }
  const chosen = colors.slice(0, count);
  if (new Set(chosen).size !== chosen.length) {
    throw new Error("Each player needs a distinct colour");
  }
  return chosen;
}

export function createInitialState(options: SetupOptions = {}): GameState {
  const { seed = 1, playerNames = ["You", "AI"], playerColors } = options;

  if (playerNames.length < 2) {
    throw new Error("A game needs at least two players");
  }
  if (playerNames.length > DIE_COLORS.length) {
    throw new Error(`At most ${DIE_COLORS.length} players — one per die colour`);
  }

  const colors = resolveColors(playerNames.length, playerColors);

  let rng: Rng = createRng(seed);
  const [blueprintCards, afterBlueprints] = shuffle(createBlueprintDeck(), rng);
  rng = afterBlueprints;
  const [contractorCards, afterContractors] = shuffle(createContractorDeck(), rng);
  rng = afterContractors;

  const blueprintDraw: BlueprintCard[] = [...blueprintCards];
  const contractorDraw: ContractorCard[] = [...contractorCards];

  const players: Player[] = playerNames.map((name, index) => ({
    id: `p${index}`,
    name,
    isAi: index > 0,
    color: colors[index],
    // Hands are blueprints only — contractors resolve the moment you take one.
    hand: blueprintDraw.splice(0, STARTING_HAND),
    // The compound starts bare. The Headquarters is a tile, not a building.
    compound: [],
    headquarters: NO_PLACEMENTS,
    resources: STARTING_RESOURCES,
    dice: [],
    rolled: false,
    workforce: STARTING_WORKFORCE,
    perks: NO_PERKS,
  }));

  const blueprints: CardPool<BlueprintCard> = {
    row: blueprintDraw.splice(0, MARKET_ROW_SIZE),
    deck: blueprintDraw,
    discard: [],
  };
  // One token per tool type, fixed to its slot for the whole game.
  // TODO: unconfirmed — tokens could instead be dealt out or rotate per round.
  const contractors: ContractorMarket = {
    slots: Array.from({ length: MARKET_ROW_SIZE }, (_, index) => ({
      token: BLUEPRINT_TYPES[index % BLUEPRINT_TYPES.length],
      card: contractorDraw.shift() ?? null,
    })),
    deck: contractorDraw,
    discard: [],
  };

  return {
    rng,
    round: 1,
    phase: "market",
    players,
    currentPlayerIndex: 0,
    blueprints,
    contractors,
    log: ["Round 1", `${players[0].name} — ${PHASE_LABELS.market}`],
    gameOver: false,
    winner: null,
  };
}
