/**
 * The rules engine.
 *
 * `legalMoves` enumerates everything the player to act may do; `applyMove`
 * returns a brand new state and throws on anything illegal. Nothing here
 * touches React, the DOM, or the network — this module would run unchanged in
 * Node or in a Worker.
 *
 * What is implemented is a thin but complete slice: draft a card, roll dice,
 * spend dice to build blueprints and activate buildings, end the round. The
 * TODOs mark where the real Fantastic Factories rules go.
 */

import { nextInt, shuffle } from "./rng";
import { MARKETPLACE_SIZE } from "./setup";
import type {
  ActivationRequirement,
  Building,
  Card,
  Die,
  DieFace,
  Effect,
  GameState,
  Move,
  Player,
  Resources,
} from "./types";

/** A player who reaches either threshold ends the game. */
export const END_GOODS = 12;
export const END_BUILDINGS = 10;

/**
 * Safety valve. The slice implemented below cannot deadlock, but a partially
 * written rule easily can, and an unbounded loop in a test is miserable to
 * debug. Raise or remove it once the real end conditions are in.
 */
export const MAX_ROUNDS = 50;

// --- queries ---------------------------------------------------------------

export function currentPlayer(state: GameState): Player {
  return state.players[state.currentPlayerIndex];
}

export function isTerminal(state: GameState): boolean {
  return state.gameOver;
}

function satisfies(requirement: ActivationRequirement, face: DieFace): boolean {
  switch (requirement.kind) {
    case "any":
      return true;
    case "exact":
      return face === requirement.face;
    case "atLeast":
      return face >= requirement.face;
    case "atMost":
      return face <= requirement.face;
  }
}

function canAfford(resources: Resources, cost: Resources): boolean {
  return resources.goods >= cost.goods && resources.energy >= cost.energy;
}

function unspentDice(player: Player): Die[] {
  return player.dice.filter((die) => !die.spent);
}

export function legalMoves(state: GameState): Move[] {
  if (state.gameOver) return [];

  const player = currentPlayer(state);

  switch (state.phase) {
    case "market": {
      const moves: Move[] = state.marketplace.map((card) => ({
        type: "draftFromMarket" as const,
        cardId: card.id,
      }));
      if (state.deck.length > 0 || state.discard.length > 0) {
        moves.push({ type: "drawFromDeck" });
      }
      // Only reachable if both the market and the deck have run dry.
      if (moves.length === 0) moves.push({ type: "endPhase" });
      return moves;
    }

    case "work": {
      if (player.dice.length === 0) return [{ type: "rollDice" }];

      const moves: Move[] = [];
      for (const die of unspentDice(player)) {
        for (const card of player.hand) {
          if (die.face >= card.buildRequirement && canAfford(player.resources, card.buildCost)) {
            moves.push({ type: "build", cardId: card.id, dieId: die.id });
          }
        }
        for (const building of player.buildings) {
          if (!building.activated && satisfies(building.card.activation, die.face)) {
            moves.push({ type: "activate", cardId: building.card.id, dieId: die.id });
          }
        }
      }
      moves.push({ type: "endPhase" });
      return moves;
    }

    case "cleanup":
      return [{ type: "endPhase" }];
  }
}

// --- state helpers ---------------------------------------------------------

function updatePlayer(
  state: GameState,
  index: number,
  update: (player: Player) => Player,
): GameState {
  const players = state.players.map((player, i) => (i === index ? update(player) : player));
  return { ...state, players };
}

function log(state: GameState, message: string): GameState {
  return { ...state, log: [...state.log, message] };
}

/**
 * Draws up to `count` cards, reshuffling the discard pile when the deck runs
 * out. Draws fewer than asked if both piles are empty rather than throwing.
 */
function drawCards(state: GameState, playerIndex: number, count: number): GameState {
  let deck = [...state.deck];
  let discard = [...state.discard];
  let rng = state.rng;
  const drawn: Card[] = [];

  for (let i = 0; i < count; i++) {
    if (deck.length === 0) {
      if (discard.length === 0) break;
      const [reshuffled, nextRng] = shuffle(discard, rng);
      deck = reshuffled;
      discard = [];
      rng = nextRng;
    }
    drawn.push(deck.shift()!);
  }

  const withCards = updatePlayer({ ...state, deck, discard, rng }, playerIndex, (player) => ({
    ...player,
    hand: [...player.hand, ...drawn],
  }));
  return withCards;
}

