/**
 * The rules engine.
 *
 * `legalMoves` enumerates everything the player to act may do; `applyMove`
 * returns a brand new state and throws on anything illegal. Nothing here
 * touches React, the DOM, or the network — this module would run unchanged in
 * Node or in a Worker.
 *
 * What is implemented is a thin but complete slice: take a card from one of
 * the two market rows, roll dice, spend dice to build blueprints into your
 * compound, activate what stands there, end the round. The TODOs mark where
 * the real Fantastic Factories rules go.
 */

import { nextInt, shuffle, type Rng } from "./rng";
import { MARKET_ROW_SIZE } from "./setup";
import {
  PHASE_LABELS,
  type ActivationRequirement,
  type BlueprintCard,
  type Card,
  type Die,
  type DieFace,
  type Effect,
  type GameState,
  type Move,
  type Player,
  type Resources,
} from "./types";

/** A player who reaches either threshold ends the game. */
export const END_GOODS = 12;
export const END_COMPOUND_SIZE = 10;

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
  return (
    resources.metal >= cost.metal &&
    resources.energy >= cost.energy &&
    resources.goods >= cost.goods
  );
}

function unspentDice(player: Player): Die[] {
  return player.dice.filter((die) => !die.spent);
}

/** Blueprints in hand that could pay a slot carrying `token`. */
function paymentsFor(player: Player, token: BlueprintCard["type"]): BlueprintCard[] {
  return player.hand.filter((card) => card.type === token);
}

