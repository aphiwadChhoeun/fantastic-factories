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

import { automaMarketAction, automaPayouts, groupByCategory, standing } from "./automa";
import { HQ_SECTIONS, hqPayout, hqSection, matchMultiplier } from "./headquarters";
import { nextInt, shuffle, type Rng } from "./rng";
import { MARKET_ROW_SIZE } from "./setup";
import {
  AUTOMA_DIE_COLORS,
  AUTOMA_MARKET_COLOR,
  DIE_FACES,
  EXTRA_DIE_COLOR,
  NO_PERKS,
  NO_PLACEMENTS,
  PHASE_LABELS,
  type ActivationRequirement,
  type BlueprintCard,
  type BlueprintPerk,
  type BlueprintTool,
  type Building,
  type Card,
  type DicePattern,
  type Die,
  type DieColor,
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

export function canAfford(resources: Resources, cost: Resources): boolean {
  return (
    resources.metal >= cost.metal &&
    resources.energy >= cost.energy &&
    resources.goods >= cost.goods
  );
}

/**
 * No compound holds two of the same blueprint — unless the card says it may be
 * stacked. Copies differ only by id, so the name is what counts.
 */
function alreadyBuilt(player: Player, card: BlueprintCard): boolean {
  if (card.duplicable) return false;
  return player.compound.some((building) => building.card.name === card.name);
}

/** Faces in a run with no gaps and no repeats: 2, 3, 4. */
function isConsecutive(faces: readonly DieFace[]): boolean {
  const sorted = [...faces].sort((a, b) => a - b);
  return sorted.every((face, i) => i === 0 || face === sorted[i - 1] + 1);
}

function fitsPattern(pattern: DicePattern, faces: readonly DieFace[]): boolean {
  switch (pattern) {
    case "any":
      return true;
    case "matching":
      return faces.every((face) => face === faces[0]);
    case "consecutive":
      return isConsecutive(faces);
  }
}

/**
 * What a player is worth: their goods, plus the prestige standing in their
 * compound. Blueprints still in hand are worth nothing — only what is built.
 */
export function scoreOf(player: Player): number {
  return player.resources.goods + prestigeOf(player.compound);
}

/**
 * The prestige in a compound. Each card scores its own, and a card with a set
 * bonus adds it once however many are up.
 */
export function prestigeOf(compound: readonly Building[]): number {
  const bonuses = new Map<string, number>();
  let total = 0;

  for (const { card } of compound) {
    total += card.prestige ?? 0;
    if (card.prestigeBonus) bonuses.set(card.name, card.prestigeBonus);
  }
  for (const bonus of bonuses.values()) total += bonus;

  return total;
}

function unspentDice(player: Player): Die[] {
  return player.dice.filter((die) => !die.spent);
}

/** The player's own workforce dice, as opposed to white contractor extras. */
function ownDice(player: Player): Die[] {
  return player.dice.filter((die) => !die.extra);
}

/** Blueprints in hand that could pay a slot carrying `token`. */
function paymentsFor(player: Player, token: BlueprintTool): BlueprintCard[] {
  return player.hand.filter((card) => card.tool === token);
}

/** Blueprints in hand that could pay to build `card` — same tool, not itself. */
function sameTool(player: Player, card: BlueprintCard): BlueprintCard[] {
  return player.hand.filter((other) => other.id !== card.id && other.tool === card.tool);
}

/**
 * What a perk charges for a particular set of dice: its printed cost, plus a
 * face-scaled part for the perks that read their price off the table. Charged
 * once for the set, so a Concrete Plant's 3, 3 costs three metal and not six.
 *
 * Exported because the board wants to warn about a price before the dice are
 * chosen, and this is the only place that knows how one is worked out.
 */
export function perkCost(perk: BlueprintPerk, faces: readonly DieFace[]): Resources {
  const { cost, costByFace } = perk;
  if (!costByFace || faces.length === 0) return cost;

  const face = faces[0];
  return {
    metal: cost.metal + (costByFace === "metal" ? face : 0),
    energy: cost.energy + (costByFace === "energy" ? face : 0),
    goods: cost.goods + (costByFace === "goods" ? face : 0),
  };
}

/**
 * The ways to take a discarded blueprint's build cost back, capped at `max`.
 * Under the cap there is one answer — all of it. Over it the player says which
 * resources to take, so every split is a move of its own.
 *
 * Goods never appear in a build cost, so nothing is lost by paying out none.
 */
function gainSplits(cost: Resources, max: number): Resources[] {
  if (cost.metal + cost.energy <= max) {
    return [{ metal: cost.metal, energy: cost.energy, goods: 0 }];
  }

  const splits: Resources[] = [];
  for (let metal = 0; metal <= cost.metal; metal++) {
    const energy = max - metal;
    if (energy < 0 || energy > cost.energy) continue;
    splits.push({ metal, energy, goods: 0 });
  }
  return splits;
}

function sameResources(a: Resources, b: Resources): boolean {
  return a.metal === b.metal && a.energy === b.energy && a.goods === b.goods;
}

/**
 * Every distinct set of dice that could work a building's perk right now. A
 * perk that takes no dice yields one empty set — it is still a move.
 */
function perkDice(player: Player, building: Building): Die[][] {
  const { perk } = building.card;
  if (!perk) return [];
  // A perk takes all its dice at once, so a used one is simply full. One that
  // takes none is marked used by `worked` instead.
  if (building.worked) return [];

  const usable = unspentDice(player).filter((die) => satisfies(perk.accepts, die.face));
  const sets = combinations(usable, perk.dice).filter((set) => {
    const faces = set.map((die) => die.face);
    // Affordability is per set, not per perk: a face-scaled price means the
    // same card is cheap on a pair of 1s and out of reach on a pair of 6s.
    return fitsPattern(perk.pattern, faces) && canAfford(player.resources, perkCost(perk, faces));
  });

  // Two dice showing the same face are interchangeable, so sets that differ
  // only by which of them was picked are the same move to a player.
  const seen = new Set<string>();
  return sets.filter((set) => {
    const signature = set
      .map((die) => die.face)
      .sort()
      .join(",");
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

/** Every `size`-sized subset, in order. Die counts are tiny, so this is cheap. */
function combinations<T>(items: readonly T[], size: number): T[][] {
  // Asking for none of them has exactly one answer, and it is not "no answer".
  if (size === 0) return [[]];
  if (size < 0 || size > items.length) return [];
  if (size === items.length) return [[...items]];
  if (size === 1) return items.map((item) => [item]);

  const [first, ...rest] = items;
  return [
    ...combinations(rest, size - 1).map((set) => [first, ...set]),
    ...combinations(rest, size),
  ];
}

export function legalMoves(state: GameState): Move[] {
  if (state.gameOver) return [];

  const player = currentPlayer(state);

  switch (state.phase) {
    case "market": {
      // The automaton does not shop. It rolls at the top of its turn and its
      // green die decides the rest, so it is only ever offered one move.
      if (player.isAi) {
        return player.rolled ? [{ type: "automaMarket" }] : [{ type: "rollDice" }];
      }

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
      // The automaton's dice were rolled before its market phase, and there is
      // nothing to decide: they pay out or they do not.
      if (player.isAi) return [{ type: "automaWork" }];

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

      // Building takes no die: it costs another blueprint of the same tool,
      // discarded from hand, plus the card's resource cost.
      for (const card of player.hand) {
        if (!canAfford(player.resources, card.buildCost)) continue;
        if (alreadyBuilt(player, card)) continue;
        for (const payment of sameTool(player, card)) {
          moves.push({ type: "build", cardId: card.id, paymentCardId: payment.id });
        }
      }

      for (const building of player.compound) {
        const effect = building.card.perk?.effect;
        for (const dice of perkDice(player, building)) {
          const dieIds = dice.map((die) => die.id);
          const cardId = building.card.id;

          // The Black Market eats a card out of hand and pays back what that
          // card cost, so every blueprint held is a different move — and one
          // that cost more than the cap is several, one per way to take it.
          if (effect?.kind === "discardForResources") {
            for (const payment of player.hand) {
              for (const gain of gainSplits(payment.buildCost, effect.max)) {
                moves.push({ type: "activate", cardId, dieIds, paymentCardId: payment.id, gain });
              }
            }
            continue;
          }

          moves.push({ type: "activate", cardId, dieIds });
        }
      }

      // Last, because the Headquarters is the fallback: it is always there, so
      // a die that can do something better should be seen doing it first.
      for (const die of unspentDice(player)) {
        for (const section of HQ_SECTIONS) {
          if (player.headquarters[section.id].length >= section.slots) continue;
          if (!satisfies(section.accepts, die.face)) continue;
          moves.push({ type: "placeDie", section: section.id, dieId: die.id });
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
    compound: [...p.compound, { card, dice: [], worked: false }],
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

/**
 * Feeds a blueprint out of hand to the Black Market and pays out `gain` — the
 * card's own build cost, or as much of it as the cap allows. Both the card and
 * the split were checked by the move that got here.
 */
function discardForResources(
  state: GameState,
  playerIndex: number,
  card: BlueprintCard,
  gain: Resources,
): GameState {
  const player = state.players[playerIndex];
  const traded = updatePlayer(
    {
      ...state,
      blueprints: { ...state.blueprints, discard: [...state.blueprints.discard, card] },
    },
    playerIndex,
    (p) => ({
      ...p,
      hand: p.hand.filter((c) => c.id !== card.id),
      resources: addResources(p.resources, gain),
    }),
  );
  return log(
    traded,
    `${player.name} sold ${card.name} — gained ${describeResourcesForLog(gain)}`,
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
 * The parts of an effect the card cannot decide for itself, settled by the
 * move that played it. Only the Black Market needs any: which blueprint it
 * eats, and which resources to take when that card cost more than it pays.
 */
type EffectChoice = {
  readonly discard?: BlueprintCard;
  readonly gain?: Resources;
};

/**
 * Reads an activation's card-and-payout choice off the move, and checks it.
 * Perks that ask for neither get an empty choice, and a move that offers one
 * anyway is a mistake worth hearing about.
 */
function discardChoice(
  player: Player,
  cardName: string,
  effect: Effect,
  move: Extract<Move, { type: "activate" }>,
): EffectChoice {
  if (effect.kind !== "discardForResources") {
    if (move.paymentCardId) throw new Error(`${cardName} does not take a blueprint`);
    return {};
  }

  if (!move.paymentCardId) throw new Error(`${cardName} needs a blueprint to discard`);
  const discard = player.hand.find((card) => card.id === move.paymentCardId);
  if (!discard) throw new Error(`${player.name} does not hold ${move.paymentCardId}`);

  // A card that cost more than the cap pays out only part of it, and which
  // part is the player's call — so it has to be on the move.
  const allowed = gainSplits(discard.buildCost, effect.max);
  if (!move.gain && allowed.length > 1) {
    throw new Error(`${cardName} pays at most ${effect.max} — say which resources to take`);
  }
  const gain = move.gain ?? allowed[0];
  if (!allowed.some((split) => sameResources(split, gain))) {
    throw new Error(
      `${discard.name} does not pay ${describeResourcesForLog(gain)} at ${cardName}`,
    );
  }

  return { discard, gain };
}

/**
 * TODO: this is where new `Effect` variants get handled. Keep it exhaustive —
 * the switch has no default so TypeScript will flag any variant you forget.
 *
 * A `draw` effect pulls blueprints; contractors can only be taken from the
 * market by paying a token. TODO: some real cards may let you choose a deck.
 */
function applyEffect(
  state: GameState,
  playerIndex: number,
  effect: Effect,
  choice: EffectChoice = {},
): GameState {
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
    case "discardForResources": {
      // Only an activation carries these, and only after checking them.
      const { discard, gain } = choice;
      if (!discard || !gain) throw new Error("No blueprint chosen to discard");
      return discardForResources(state, playerIndex, discard, gain);
    }
  }
}

/** "any face", "3 or less". Display formatting lives in `lib/format`. */
function describeRequirementForLog(requirement: ActivationRequirement): string {
  switch (requirement.kind) {
    case "any":
      return "any face";
    case "exact":
      return `a ${requirement.face}`;
    case "atLeast":
      return `${requirement.face} or more`;
    case "atMost":
      return `${requirement.face} or less`;
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
    // Logs the card and the haul itself, once both are known.
    case "discardForResources":
      return "selling a blueprint";
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

/** The automaton's die of a given colour — each one answers a question. */
function automaDie(player: Player, color: DieColor): Die {
  const die = player.dice.find((d) => d.color === color && !d.spent);
  if (!die) throw new Error(`${player.name} has no ${color} die to read`);
  return die;
}

/**
 * Stands a card up in the automaton's compound. Nothing is paid and nothing is
 * built — it simply joins its own type's group.
 */
function stand(state: GameState, index: number, card: BlueprintCard): GameState {
  return updatePlayer(state, index, (player) => ({
    ...player,
    compound: groupByCategory([...player.compound, standing(card)]),
  }));
}

/** Unique within a round: a player's dice pool only ever grows. */
function dieId(player: Player, round: number, offset = 0): string {
  return `${player.id}-r${round}-d${player.dice.length + offset}`;
}

/** Announces whose turn it is, and that it opens in the Market Phase. */
function beginTurn(state: GameState, playerIndex: number): GameState {
  return log(
    { ...state, phase: "market", currentPlayerIndex: playerIndex },
    `${state.players[playerIndex].name} — ${PHASE_LABELS.market}`,
  );
}

/**
 * Ends the current phase.
 *
 * A turn is market then work, taken by one player start to finish: the market
 * phase hands over to that same player's work phase, and only ending the work
 * phase passes the turn on. Cleanup runs once, after the last player's turn.
 */
function endTurn(state: GameState): GameState {
  const player = currentPlayer(state);

  switch (state.phase) {
    case "market":
      return log({ ...state, phase: "work" }, `${player.name} — ${PHASE_LABELS.work}`);
    case "work": {
      const next = state.currentPlayerIndex + 1;
      if (next < state.players.length) return beginTurn(state, next);
      return log({ ...state, phase: "cleanup", currentPlayerIndex: 0 }, PHASE_LABELS.cleanup);
    }
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
    headquarters: NO_PLACEMENTS,
    compound: player.compound.map((building) => ({ ...building, dice: [], worked: false })),
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

  // The new round opens with the first player's turn, market phase first.
  return beginTurn(log({ ...refilled, round }, `Round ${round}`), 0);
}

/**
 * The highest score wins, and an equal score is a draw — there is no tiebreak.
 */
function decideWinner(state: GameState): number | null {
  const ranked = state.players
    .map((player, index) => ({ index, score: scoreOf(player) }))
    .sort((a, b) => b.score - a.score);

  const [best, runnerUp] = ranked;
  if (runnerUp && best.score === runnerUp.score) return null;
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
      if (payment.tool !== slot.token) {
        throw new Error(
          `${slot.card.name} costs a ${slot.token} blueprint, but ${payment.name} is ${payment.tool}`,
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
      if (player.rolled) throw new Error(`${player.name} already rolled`);

      // The automaton rolls at the top of its turn instead of at the start of
      // its Work Phase, because its green die is what shops for it.
      if (player.isAi) {
        if (state.phase !== "market") {
          throw new Error(`${player.name} rolls at the start of its turn`);
        }

        let rng = state.rng;
        const dice: Die[] = AUTOMA_DIE_COLORS.map((color, i) => {
          const [value, next] = nextInt(rng, 6);
          rng = next;
          return {
            id: dieId(player, state.round, i),
            face: (value + 1) as DieFace,
            color,
            extra: false,
            spent: false,
          };
        });

        const rolled = updatePlayer({ ...state, rng }, index, (p) => ({
          ...p,
          dice,
          rolled: true,
        }));
        const faces = dice.map((die) => `${die.color} ${die.face}`).join(", ");
        return log(rolled, `${player.name} rolled ${faces}`);
      }

      if (state.phase !== "work") throw new Error("Dice are rolled in the Work Phase");

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

    case "placeDie": {
      if (state.phase !== "work") throw new Error("Dice are placed in the Work Phase");
      const die = requireUnspentDie(player, move.dieId);
      const section = hqSection(move.section);
      const placed = player.headquarters[section.id];

      if (placed.length >= section.slots) {
        throw new Error(`${section.name} is full — ${section.slots} dice already`);
      }
      if (!satisfies(section.accepts, die.face)) {
        throw new Error(
          `${section.name} takes ${describeRequirementForLog(section.accepts)}, not a ${die.face}`,
        );
      }

      // Matching what is already on the section multiplies the payout.
      const multiplier = matchMultiplier(placed, die.face);
      const payout = hqPayout(section.reward, die.face, multiplier);

      const occupied = updatePlayer(state, index, (p) => ({
        ...spendDie(p, die.id),
        headquarters: { ...p.headquarters, [section.id]: [...placed, die.face] },
      }));
      const bonus = multiplier > 1 ? ` ×${multiplier} for matching` : "";
      const announced = log(
        occupied,
        `${player.name} placed a ${die.face} on ${section.name}${bonus} — ${describeEffectForLog(
          payout,
        )}`,
      );
      return applyEffect(announced, index, payout);
    }

    case "build": {
      if (state.phase !== "work") throw new Error("Building happens in the Work Phase");
      const card = player.hand.find((c) => c.id === move.cardId);
      if (!card) throw new Error(`${player.name} does not hold ${move.cardId}`);

      const payment = player.hand.find((c) => c.id === move.paymentCardId);
      if (!payment) throw new Error(`${player.name} does not hold ${move.paymentCardId}`);
      if (payment.id === card.id) {
        throw new Error(`${card.name} cannot pay for itself`);
      }
      if (payment.tool !== card.tool) {
        throw new Error(
          `${card.name} costs a ${card.tool} blueprint, but ${payment.name} is ${payment.tool}`,
        );
      }
      if (!canAfford(player.resources, card.buildCost)) {
        throw new Error(`${player.name} cannot afford ${card.name}`);
      }
      if (alreadyBuilt(player, card)) {
        throw new Error(`${player.name} has already built ${card.name}`);
      }

      const built = updatePlayer(
        {
          ...state,
          // The card spent as payment goes to the blueprint discard.
          blueprints: {
            ...state.blueprints,
            discard: [...state.blueprints.discard, payment],
          },
        },
        index,
        (p) => ({
          ...p,
          hand: p.hand.filter((c) => c.id !== card.id && c.id !== payment.id),
          compound: [...p.compound, { card, dice: [], worked: false }],
          resources: spendResources(p.resources, card.buildCost),
        }),
      );
      const price = costsNothing(card.buildCost)
        ? payment.name
        : `${payment.name} and ${describeResourcesForLog(card.buildCost)}`;
      return log(built, `${player.name} built ${card.name} for ${price}`);
    }

    case "activate": {
      if (state.phase !== "work") throw new Error("Activation happens in the Work Phase");
      const building = player.compound.find((b) => b.card.id === move.cardId);
      if (!building) throw new Error(`${player.name} has no building ${move.cardId}`);

      const { perk } = building.card;
      if (!perk) throw new Error(`${building.card.name} has no perk to work`);
      if (building.worked) {
        throw new Error(`${building.card.name} was already used this round`);
      }
      if (move.dieIds.length !== perk.dice) {
        throw new Error(
          `${building.card.name} takes ${perk.dice} dice, not ${move.dieIds.length}`,
        );
      }
      if (new Set(move.dieIds).size !== move.dieIds.length) {
        throw new Error(`${building.card.name} cannot take the same die twice`);
      }

      const dice = move.dieIds.map((id) => requireUnspentDie(player, id));
      for (const die of dice) {
        if (!satisfies(perk.accepts, die.face)) {
          throw new Error(`A ${die.face} does not work ${building.card.name}`);
        }
      }
      const faces = dice.map((die) => die.face);
      if (!fitsPattern(perk.pattern, faces)) {
        throw new Error(`${building.card.name} needs ${perk.pattern} dice`);
      }
      // Some perks read their price off the dice, so it is only known now.
      const cost = perkCost(perk, faces);
      if (!canAfford(player.resources, cost)) {
        throw new Error(`${building.card.name} costs ${describeResourcesForLog(cost)} to use`);
      }

      // A perk that eats a card takes it from hand on top of everything else.
      const choice = discardChoice(player, building.card.name, perk.effect, move);

      const used = updatePlayer(state, index, (p) => ({
        ...dice.reduce((spent, die) => spendDie(spent, die.id), p),
        compound: p.compound.map((b) =>
          b.card.id === building.card.id ? { ...b, dice: faces, worked: true } : b,
        ),
        resources: spendResources(p.resources, cost),
      }));
      const paid = costsNothing(cost) ? "" : ` for ${describeResourcesForLog(cost)}`;
      const withDice = faces.length > 0 ? ` with ${faces.join(", ")}` : "";
      const announced = log(
        used,
        `${player.name} worked ${building.card.name}${withDice}${paid}`,
      );
      return applyEffect(announced, index, perk.effect, choice);
    }

    case "automaMarket": {
      if (state.phase !== "market") throw new Error("The market is shopped in the Market Phase");
      if (!player.isAi) throw new Error(`${player.name} shops for themselves`);

      const die = automaDie(player, AUTOMA_MARKET_COLOR);
      const action = automaMarketAction(die.face);
      const read = `${player.name} read a ${die.face}`;
      // The green die is used up saying this, whatever it said.
      const base = updatePlayer(state, index, (p) => spendDie(p, die.id));

      if (action.kind === "takeFromRow") {
        const seat = action.index + 1;
        const card = base.blueprints.row[action.index];
        if (!card) return endTurn(log(base, `${read} — slot ${seat} was empty`));

        const refilled = refillBlueprintRow(
          { ...base.blueprints, row: base.blueprints.row.filter((c) => c.id !== card.id) },
          base.rng,
        );
        const taken = stand(
          { ...base, blueprints: refilled.pool, rng: refilled.rng },
          index,
          card,
        );
        return endTurn(log(taken, `${read} — took ${card.name} from slot ${seat}`));
      }

      // A 5 or a 6 hands it the top of the deck and then clears a whole row
      // out from under everyone.
      const draw = takeFromDeck(base.blueprints, 1, base.rng);
      const [revealed] = draw.drawn;
      const drawn: GameState = {
        ...base,
        rng: draw.rng,
        blueprints: { ...base.blueprints, deck: draw.deck, discard: draw.discard },
      };
      const stood = revealed ? stand(drawn, index, revealed) : drawn;
      const opening = revealed
        ? `${read} — revealed ${revealed.name}`
        : `${read} — the blueprint deck was empty`;

      if (action.sweep === "blueprints") {
        // Refill from the deck before the swept cards join the discard, so a
        // reshuffle cannot deal the same row straight back out.
        const swept = stood.blueprints.row;
        const refilled = refillBlueprintRow({ ...stood.blueprints, row: [] }, stood.rng);
        return endTurn(
          log(
            {
              ...stood,
              rng: refilled.rng,
              blueprints: {
                ...refilled.pool,
                discard: [...refilled.pool.discard, ...swept],
              },
            },
            `${opening}, and swept the blueprint row away`,
          ),
        );
      }

      const swept = stood.contractors.slots.flatMap((slot) => (slot.card ? [slot.card] : []));
      const refilled = refillContractorSlots(
        {
          ...stood.contractors,
          slots: stood.contractors.slots.map((slot) => ({ ...slot, card: null })),
        },
        stood.rng,
      );
      return endTurn(
        log(
          {
            ...stood,
            rng: refilled.rng,
            contractors: {
              ...refilled.market,
              discard: [...refilled.market.discard, ...swept],
            },
          },
          `${opening}, and swept the contractor row away`,
        ),
      );
    }

    case "automaWork": {
      if (state.phase !== "work") throw new Error("Goods are produced in the Work Phase");
      if (!player.isAi) throw new Error(`${player.name} works for themselves`);

      const payouts = automaPayouts(player.compound, player.dice);
      const paid = payouts.filter((payout) => payout.produced);

      const worked = updatePlayer(state, index, (p) => ({
        ...p,
        // Nothing else reads them, and spent dice show as done on the board.
        dice: p.dice.map((die) => ({ ...die, spent: true })),
        resources: addResources(p.resources, { goods: paid.length }),
      }));

      return endTurn(
        log(
          worked,
          paid.length === 0
            ? `${player.name} produced nothing`
            : `${player.name} produced ${paid.length} good${paid.length === 1 ? "" : "s"} — ${paid
                .map((payout) => payout.category)
                .join(", ")}`,
        ),
      );
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