function addResources(resources: Resources, gain: Partial<Resources>): Resources {
  return {
    goods: resources.goods + (gain.goods ?? 0),
    energy: resources.energy + (gain.energy ?? 0),
  };
}

function spendResources(resources: Resources, cost: Resources): Resources {
  return {
    goods: resources.goods - cost.goods,
    energy: resources.energy - cost.energy,
  };
}

/**
 * TODO: this is where new `Effect` variants get handled. Keep it exhaustive —
 * the switch has no default so TypeScript will flag any variant you forget.
 */
function applyEffect(state: GameState, playerIndex: number, effect: Effect): GameState {
  switch (effect.kind) {
    case "gain":
      return updatePlayer(state, playerIndex, (player) => ({
        ...player,
        resources: addResources(player.resources, effect.resources),
      }));
    case "draw":
      return drawCards(state, playerIndex, effect.count);
  }
}

function spendDie(player: Player, dieId: string): Player {
  return {
    ...player,
    dice: player.dice.map((die) => (die.id === dieId ? { ...die, spent: true } : die)),
  };
}

function requireUnspentDie(player: Player, dieId: string): Die {
  const die = player.dice.find((d) => d.id === dieId);
  if (!die) throw new Error(`${player.name} has no die ${dieId}`);
  if (die.spent) throw new Error(`Die ${dieId} was already spent`);
  return die;
}

/** Hands the turn to the next player, advancing the phase after a full lap. */
function endTurn(state: GameState): GameState {
  const nextIndex = (state.currentPlayerIndex + 1) % state.players.length;
  if (nextIndex !== 0) {
    return { ...state, currentPlayerIndex: nextIndex };
  }

  switch (state.phase) {
    case "market":
      return log({ ...state, phase: "work", currentPlayerIndex: 0 }, "Work phase");
    case "work":
      return log({ ...state, phase: "cleanup", currentPlayerIndex: 0 }, "Cleanup");
    case "cleanup":
      return state; // cleanup advances the round itself, in endRound
  }
}

/** Discards dice, refreshes buildings, refills the market, checks the end. */
function endRound(state: GameState): GameState {
  const players = state.players.map((player) => ({
    ...player,
    dice: [],
    buildings: player.buildings.map((building: Building) => ({ ...building, activated: false })),
  }));

  let refilled = { ...state, players };
  const missing = MARKETPLACE_SIZE - refilled.marketplace.length;
  if (missing > 0 && refilled.deck.length > 0) {
    const drawn = refilled.deck.slice(0, missing);
    refilled = {
      ...refilled,
      marketplace: [...refilled.marketplace, ...drawn],
      deck: refilled.deck.slice(drawn.length),
    };
  }

  const triggered = players.some(
    (player) => player.resources.goods >= END_GOODS || player.buildings.length >= END_BUILDINGS,
  );
  const round = refilled.round + 1;

  if (triggered || round > MAX_ROUNDS) {
    const reason = triggered ? "End condition met" : `Round cap (${MAX_ROUNDS}) reached`;
    return log(
      { ...refilled, gameOver: true, winner: decideWinner(refilled), round },
      `${reason} — game over`,
    );
  }

  return log({ ...refilled, round, phase: "market", currentPlayerIndex: 0 }, `Round ${round} — market phase`);
}

/**
 * TODO: replace with real scoring. Most goods wins, buildings break the tie,
 * and a genuine tie returns null.
 */
function decideWinner(state: GameState): number | null {
  const ranked = state.players
    .map((player, index) => ({ index, player }))
    .sort(
      (a, b) =>
        b.player.resources.goods - a.player.resources.goods ||
        b.player.buildings.length - a.player.buildings.length,
    );

  const [best, runnerUp] = ranked;
  if (
    runnerUp &&
    best.player.resources.goods === runnerUp.player.resources.goods &&
    best.player.buildings.length === runnerUp.player.buildings.length
  ) {
    return null;
  }
  return best.index;
}

