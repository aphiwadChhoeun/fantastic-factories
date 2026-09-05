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
  DIE_FACES,
  EXTRA_DIE_COLOR,
  NO_PERKS,
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
  type WorkPerks,
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

/** Costs nothing beyond its slot's token — most contractors. */
const NO_COST: Resources = { metal: 0, energy: 0, goods: 0 };

function canAfford(resources: Resources, cost: Resources): boolean {
  return (
    resources.metal >= cost.metal &&
    resources.energy >= cost.energy &&
    resources.goods >= cost.goods
  );
}

/**
 * No compound holds two of the same blueprint. Copies differ only by id, so
 * the name is what counts.
 */
function alreadyBuilt(player: Player, card: BlueprintCard): boolean {
  return player.compound.some((building) => building.card.name === card.name);
}

function unspentDice(player: Player): Die[] {
  return player.dice.filter((die) => !die.spent);
}

/** The player's own workforce dice, as opposed to white contractor extras. */
function ownDice(player: Player): Die[] {
  return player.dice.filter((die) => !die.extra);
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
      // no matching blueprint in hand simply offers nothing. A few also charge
      // resources on top, which can put one out of reach entirely.
      for (const slot of state.contractors.slots) {
        if (!slot.card) continue;
        if (!canAfford(player.resources, slot.card.extraCost ?? NO_COST)) continue;
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
      // Nothing else happens until the dice are on the table.
      if (!player.rolled) {
        const moves: Move[] = [];
        // A Foreman lets you name faces instead of rolling them. Placing fewer
        // than you may is allowed: the rest are rolled.
        if (player.perks.chooseOwnFaces > 0 && ownDice(player).length < player.workforce) {
          for (const face of DIE_FACES) moves.push({ type: "setDie", face });
        }
        moves.push({ type: "rollDice" });
        return moves;
      }

      // A Specialist's die is set before anything is spent. The roll is
      // already face-up, so deciding now costs the player nothing.
      if (player.perks.extraChosen > 0) {
        return DIE_FACES.map((face) => ({ type: "setDie", face }));
      }

      const moves: Move[] = [];
      for (const die of unspentDice(player)) {
        for (const card of player.hand) {
          if (
            die.face >= card.buildRequirement &&
            canAfford(player.resources, card.buildCost) &&
            !alreadyBuilt(player, card)
          ) {
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
 * Digs through the blueprint deck for a card this player has not already
 * built, then stands it in the compound for free — no die, no build cost.
 *
 * Passed-over duplicates are held aside until the search ends rather than
 * discarded as they go: a reshuffle mid-search would otherwise deal the same
 * duplicate straight back and spin forever. Once both piles are exhausted the
 * search gives up, which is the only way this builds nothing.
 */
function buildFromDeck(state: GameState, playerIndex: number): GameState {
  const player = state.players[playerIndex];
  const skipped: BlueprintCard[] = [];
  let source: DrawSource<BlueprintCard> = state.blueprints;
  let rng = state.rng;
  let chosen: BlueprintCard | null = null;

  for (;;) {
    const draw = takeFromDeck(source, 1, rng);
    rng = draw.rng;
    source = { deck: draw.deck, discard: draw.discard };

    const [card] = draw.drawn;
    if (!card) break;
    if (alreadyBuilt(player, card)) {
      skipped.push(card);
      continue;
    }
    chosen = card;
    break;
  }

  const searched: GameState = {
    ...state,
    rng,
    blueprints: {
      ...state.blueprints,
      deck: source.deck,
      discard: [...source.discard, ...skipped],
    },
  };

  const aside =
    skipped.length > 0
      ? ` (discarded ${skipped.length} already-built blueprint${skipped.length === 1 ? "" : "s"})`
      : "";

  const card = chosen;
  if (!card) {
    return log(searched, `${player.name} found no new blueprint to build${aside}`);
  }

  const built = updatePlayer(searched, playerIndex, (p) => ({
    ...p,
    compound: [...p.compound, { card, activated: false }],
  }));
  return log(built, `${player.name} built ${card.name} for free${aside}`);
}

/**
 * Turns the top blueprint face up, pays out its build cost in metal and
 * energy, and discards it. The card is only ever revealed — it does not reach
 * hand. Goods never appear in a build cost, so nothing is lost by ignoring
 * that field.
 */
function revealForResources(state: GameState, playerIndex: number): GameState {
  const player = state.players[playerIndex];
  const { drawn, deck, discard, rng } = takeFromDeck(state.blueprints, 1, state.rng);
  const [card] = drawn;

  const searched: GameState = {
    ...state,
    rng,
    blueprints: { ...state.blueprints, deck, discard },
  };
  if (!card) return log(searched, `${player.name} had no blueprint left to reveal`);

  const gain = { metal: card.buildCost.metal, energy: card.buildCost.energy };
  const revealed: GameState = {
    ...searched,
    blueprints: { ...searched.blueprints, discard: [...discard, card] },
  };
  const paid = updatePlayer(revealed, playerIndex, (p) => ({
    ...p,
    resources: addResources(p.resources, gain),
  }));
  return log(
    paid,
    `${player.name} revealed ${card.name} — gained ${describeResourcesForLog(gain)}`,
  );
}

function grantPerks(state: GameState, playerIndex: number, grant: Partial<WorkPerks>): GameState {
  return updatePlayer(state, playerIndex, (player) => ({
    ...player,
    perks: {
      chooseOwnFaces: player.perks.chooseOwnFaces + (grant.chooseOwnFaces ?? 0),
      extraRolled: player.perks.extraRolled + (grant.extraRolled ?? 0),
      extraChosen: player.perks.extraChosen + (grant.extraChosen ?? 0),
    },
  }));
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
    case "buildFromDeck":
      return buildFromDeck(state, playerIndex);
    case "revealForResources":
      return revealForResources(state, playerIndex);
    case "chooseOwnFaces":
      return grantPerks(state, playerIndex, { chooseOwnFaces: effect.count });
    case "extraDice":
      return grantPerks(
        state,
        playerIndex,
        effect.chosen ? { extraChosen: effect.count } : { extraRolled: effect.count },
      );
  }
}

/** "2 metal, 1 energy". Display formatting lives in `lib/format`. */
function describeResourcesForLog(resources: Partial<Resources>): string {
  const parts = (["metal", "energy", "goods"] as const)
    .filter((key) => resources[key])
    .map((key) => `${resources[key]} ${key}`);
  return parts.length > 0 ? parts.join(", ") : "nothing";
}

function costsNothing(cost: Resources): boolean {
  return cost.metal === 0 && cost.energy === 0 && cost.goods === 0;
}

/** Terse effect summary for the log. Display formatting lives in `lib/format`. */
function describeEffectForLog(effect: Effect): string {
  switch (effect.kind) {
    case "gain":
      return `gained ${describeResourcesForLog(effect.resources)}`;
    case "draw":
      return `drew ${effect.count}`;
    // These two log what actually happened themselves.
    case "buildFromDeck":
      return "building from the deck";
    case "revealForResources":
      return "revealing the top blueprint";
    case "chooseOwnFaces":
      return `may set ${effect.count} of their dice this round`;
    case "extraDice": {
      const dice = `${effect.count} extra white ${effect.count === 1 ? "die" : "dice"}`;
      return effect.chosen ? `gets ${dice} at a face of their choice` : `rolls ${dice}`;
    }
  }
}

function spendDie(player: Player, dieId: string): Player {
  return {
    ...player,
    dice: player.dice.map((die) => (die.id === dieId ? { ...die, spent: true } : die)),
  };
}

function requireUnspentDie(player: Player, id: string): Die {
  const die = player.dice.find((d) => d.id === id);
  if (!die) throw new Error(`${player.name} has no die ${id}`);
  if (die.spent) throw new Error(`Die ${id} was already spent`);
  return die;
}

/** Unique within a round: a player's dice pool only ever grows. */
function dieId(player: Player, round: number, offset = 0): string {
  return `${player.id}-r${round}-d${player.dice.length + offset}`;
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

/**
 * Refills empty contractor slots. Tokens stay put; only the cards change.
 * Leaves a slot empty when both the deck and the discard have run dry.
 */
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

/**
 * Discards dice, refreshes compounds, checks the end. Rows refill the moment a
 * card is taken, so the refill here only catches up a row that was left short
 * because both its deck and its discard were empty at the time.
 */
function endRound(state: GameState): GameState {
  // Dice clear — which is also how white contractor dice are handed back —
  // along with anything a contractor promised for this round only.
  const players = state.players.map((player) => ({
    ...player,
    dice: [],
    rolled: false,
    perks: NO_PERKS,
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

        // The gap closes at once: the next player always faces a full row.
        const refilled = refillBlueprintRow(
          { ...state.blueprints, row: state.blueprints.row.filter((c) => c.id !== card.id) },
          state.rng,
        );

        const taken = updatePlayer(
          { ...state, blueprints: refilled.pool, rng: refilled.rng },
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

      const extraCost = slot.card.extraCost ?? NO_COST;
      if (!canAfford(player.resources, extraCost)) {
        throw new Error(
          `${slot.card.name} also costs ${describeResourcesForLog(extraCost)}, which ${
            player.name
          } cannot pay`,
        );
      }

      // The contractor never reaches hand: it empties its slot, goes straight
      // to the contractor discard, and its effect resolves at once.
      const contractor = slot.card;

      // Refill before the taken card joins the discard, so a reshuffle here
      // cannot deal it straight back into the slot it just left.
      const refilled = refillContractorSlots(
        {
          ...state.contractors,
          slots: state.contractors.slots.map((s) =>
            s.card?.id === contractor.id ? { ...s, card: null } : s,
          ),
        },
        state.rng,
      );

      const taken = updatePlayer(
        {
          ...state,
          contractors: {
            ...refilled.market,
            discard: [...refilled.market.discard, contractor],
          },
          rng: refilled.rng,
          // The blueprint spent as payment goes to the blueprint discard.
          blueprints: {
            ...state.blueprints,
            discard: [...state.blueprints.discard, payment],
          },
        },
        index,
        (p) => ({
          ...p,
          hand: p.hand.filter((c) => c.id !== payment.id),
          resources: spendResources(p.resources, extraCost),
        }),
      );

      // Announced before it resolves, so effects that log their own detail —
      // the Engineer's free build — read in the order they happened.
      const price = costsNothing(extraCost)
        ? payment.name
        : `${payment.name} and ${describeResourcesForLog(extraCost)}`;
      const announced = log(
        taken,
        `${player.name} took ${contractor.name} for ${price} — ${describeEffectForLog(
          contractor.effect,
        )}`,
      );
      return endTurn(applyEffect(announced, index, contractor.effect));
    }

    case "setDie": {
      if (state.phase !== "work") throw new Error("Dice are set in the Work Phase");

      // Before the roll it is one of your own, from a Foreman; after it, a
      // white extra from a Specialist. Never anything else.
      const extra = player.rolled;
      if (extra) {
        if (player.perks.extraChosen <= 0) {
          throw new Error(`${player.name} has no extra die to set`);
        }
      } else {
        if (player.perks.chooseOwnFaces <= 0) {
          throw new Error(`${player.name} has no die faces to choose`);
        }
        if (ownDice(player).length >= player.workforce) {
          throw new Error(`${player.name} has no unrolled dice left to set`);
        }
      }

      const die: Die = {
        id: dieId(player, state.round),
        face: move.face,
        color: extra ? EXTRA_DIE_COLOR : player.color,
        extra,
        spent: false,
      };

      const set = updatePlayer(state, index, (p) => ({
        ...p,
        dice: [...p.dice, die],
        perks: extra
          ? { ...p.perks, extraChosen: p.perks.extraChosen - 1 }
          : { ...p.perks, chooseOwnFaces: p.perks.chooseOwnFaces - 1 },
      }));
      return log(
        set,
        `${player.name} set ${extra ? "an extra white die" : "a die"} to ${move.face}`,
      );
    }

    case "rollDice": {
      if (state.phase !== "work") throw new Error("Dice are rolled in the Work Phase");
      if (player.rolled) throw new Error(`${player.name} already rolled`);

      // Whatever a Foreman did not already place, plus any white extras.
      const own = player.workforce - ownDice(player).length;

      let rng = state.rng;
      const dice: Die[] = [];
      for (let i = 0; i < own + player.perks.extraRolled; i++) {
        const [value, next] = nextInt(rng, 6);
        rng = next;
        dice.push({
          id: dieId(player, state.round, i),
          face: (value + 1) as DieFace,
          color: i < own ? player.color : EXTRA_DIE_COLOR,
          extra: i >= own,
          spent: false,
        });
      }

      const rolled = updatePlayer({ ...state, rng }, index, (p) => ({
        ...p,
        dice: [...p.dice, ...dice],
        rolled: true,
        perks: { ...p.perks, extraRolled: 0 },
      }));
      const faces = dice.map((d) => d.face).join(", ");
      return log(
        rolled,
        faces.length > 0
          ? `${player.name} rolled ${faces}`
          : `${player.name} kept their chosen dice`,
      );
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
      if (alreadyBuilt(player, card)) {
        throw new Error(`${player.name} has already built ${card.name}`);
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
      if (state.phase === "work" && !player.rolled) {
        throw new Error(`${player.name} must roll before passing`);
      }
      if (state.phase === "work" && player.perks.extraChosen > 0) {
        throw new Error(`${player.name} must set their extra die before passing`);
      }
      return endTurn(state);
    }
  }
}

/** Convenience for AI loops and tests. */
export function applyMoves(state: GameState, moves: readonly Move[]): GameState {
  return moves.reduce(applyMove, state);
}