export function legalMoves(state: GameState): Move[] {
  if (state.gameOver) return [];

  const player = currentPlayer(state);

  switch (state.phase) {
    case "market": {
      const moves: Move[] = [];

      // A contractor costs a blueprint of its slot's tool type, so a slot with
      // no matching blueprint in hand simply offers nothing.
      for (const slot of state.contractors.slots) {
        if (!slot.card) continue;
        for (const payment of paymentsFor(player, slot.token)) {
          moves.push({
            type: "draft",
            kind: "contractor",
            cardId: slot.card.id,
            paymentCardId: payment.id,
          });
        }
      }
      for (const card of state.blueprints.row) {
        moves.push({ type: "draft", kind: "blueprint", cardId: card.id });
      }

      // There is no blind draw, so a player with nothing to take passes.
      // Reachable when the blueprint row is empty and no slot is payable.
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
        for (const building of player.compound) {
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

/** Just the piles a draw touches — shared by both markets. */
type DrawSource<T extends Card> = {
  readonly deck: readonly T[];
  readonly discard: readonly T[];
};

/**
 * Takes up to `count` cards off a deck, reshuffling its discard pile when the
 * deck runs out. Returns fewer than asked if both are empty rather than
 * throwing.
 */
function takeFromDeck<T extends Card>(
  source: DrawSource<T>,
  count: number,
  rng: Rng,
): { drawn: T[]; deck: T[]; discard: T[]; rng: Rng } {
  let deck = [...source.deck];
  let discard = [...source.discard];
  let current = rng;
  const drawn: T[] = [];

  for (let i = 0; i < count; i++) {
    if (deck.length === 0) {
      if (discard.length === 0) break;
      const [reshuffled, next] = shuffle(discard, current);
      deck = reshuffled;
      discard = [];
      current = next;
    }
    drawn.push(deck.shift()!);
  }

  return { drawn, deck, discard, rng: current };
}

/**
 * Puts blueprints from the deck into a hand. Only card effects reach this —
 * there is no blind draw as a move.
 */
function drawBlueprints(state: GameState, playerIndex: number, count: number): GameState {
  const { drawn, deck, discard, rng } = takeFromDeck(state.blueprints, count, state.rng);
  const next: GameState = { ...state, rng, blueprints: { ...state.blueprints, deck, discard } };
  return updatePlayer(next, playerIndex, (player) => ({
    ...player,
    hand: [...player.hand, ...drawn],
  }));
}

function addResources(resources: Resources, gain: Partial<Resources>): Resources {
  return {
    metal: resources.metal + (gain.metal ?? 0),
    energy: resources.energy + (gain.energy ?? 0),
    goods: resources.goods + (gain.goods ?? 0),
  };
}

function spendResources(resources: Resources, cost: Resources): Resources {
  return {
    metal: resources.metal - cost.metal,
    energy: resources.energy - cost.energy,
    goods: resources.goods - cost.goods,
  };
}

/**
 * TODO: this is where new `Effect` variants get handled. Keep it exhaustive —
 * the switch has no default so TypeScript will flag any variant you forget.
 *
 * A `draw` effect pulls blueprints; contractors can only be taken from the
 * market by paying a token. TODO: some real cards may let you choose a deck.
 */
function applyEffect(state: GameState, playerIndex: number, effect: Effect): GameState {
  switch (effect.kind) {
    case "gain":
      return updatePlayer(state, playerIndex, (player) => ({
        ...player,
        resources: addResources(player.resources, effect.resources),
      }));
    case "draw":
      return drawBlueprints(state, playerIndex, effect.count);
  }
}

/** Terse effect summary for the log. Display formatting lives in `lib/format`. */
function describeEffectForLog(effect: Effect): string {
  switch (effect.kind) {
    case "gain": {
      const parts = (["metal", "energy", "goods"] as const)
        .filter((key) => effect.resources[key])
        .map((key) => `${effect.resources[key]} ${key}`);
      return `gained ${parts.join(", ")}`;
    }
    case "draw":
      return `drew ${effect.count}`;
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
      return log({ ...state, phase: "work", currentPlayerIndex: 0 }, PHASE_LABELS.work);
    case "work":
      return log({ ...state, phase: "cleanup", currentPlayerIndex: 0 }, PHASE_LABELS.cleanup);
    case "cleanup":
      return state; // cleanup advances the round itself, in endRound
  }
}

function refillBlueprintRow(
  pool: GameState["blueprints"],
  rng: Rng,
): { pool: GameState["blueprints"]; rng: Rng } {
  const missing = MARKET_ROW_SIZE - pool.row.length;
  if (missing <= 0) return { pool, rng };

  const { drawn, deck, discard, rng: next } = takeFromDeck(pool, missing, rng);
  return { pool: { row: [...pool.row, ...drawn], deck, discard }, rng: next };
}

/** Refills empty contractor slots. Tokens stay put; only the cards change. */
function refillContractorSlots(
  market: GameState["contractors"],
  rng: Rng,
): { market: GameState["contractors"]; rng: Rng } {
  const empty = market.slots.filter((slot) => slot.card === null).length;
  if (empty === 0) return { market, rng };

  const { drawn, deck, discard, rng: next } = takeFromDeck(market, empty, rng);
  const queue = [...drawn];
  const slots = market.slots.map((slot) =>
    slot.card === null ? { ...slot, card: queue.shift() ?? null } : slot,
  );
  return { market: { slots, deck, discard }, rng: next };
}

/** Discards dice, refreshes compounds, refills both rows, checks the end. */
function endRound(state: GameState): GameState {
  const players = state.players.map((player) => ({
    ...player,
    dice: [],
    compound: player.compound.map((building) => ({ ...building, activated: false })),
  }));

  const blueprints = refillBlueprintRow(state.blueprints, state.rng);
  const contractors = refillContractorSlots(state.contractors, blueprints.rng);

  const refilled: GameState = {
    ...state,
    players,
    blueprints: blueprints.pool,
    contractors: contractors.market,
    rng: contractors.rng,
  };

  const triggered = players.some(
    (player) =>
      player.resources.goods >= END_GOODS || player.compound.length >= END_COMPOUND_SIZE,
  );
  const round = refilled.round + 1;

  if (triggered || round > MAX_ROUNDS) {
    const reason = triggered ? "End condition met" : `Round cap (${MAX_ROUNDS}) reached`;
    return log(
      { ...refilled, gameOver: true, winner: decideWinner(refilled), round },
      `${reason} — game over`,
    );
  }

  return log(
    { ...refilled, round, phase: "market", currentPlayerIndex: 0 },
    `Round ${round} — ${PHASE_LABELS.market}`,
  );
}

/**
 * TODO: replace with real scoring. Most goods wins, compound size breaks the
 * tie, and a genuine tie returns null.
 */
function decideWinner(state: GameState): number | null {
  const ranked = state.players
    .map((player, index) => ({ index, player }))
    .sort(
      (a, b) =>
        b.player.resources.goods - a.player.resources.goods ||
        b.player.compound.length - a.player.compound.length,
    );

  const [best, runnerUp] = ranked;
  if (
    runnerUp &&
    best.player.resources.goods === runnerUp.player.resources.goods &&
    best.player.compound.length === runnerUp.player.compound.length
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
    case "draft": {
      if (state.phase !== "market") throw new Error("Drafting happens in the Market Phase");

      if (move.kind === "blueprint") {
        const card = state.blueprints.row.find((c) => c.id === move.cardId);
        if (!card) throw new Error(`No card ${move.cardId} in the blueprint row`);

        const taken = updatePlayer(
          {
            ...state,
            blueprints: {
              ...state.blueprints,
              row: state.blueprints.row.filter((c) => c.id !== card.id),
            },
          },
          index,
          (p) => ({ ...p, hand: [...p.hand, card] }),
        );
        return endTurn(log(taken, `${player.name} drafted ${card.name}`));
      }

      const slot = state.contractors.slots.find((s) => s.card?.id === move.cardId);
      if (!slot?.card) throw new Error(`No card ${move.cardId} in the contractor row`);

      const payment = player.hand.find((c) => c.id === move.paymentCardId);
      if (!payment) throw new Error(`${player.name} does not hold ${move.paymentCardId}`);
      if (payment.type !== slot.token) {
        throw new Error(
          `${slot.card.name} costs a ${slot.token} blueprint, but ${payment.name} is ${payment.type}`,
        );
      }

      // The contractor never reaches hand: it empties its slot, goes straight
      // to the contractor discard, and its effect resolves at once.
      const contractor = slot.card;
      const taken = updatePlayer(
        {
          ...state,
          contractors: {
            slots: state.contractors.slots.map((s) =>
              s.card?.id === contractor.id ? { ...s, card: null } : s,
            ),
            deck: state.contractors.deck,
            discard: [...state.contractors.discard, contractor],
          },
          // The blueprint spent as payment goes to the blueprint discard.
          blueprints: {
            ...state.blueprints,
            discard: [...state.blueprints.discard, payment],
          },
        },
        index,
        (p) => ({ ...p, hand: p.hand.filter((c) => c.id !== payment.id) }),
      );
      const resolved = applyEffect(taken, index, contractor.effect);
      return endTurn(
        log(
          resolved,
          `${player.name} took ${contractor.name} for ${payment.name} — ${describeEffectForLog(
            contractor.effect,
          )}`,
        ),
      );
    }

    case "rollDice": {
      if (state.phase !== "work") throw new Error("Dice are rolled in the Work Phase");
      if (player.dice.length > 0) throw new Error(`${player.name} already rolled`);

      let rng = state.rng;
      const dice: Die[] = [];
      for (let i = 0; i < player.workforce; i++) {
        const [value, next] = nextInt(rng, 6);
        rng = next;
        dice.push({
          id: `${player.id}-r${state.round}-d${i}`,
          face: (value + 1) as DieFace,
          color: player.color,
          spent: false,
        });
      }

      const rolled = updatePlayer({ ...state, rng }, index, (p) => ({ ...p, dice }));
      return log(rolled, `${player.name} rolled ${dice.map((d) => d.face).join(", ")}`);
    }

    case "build": {
      if (state.phase !== "work") throw new Error("Building happens in the Work Phase");
      const die = requireUnspentDie(player, move.dieId);
      const card = player.hand.find((c) => c.id === move.cardId);
      if (!card) throw new Error(`${player.name} does not hold ${move.cardId}`);
      if (card.kind !== "blueprint") throw new Error(`${card.name} is not a blueprint`);
      if (die.face < card.buildRequirement) {
        throw new Error(`${card.name} needs a die of ${card.buildRequirement} or more`);
      }
      if (!canAfford(player.resources, card.buildCost)) {
        throw new Error(`${player.name} cannot afford ${card.name}`);
      }

      const built = updatePlayer(state, index, (p) => ({
        ...spendDie(p, die.id),
        hand: p.hand.filter((c) => c.id !== card.id),
        compound: [...p.compound, { card, activated: false }],
        resources: spendResources(p.resources, card.buildCost),
      }));
      return log(built, `${player.name} built ${card.name}`);
    }

    case "activate": {
      if (state.phase !== "work") throw new Error("Activation happens in the Work Phase");
      const die = requireUnspentDie(player, move.dieId);
      const building = player.compound.find((b) => b.card.id === move.cardId);
      if (!building) throw new Error(`${player.name} has no building ${move.cardId}`);
      if (building.activated) throw new Error(`${building.card.name} already activated this round`);
      if (!satisfies(building.card.activation, die.face)) {
        throw new Error(`A ${die.face} does not activate ${building.card.name}`);
      }

      const marked = updatePlayer(state, index, (p) => ({
        ...spendDie(p, die.id),
        compound: p.compound.map((b) =>
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