// --- the reducer -----------------------------------------------------------

export function applyMove(state: GameState, move: Move): GameState {
  if (state.gameOver) {
    throw new Error("The game is over");
  }

  const index = state.currentPlayerIndex;
  const player = currentPlayer(state);

  switch (move.type) {
    case "draftFromMarket": {
      if (state.phase !== "market") throw new Error("Drafting happens in the market phase");
      const card = state.marketplace.find((c) => c.id === move.cardId);
      if (!card) throw new Error(`No card ${move.cardId} in the marketplace`);

      const taken = updatePlayer(
        { ...state, marketplace: state.marketplace.filter((c) => c.id !== card.id) },
        index,
        (p) => ({ ...p, hand: [...p.hand, card] }),
      );
      return endTurn(log(taken, `${player.name} drafted ${card.name}`));
    }

    case "drawFromDeck": {
      if (state.phase !== "market") throw new Error("Drawing happens in the market phase");
      const drawn = drawCards(state, index, 1);
      return endTurn(log(drawn, `${player.name} drew a blueprint`));
    }

    case "rollDice": {
      if (state.phase !== "work") throw new Error("Dice are rolled in the work phase");
      if (player.dice.length > 0) throw new Error(`${player.name} already rolled`);

      let rng = state.rng;
      const dice: Die[] = [];
      for (let i = 0; i < player.workforce; i++) {
        const [value, next] = nextInt(rng, 6);
        rng = next;
        dice.push({ id: `${player.id}-r${state.round}-d${i}`, face: (value + 1) as DieFace, spent: false });
      }

      const rolled = updatePlayer({ ...state, rng }, index, (p) => ({ ...p, dice }));
      return log(rolled, `${player.name} rolled ${dice.map((d) => d.face).join(", ")}`);
    }

    case "build": {
      if (state.phase !== "work") throw new Error("Building happens in the work phase");
      const die = requireUnspentDie(player, move.dieId);
      const card = player.hand.find((c) => c.id === move.cardId);
      if (!card) throw new Error(`${player.name} does not hold ${move.cardId}`);
      if (die.face < card.buildRequirement) {
        throw new Error(`${card.name} needs a die of ${card.buildRequirement} or more`);
      }
      if (!canAfford(player.resources, card.buildCost)) {
        throw new Error(`${player.name} cannot afford ${card.name}`);
      }

      const built = updatePlayer(state, index, (p) => ({
        ...spendDie(p, die.id),
        hand: p.hand.filter((c) => c.id !== card.id),
        buildings: [...p.buildings, { card, activated: false }],
        resources: spendResources(p.resources, card.buildCost),
      }));
      return log(built, `${player.name} built ${card.name}`);
    }

    case "activate": {
      if (state.phase !== "work") throw new Error("Activation happens in the work phase");
      const die = requireUnspentDie(player, move.dieId);
      const building = player.buildings.find((b) => b.card.id === move.cardId);
      if (!building) throw new Error(`${player.name} has no building ${move.cardId}`);
      if (building.activated) throw new Error(`${building.card.name} already activated this round`);
      if (!satisfies(building.card.activation, die.face)) {
        throw new Error(`A ${die.face} does not activate ${building.card.name}`);
      }

      const marked = updatePlayer(state, index, (p) => ({
        ...spendDie(p, die.id),
        buildings: p.buildings.map((b) =>
          b.card.id === building.card.id ? { ...b, activated: true } : b,
        ),
      }));
      const resolved = applyEffect(marked, index, building.card.effect);
      return log(resolved, `${player.name} activated ${building.card.name}`);
    }

    case "endPhase": {
      if (state.phase === "cleanup") return endRound(state);
      if (state.phase === "work" && player.dice.length === 0) {
        throw new Error(`${player.name} must roll before passing`);
      }
      return endTurn(state);
    }
  }
}

/** Convenience for AI loops and tests. */
export function applyMoves(state: GameState, moves: readonly Move[]): GameState {
  return moves.reduce(applyMove, state);
}
