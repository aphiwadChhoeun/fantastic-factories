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
  oppositeFace,
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
  type Stock,
  type WorkPerks,
} from "./types";

/** A player who reaches either threshold ends the game. */
export const END_GOODS = 12;
export const END_COMPOUND_SIZE = 10;

/**
 * What may be carried out of a Work Phase. Anything over comes off before the
 * phase can end — the player chooses what goes.
 *
 * The resource limit counts metal and energy together and ignores goods: goods
 * are score, not stock, and are what `END_GOODS` watches instead. That the two
 * numbers happen to match is a coincidence, not a shared rule.
 */
export const RESOURCE_LIMIT = 12;
export const HAND_LIMIT = 10;

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

/**
 * What a blueprint costs this player to build, which is not always what is
 * printed on it: the Megalith takes a metal off for every Monument already
 * standing, and never goes below nothing.
 *
 * Worked out when the card is built, off the compound as it is then — so the
 * discount is on the card being built rather than on one already up, and the
 * first Megalith is as cheap as the Beacons beside it make it.
 *
 * Exported because the board has to show the price the player will pay.
 */
export function buildCostFor(player: Player, card: BlueprintCard): Resources {
  const { passive } = card;
  if (passive?.kind !== "cheaperPerCard") return card.buildCost;

  const off = player.compound.filter((building) => building.card.type === passive.per).length;
  return { ...card.buildCost, metal: Math.max(0, card.buildCost.metal - off) };
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

/** Both stock resources, for enumerating what a forced discard may take. */
const STOCK: readonly Stock[] = ["metal", "energy"];

/** Metal and energy together — what the end-of-phase limit counts. */
export function stockOf(resources: Resources): number {
  return resources.metal + resources.energy;
}

/**
 * How far over the end-of-phase limits a player is, in each. Zeroes mean the
 * Work Phase may end.
 *
 * Exported because the board has to say what is being asked for before the
 * player can be expected to give anything up.
 */
export function overLimits(player: Player): { resources: number; cards: number } {
  return {
    resources: Math.max(0, stockOf(player.resources) - RESOURCE_LIMIT),
    cards: Math.max(0, player.hand.length - HAND_LIMIT),
  };
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

/**
 * The alternatives a perk offers, in the order a move indexes them. Empty
 * when there is no choice to make, which is most perks.
 *
 * `eaten` is the blueprints the perk is about to take, which the Black Market's
 * payout is worked out from and everything else ignores.
 *
 * Exported because the board has to put a name to each one before the player
 * can pick between them.
 */
export function activationOptions(
  perk: BlueprintPerk,
  eaten: readonly BlueprintCard[],
): Effect[] {
  return optionsOf(perk.effect, eaten);
}

/**
 * Looks inside `all` for the choice, since the Manufactory's is bundled with
 * a payout that is not in question. One choice point per perk: two would share
 * an index and mean nothing, and no card has two.
 */
function optionsOf(effect: Effect, eaten: readonly BlueprintCard[]): Effect[] {
  if (effect.kind === "oneOf") return [...effect.options];
  if (effect.kind === "all") return effect.effects.flatMap((part) => optionsOf(part, eaten));
  if (effect.kind === "gainCardCost" && eaten.length > 0) {
    // Everything eaten pays, so several cards are one pot rather than several
    // payouts. Only the Black Market's single card uses this today.
    const pot = eaten.reduce((total, card) => addResources(total, card.buildCost), NO_COST);
    return gainSplits(pot, effect.max).map((resources) => ({ kind: "gain", resources }));
  }
  return [];
}

/**
 * Whether a perk hands over a die, and so needs a face named on the move.
 *
 * Does not look inside `oneOf`: an option that wanted a face would need one
 * only when that option was taken, and no card does that yet.
 */
function needsFace(effect: Effect): boolean {
  if (effect.kind === "gainDie") return true;
  if (effect.kind === "all") return effect.effects.some(needsFace);
  return false;
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
        if (!canAfford(player.resources, buildCostFor(player, card))) continue;
        if (alreadyBuilt(player, card)) continue;
        for (const payment of sameTool(player, card)) {
          moves.push({ type: "build", cardId: card.id, paymentCardId: payment.id });
        }
      }

      for (const building of player.compound) {
        const perk = building.card.perk;
        const effect = perk?.effect;
        for (const dice of perkDice(player, building)) {
          const dieIds = dice.map((die) => die.id);
          const cardId = building.card.id;

          // A perk that changes a die names the one it acts on rather than one
          // it spends, so it is one move per face on the table — two dice
          // showing the same number change to the same thing. A face it cannot
          // touch is no move at all.
          if (effect && changesDie(effect)) {
            const seen = new Set<DieFace>();
            for (const die of unspentDice(player)) {
              if (seen.has(die.face)) continue;
              if (changedFace(effect, die.face) === null) continue;
              seen.add(die.face);
              moves.push({ type: "activate", cardId, dieIds, targetDieId: die.id });
            }
            continue;
          }
          if (!perk) continue;

          // What is left to settle: the face of a die it hands over, which
          // blueprints it eats, and which of its alternatives is taken. Most
          // perks settle none of these and are a single move.
          const faces = needsFace(perk.effect)
            ? DIE_FACES.filter((face) => canAfford(player.resources, perkCost(perk, [face])))
            : [undefined];
          // Every way to feed it out of hand. A perk that eats more cards than
          // are held has no move at all, and one that eats none has exactly
          // one — the empty set.
          const meals = combinations(player.hand, perk.discardsCards ?? 0);

          for (const meal of meals) {
            const options = activationOptions(perk, meal);
            const chosen = options.length > 1 ? options.map((_, index) => index) : [undefined];
            for (const face of faces) {
              for (const option of chosen) {
                moves.push({
                  type: "activate",
                  cardId,
                  dieIds,
                  ...(meal.length > 0 ? { paymentCardIds: meal.map((card) => card.id) } : {}),
                  ...(face === undefined ? {} : { face }),
                  ...(option === undefined ? {} : { option }),
                });
              }
            }
          }
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

      // Nothing carries more than the limits out of a Work Phase. While a
      // player is over, the way down is offered and `endPhase` is not —
      // though everything else stays on, since spending is also a way down.
      const over = overLimits(player);
      if (over.resources > 0) {
        for (const resource of STOCK) {
          if (player.resources[resource] > 0) {
            moves.push({ type: "discard", kind: "resource", resource });
          }
        }
      }
      if (over.cards > 0) {
        for (const card of player.hand) {
          moves.push({ type: "discard", kind: "card", cardId: card.id });
        }
      }
      if (over.resources === 0 && over.cards === 0) moves.push({ type: "endPhase" });

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
 * Adds resources, and lets anything watching for them fire.
 *
 * Every payout goes through here rather than touching `resources` directly,
 * which is what keeps a passive from being missed when a new card gains goods
 * by some route nobody thought of yet.
 */
function gainResources(
  state: GameState,
  playerIndex: number,
  gain: Partial<Resources>,
): GameState {
  const added = updatePlayer(state, playerIndex, (player) => ({
    ...player,
    resources: addResources(player.resources, gain),
  }));
  return (gain.goods ?? 0) > 0 ? drawOnGoods(added, playerIndex) : added;
}

/**
 * The Laboratory: the first goods of the round draw a blueprint. It spends its
 * `worked` flag doing so, which is what holds it to once a round however many
 * goods arrive, and cleanup clears that with everything else.
 *
 * The automaton never works a perk, and a card in hand would be the first it
 * ever held, so its Laboratories sit quiet like the rest of its compound.
 */
function drawOnGoods(state: GameState, playerIndex: number): GameState {
  const player = state.players[playerIndex];
  if (player.isAi) return state;

  const lab = player.compound.find(
    (building) => building.card.passive?.kind === "drawOnGoods" && !building.worked,
  );
  if (!lab) return state;

  const spent = updatePlayer(state, playerIndex, (p) => ({
    ...p,
    compound: p.compound.map((building) =>
      building.card.id === lab.card.id ? { ...building, worked: true } : building,
    ),
  }));
  return log(
    drawBlueprints(spent, playerIndex, 1),
    `${player.name} drew a blueprint from ${lab.card.name}`,
  );
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

/** Perks that change a die on the table rather than spending one. */
function changesDie(effect: Effect): boolean {
  return effect.kind === "flipDie" || effect.kind === "stepDie";
}

/**
 * What such a perk would leave a die showing, or null if it cannot touch that
 * face at all — a step that would run off the die is no move, which is what
 * keeps the Fitness Center off a 1.
 */
function changedFace(effect: Effect, face: DieFace): DieFace | null {
  if (effect.kind === "flipDie") return oppositeFace(face);
  if (effect.kind === "stepDie") {
    const next = face + effect.by;
    return next >= 1 && next <= 6 ? (next as DieFace) : null;
  }
  return null;
}

/**
 * Changes a die where it lies. It is not spent and it does not go on the card
 * — the whole point is to use it afterwards at the face it now shows.
 */
function setDieFace(
  state: GameState,
  playerIndex: number,
  target: Die,
  face: DieFace,
): GameState {
  const player = state.players[playerIndex];
  const changed = updatePlayer(state, playerIndex, (p) => ({
    ...p,
    dice: p.dice.map((die) => (die.id === target.id ? { ...die, face } : die)),
  }));
  return log(changed, `${player.name} turned a ${target.face} into a ${face}`);
}

/**
 * Hands over an extra die at the face bought. White and flagged `extra` like a
 * contractor's loan, so cleanup takes it back with everything else.
 */
function grantDie(state: GameState, playerIndex: number, face: DieFace): GameState {
  const player = state.players[playerIndex];
  const die: Die = {
    id: dieId(player, state.round),
    face,
    color: EXTRA_DIE_COLOR,
    extra: true,
    spent: false,
  };
  return log(
    updatePlayer(state, playerIndex, (p) => ({ ...p, dice: [...p.dice, die] })),
    `${player.name} bought an extra white die showing ${face}`,
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
 * The parts of an activation the card cannot decide for itself, settled by the
 * move that played it: which blueprints it eats, which of several payouts is
 * taken, which die it acts on, which face it sells.
 */
type EffectChoice = {
  /** The blueprints eaten out of hand. Empty for the perks that eat none. */
  readonly eaten?: readonly BlueprintCard[];
  /** Which of the perk's alternatives was taken, already resolved. */
  readonly chosen?: Effect;
  /** The die a perk acts on without spending — the Dojo turns it over. */
  readonly target?: Die;
  /** The face of a die the perk hands over — the Golem, the Mega Factory. */
  readonly face?: DieFace;
  /** The faces placed on the perk, for a payout that reads one. */
  readonly faces?: readonly DieFace[];
};

/**
 * Reads an activation's choices off the move, and checks them. Perks that ask
 * for nothing get an empty choice, and a move that offers something anyway is
 * a mistake worth hearing about.
 */
function activationChoice(
  player: Player,
  cardName: string,
  perk: BlueprintPerk,
  move: Extract<Move, { type: "activate" }>,
): EffectChoice {
  const effect = perk.effect;
  // Only the perk that asks for a thing may be handed it, so each part of the
  // move is turned down by whoever has no business with it.
  const refuse = (given: boolean, what: string) => {
    if (given) throw new Error(`${cardName} does not ${what}`);
  };

  // A perk that changes a die on the table settles nothing else.
  if (changesDie(effect)) {
    refuse(move.paymentCardIds !== undefined, "take a blueprint");
    refuse(move.face !== undefined, "hand over a die");
    refuse(move.option !== undefined, "pay more than one way");
    if (!move.targetDieId) throw new Error(`${cardName} needs a die to change`);
    // Unspent, because a die already on a card or a section is done with.
    const target = requireUnspentDie(player, move.targetDieId);
    if (changedFace(effect, target.face) === null) {
      throw new Error(`${cardName} cannot change a ${target.face}`);
    }
    return { target };
  }
  refuse(move.targetDieId !== undefined, "change a die");

  // The face of a die it hands over.
  let face: DieFace | undefined;
  if (needsFace(effect)) {
    if (!move.face) throw new Error(`${cardName} needs a face for the die`);
    face = move.face;
  } else {
    refuse(move.face !== undefined, "hand over a die");
  }

  // The blueprints it eats.
  const wanted = perk.discardsCards ?? 0;
  const ids = move.paymentCardIds ?? [];
  if (wanted === 0) refuse(ids.length > 0, "take a blueprint");
  if (ids.length !== wanted) {
    const plural = wanted === 1 ? "" : "s";
    throw new Error(`${cardName} eats ${wanted} blueprint${plural}, not ${ids.length}`);
  }
  if (new Set(ids).size !== ids.length) {
    throw new Error(`${cardName} cannot eat the same blueprint twice`);
  }
  const eaten = ids.map((id) => {
    const held = player.hand.find((card) => card.id === id);
    if (!held) throw new Error(`${player.name} does not hold ${id}`);
    return held;
  });

  // And which of its alternatives is taken. Cards that cost more than the
  // Black Market's cap pay only part, and which part is the player's call.
  const options = activationOptions(perk, eaten);
  if (options.length === 0) {
    refuse(move.option !== undefined, "pay more than one way");
    return { eaten, face };
  }
  if (move.option === undefined && options.length > 1) {
    throw new Error(`${cardName} pays more than one way — say which`);
  }
  const chosen = options[move.option ?? 0];
  if (!chosen) throw new Error(`${cardName} has no such payout`);

  return { eaten, face, chosen };
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
      return gainResources(state, playerIndex, effect.resources);
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
    case "all":
      return effect.effects.reduce(
        (current, part) => applyEffect(current, playerIndex, part, choice),
        state,
      );
    // Both do what the move settled on: one of several printed alternatives,
    // or whatever the blueprint the perk ate would have cost. Logged, because
    // which one was taken is the whole decision.
    case "oneOf":
    case "gainCardCost": {
      const { chosen } = choice;
      if (!chosen) throw new Error("No payout chosen");
      const announced = log(
        state,
        `${state.players[playerIndex].name} chose: ${describeEffectForLog(chosen)}`,
      );
      return applyEffect(announced, playerIndex, chosen, choice);
    }
    case "flipDie":
    case "stepDie": {
      const { target } = choice;
      // Both were checked by the activation that got here.
      const face = target && changedFace(effect, target.face);
      if (!target || face === null || face === undefined) {
        throw new Error("No die chosen to change");
      }
      return setDieFace(state, playerIndex, target, face);
    }
    case "gainDie": {
      const { face } = choice;
      if (face === undefined) throw new Error("No face chosen for the die");
      return grantDie(state, playerIndex, face);
    }
    case "byFace": {
      const face = choice.faces?.[0];
      if (face === undefined) throw new Error("No die placed to read");
      // A gap between the bands would strand a die the perk had accepted.
      const band = effect.bands.find((option) => satisfies(option.accepts, face));
      if (!band) throw new Error(`Nothing on this card pays a ${face}`);
      return applyEffect(state, playerIndex, band.effect, choice);
    }
    case "gainByFace": {
      const face = choice.faces?.[0];
      if (face === undefined) throw new Error("No die placed to read");
      return gainResources(state, playerIndex, {
        metal: effect.resource === "metal" ? face : 0,
        energy: effect.resource === "energy" ? face : 0,
        goods: effect.resource === "goods" ? face : 0,
      });
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
    case "all":
      return effect.effects.map(describeEffectForLog).join(", and ");
    // The die on the card says which band paid; the resources line shows it.
    case "byFace":
      return "paying by the die placed";
    // The activation logs which alternative it took, once it is settled.
    case "gainCardCost":
    case "oneOf":
      return "taking the payout";
    // These log which die, and what it became.
    case "flipDie":
      return "turning a die over";
    case "stepDie":
      return `taking ${Math.abs(effect.by)} off a die`;
    case "gainByFace":
      return `gaining ${effect.resource} equal to the die`;
    // Logs the face it handed over itself.
    case "gainDie":
      return "buying a die";
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
      // Not always the printed price — a Megalith standing discounts the next.
      const buildCost = buildCostFor(player, card);
      if (!canAfford(player.resources, buildCost)) {
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
          resources: spendResources(p.resources, buildCost),
        }),
      );
      const price = costsNothing(buildCost)
        ? payment.name
        : `${payment.name} and ${describeResourcesForLog(buildCost)}`;
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
      // A perk that eats a card, changes a die, sells one or pays more than
      // one way says so on the move, and is checked before anything is paid.
      const chosen = activationChoice(player, building.card.name, perk, move);
      const choice = { faces, ...chosen };

      // Some perks read their price off a face, so it is only known now — and
      // for the Golem that face is the one bought, not one on the table.
      const cost = perkCost(perk, chosen.face === undefined ? faces : [chosen.face]);
      if (!canAfford(player.resources, cost)) {
        throw new Error(`${building.card.name} costs ${describeResourcesForLog(cost)} to use`);
      }

      const eaten = chosen.eaten ?? [];
      const swallowed = new Set(eaten.map((card) => card.id));
      const used = updatePlayer(
        {
          ...state,
          blueprints: {
            ...state.blueprints,
            discard: [...state.blueprints.discard, ...eaten],
          },
        },
        index,
        (p) => ({
          ...dice.reduce((spent, die) => spendDie(spent, die.id), p),
          // The cards the perk eats are part of the price, not of the payout.
          hand: p.hand.filter((c) => !swallowed.has(c.id)),
          compound: p.compound.map((b) =>
            b.card.id === building.card.id ? { ...b, dice: faces, worked: true } : b,
          ),
          resources: spendResources(p.resources, cost),
        }),
      );

      // Cards by comma, so the last "and" separates them from the resources:
      // "for Mega Factory, Obelisk and 2 energy".
      const price = [
        eaten.length > 0 ? eaten.map((card) => card.name).join(", ") : undefined,
        costsNothing(cost) ? undefined : describeResourcesForLog(cost),
      ].filter(Boolean);
      const paid = price.length > 0 ? ` for ${price.join(" and ")}` : "";
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

    case "discard": {
      if (state.phase !== "work") throw new Error("Discarding down happens in the Work Phase");
      const over = overLimits(player);

      if (move.kind === "resource") {
        if (over.resources === 0) {
          throw new Error(`${player.name} is inside the ${RESOURCE_LIMIT} resource limit`);
        }
        if (player.resources[move.resource] === 0) {
          throw new Error(`${player.name} has no ${move.resource} to discard`);
        }
        const dropped = updatePlayer(state, index, (p) => ({
          ...p,
          resources: {
            metal: p.resources.metal - (move.resource === "metal" ? 1 : 0),
            energy: p.resources.energy - (move.resource === "energy" ? 1 : 0),
            goods: p.resources.goods,
          },
        }));
        return log(dropped, `${player.name} discarded 1 ${move.resource}`);
      }

      if (over.cards === 0) {
        throw new Error(`${player.name} is inside the ${HAND_LIMIT} card hand limit`);
      }
      const card = player.hand.find((c) => c.id === move.cardId);
      if (!card) throw new Error(`${player.name} does not hold ${move.cardId}`);

      const dropped = updatePlayer(
        {
          ...state,
          blueprints: {
            ...state.blueprints,
            discard: [...state.blueprints.discard, card],
          },
        },
        index,
        (p) => ({ ...p, hand: p.hand.filter((c) => c.id !== card.id) }),
      );
      return log(dropped, `${player.name} discarded ${card.name}`);
    }

    case "endPhase": {
      if (state.phase === "cleanup") return endRound(state);
      if (state.phase === "work" && !player.rolled) {
        throw new Error(`${player.name} must roll before passing`);
      }
      if (state.phase === "work" && player.perks.extraChosen > 0) {
        throw new Error(`${player.name} must set their extra die before passing`);
      }
      if (state.phase === "work") {
        const over = overLimits(player);
        if (over.resources > 0) {
          throw new Error(
            `${player.name} must come down to ${RESOURCE_LIMIT} metal and energy`,
          );
        }
        if (over.cards > 0) {
          throw new Error(`${player.name} must come down to ${HAND_LIMIT} cards in hand`);
        }
      }
      return endTurn(state);
    }
  }
}

/** Convenience for AI loops and tests. */
export function applyMoves(state: GameState, moves: readonly Move[]): GameState {
  return moves.reduce(applyMove, state);
}
