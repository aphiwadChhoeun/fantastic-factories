import { createDeck, createStartingBuilding } from "./cards";
import { createRng, shuffle } from "./rng";
import type { Card, GameState, Player, Resources } from "./types";

export const MARKETPLACE_SIZE = 4;
export const STARTING_HAND = 2;
export const STARTING_WORKFORCE = 3;

/** Enough to afford a first blueprint before any building has paid out. */
export const STARTING_RESOURCES: Resources = { goods: 2, energy: 2 };

export type SetupOptions = {
  readonly seed?: number;
  /** Human is always index 0; every later name becomes an AI seat. */
  readonly playerNames?: readonly string[];
};

export function createInitialState(options: SetupOptions = {}): GameState {
  const { seed = 1, playerNames = ["You", "AI"] } = options;

  if (playerNames.length < 2) {
    throw new Error("A game needs at least two players");
  }

  const [shuffled, rng] = shuffle(createDeck(), createRng(seed));
  const cards: Card[] = [...shuffled];

  const players: Player[] = playerNames.map((name, index) => ({
    id: `p${index}`,
    name,
    isAi: index > 0,
    hand: cards.splice(0, STARTING_HAND),
    buildings: [{ card: createStartingBuilding(`p${index}`), activated: false }],
    resources: STARTING_RESOURCES,
    dice: [],
    workforce: STARTING_WORKFORCE,
  }));

  const marketplace = cards.splice(0, MARKETPLACE_SIZE);

  return {
    rng,
    round: 1,
    phase: "market",
    players,
    currentPlayerIndex: 0,
    marketplace,
    deck: cards,
    discard: [],
    log: [`Round 1 — market phase`],
    gameOver: false,
    winner: null,
  };
}
