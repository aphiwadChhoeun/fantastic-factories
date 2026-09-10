/** Presentation-only helpers. The engine stays free of display concerns. */

import {
  activationOptions,
  hqSection,
  oppositeFace,
  perkFor,
  type ActivationRequirement,
  type BlueprintPerk,
  type Card,
  type DieFace,
  type Effect,
  type GameState,
  type HqReward,
  type Move,
  type Passive,
  type Resources,
} from "@/engine";

export function describeRequirement(requirement: ActivationRequirement): string {
  switch (requirement.kind) {
    case "any":
      return "any die";
    case "exact":
      return `exactly ${requirement.face}`;
    case "atLeast":
      return `${requirement.face}+`;
    case "atMost":
      return `${requirement.face} or less`;
  }
}

export function describeResources(resources: Resources): string {
  const parts: string[] = [];
  if (resources.metal) parts.push(`${resources.metal} metal`);
  if (resources.energy) parts.push(`${resources.energy} energy`);
  if (resources.goods) parts.push(`${resources.goods} goods`);
  return parts.length > 0 ? parts.join(", ") : "free";
}

export function describeEffect(effect: Effect): string {
  switch (effect.kind) {
    case "gain":
      return `Gain ${describeResources({
        metal: effect.resources.metal ?? 0,
        energy: effect.resources.energy ?? 0,
        goods: effect.resources.goods ?? 0,
      })}`;
    case "draw":
      return `Draw ${effect.count} blueprint${effect.count === 1 ? "" : "s"}`;
    case "buildFromDeck":
      return "Draw a blueprint and build it free — duplicates are discarded and redrawn";
    case "revealForResources":
      return "Reveal the top blueprint — gain metal and energy equal to its build cost";
    case "chooseOwnFaces":
      return `Set up to ${effect.count} of your dice instead of rolling them`;
    case "extraDice": {
      const dice = `${effect.count} extra white ${effect.count === 1 ? "die" : "dice"}`;
      return effect.chosen
        ? `Take ${dice} at a face of your choice after rolling`
        : `Roll ${dice} this round`;
    }
    case "gainCardCost":
      return `Gain the discarded blueprints' build cost back, up to ${effect.max}`;
    // Only the first part of a run keeps its capital, and a choice says it is
    // one — otherwise "gain a good and gain 2 metal or 3 energy" reads as
    // though the good were in question too.
    case "all":
      return effect.effects
        .map((part, index) => (index === 0 ? describeEffect(part) : lowered(part)))
        .join(", and ");
    case "oneOf":
      return `either ${effect.options.map(lowered).join(", or ")}`;
    case "byFace":
      return effect.bands
        .map((band) => `${describeRequirement(band.accepts)}: ${lowered(band.effect)}`)
        .join("; ");
    case "flipDie":
      return "Turn an unspent die over to its opposite face — 5 becomes 2";
    case "stepDie": {
      const pips = Math.abs(effect.by);
      const way = effect.by < 0 ? "off" : "onto";
      return `Take ${pips} ${way} an unspent die — a ${effect.by < 0 ? "1" : "6"} is too far`;
    }
    case "gainByFace":
      return `Gain ${effect.resource} equal to the die placed`;
    // What it costs, if anything, is on the Work line — the Golem charges for
    // the face and the Mega Factory throws it in.
    case "gainDie":
      return "Take an extra white die at any face";
    case "rollDie":
      return "Roll an extra white die, and keep it for the round";
    case "rerollDice":
      return "Throw any number of your unspent dice again — they land where they land";
    // The Work line says only what this card charges; whatever it copies asks
    // for its own dice and its own price on top, so that is said here.
    case "borrowFromMarket":
      return "Work a face-up blueprint as if you owned it — on top of what that card asks";
  }
}

/** Mid-sentence, so the leading capital comes off. */
function lowered(effect: Effect): string {
  const described = describeEffect(effect);
  return described.charAt(0).toLowerCase() + described.slice(1);
}

/** What a card does by itself, with nothing placed on it and nothing paid. */
export function describePassive(passive: Passive): string {
  switch (passive.kind) {
    case "drawOnGoods":
      return "Draw a blueprint the first time you gain goods each round";
    case "cheaperPerCard":
      return `Costs 1 metal less to build per ${passive.per} card standing`;
    // "Another" is the whole of it: standing this one up pays nothing.
    case "gainOnBuild":
      return `Gain ${describeResources({
        metal: passive.resources.metal ?? 0,
        energy: passive.resources.energy ?? 0,
        goods: passive.resources.goods ?? 0,
      })} each time you build another card`;
  }
}

/** What a built blueprint's perk asks for: dice first, then any resource cost. */
export function describePerkCost(perk: BlueprintPerk): string {
  const pattern = perk.pattern === "any" ? "" : `${perk.pattern} `;
  const dice =
    perk.dice === 0
      ? ""
      : perk.dice === 1
        ? describeRequirement(perk.accepts)
        : `${perk.dice} ${pattern}dice`;
  const accepts =
    perk.dice > 1 && perk.accepts.kind !== "any" ? ` (${describeRequirement(perk.accepts)})` : "";
  // A floor on the set rather than on each die, so it is said of the set.
  const adding = perk.minTotal === undefined ? "" : ` adding to ${perk.minTotal}+`;
  const eats = perk.discardsCards ?? 0;
  const card =
    eats === 0 ? "" : eats === 1 ? "a blueprint from hand" : `${eats} blueprints from hand`;
  const cost = costsSomething(perk.cost) ? describeResources(perk.cost) : "";
  // A price read off a face cannot be a number until the face is settled —
  // by rolling it, or by the Golem, by choosing it.
  const scaled = !perk.costByFace
    ? ""
    : perk.effect.kind === "gainDie"
      ? `${perk.costByFace} equal to the face bought`
      : `${perk.costByFace} equal to the ${perk.dice === 1 ? "die" : "dice"}`;

  return [`${dice}${accepts}${adding}`, card, cost, scaled].filter(Boolean).join(" + ") || "nothing";
}

function costsSomething(resources: Resources): boolean {
  return resources.metal > 0 || resources.energy > 0 || resources.goods > 0;
}

/** What one die on a Headquarters section pays, before any matching bonus. */
export function describeHqReward(reward: HqReward): string {
  switch (reward.kind) {
    case "drawBlueprint":
      return "draw a blueprint";
    case "energyByFace":
      return "gain energy equal to the die";
    case "gain":
      return `gain ${describeResources({
        metal: reward.resources.metal ?? 0,
        energy: reward.resources.energy ?? 0,
        goods: reward.resources.goods ?? 0,
      })}`;
  }
}

function findCardName(state: GameState, cardId: string): string {
  const player = state.players[state.currentPlayerIndex];
  const held = player.hand.find((card) => card.id === cardId);
  if (held) return held.name;
  const built = player.compound.find((building) => building.card.id === cardId);
  if (built) return built.card.name;
  const listed: Card | undefined =
    state.blueprints.row.find((card) => card.id === cardId) ??
    state.contractors.slots.find((slot) => slot.card?.id === cardId)?.card ??
    undefined;
  return listed?.name ?? cardId;
}

function dieFace(state: GameState, dieId: string): string {
  const die = state.players[state.currentPlayerIndex].dice.find((d) => d.id === dieId);
  return die ? String(die.face) : "?";
}

/**
 * The perk a move actually works, which is not always the one printed on the
 * card it names — a Replicator borrows one from the market.
 */
function perkOf(
  state: GameState,
  move: Extract<Move, { type: "activate" }>,
): BlueprintPerk | undefined {
  const card = state.players[state.currentPlayerIndex].compound.find(
    (building) => building.card.id === move.cardId,
  )?.card;
  if (!card) return undefined;
  // A label is not worth throwing over: a move this cannot read is a move the
  // engine will refuse anyway.
  try {
    return perkFor(state, card, move.borrowCardId);
  } catch {
    return undefined;
  }
}

/**
 * What a die-changing perk would leave its target showing. The engine has
 * already decided the move is legal; this only has to name the result.
 */
function changedFaceLabel(
  state: GameState,
  move: Extract<Move, { type: "activate" }>,
  face: string,
): string {
  if (face === "?") return "?";
  const current = Number(face) as DieFace;
  const effect = perkOf(state, move)?.effect;

  if (effect?.kind === "flipDie") return String(oppositeFace(current));
  if (effect?.kind === "stepDie") return String(current + effect.by);
  return "?";
}

/**
 * Which of a perk's alternatives an activation takes, named. The engine works
 * the list out; this only has to read the one the move points at.
 */
function describeChoice(state: GameState, move: Extract<Move, { type: "activate" }>): string {
  if (move.option === undefined) return "";
  const player = state.players[state.currentPlayerIndex];
  const perk = perkOf(state, move);
  if (!perk) return "";

  const eaten = (move.paymentCardIds ?? []).flatMap(
    (cardId) => player.hand.find((card) => card.id === cardId) ?? [],
  );
  const chosen = activationOptions(perk, eaten)[move.option];
  return chosen ? lowered(chosen) : "";
}

export function describeMove(state: GameState, move: Move): string {
  switch (move.type) {
    case "draft":
      return move.kind === "blueprint"
        ? `Draft ${findCardName(state, move.cardId)}`
        : `Take ${findCardName(state, move.cardId)} — pay ${findCardName(
            state,
            move.paymentCardId,
          )}`;
    case "rollDice": {
      const player = state.players[state.currentPlayerIndex];
      const placed = player.dice.length;
      // With a Foreman the roll can be a formality — say so, so the button
      // does not look like it undoes the faces just chosen.
      return placed >= player.workforce && player.perks.extraRolled === 0
        ? "Keep these dice"
        : "Roll dice";
    }
    case "setDie":
      return state.players[state.currentPlayerIndex].rolled
        ? `Take an extra die showing ${move.face}`
        : `Set a die to ${move.face}`;
    case "placeDie": {
      const face = dieFace(state, move.dieId);
      const section = hqSection(move.section);
      const placed = state.players[state.currentPlayerIndex].headquarters[move.section];
      const matches = placed.filter((other) => String(other) === face).length;
      const bonus = matches > 0 ? ` (×${matches + 1} — matches)` : "";
      return `${section.name}: place a ${face}${bonus}`;
    }
    case "build":
      return `Build ${findCardName(state, move.cardId)} — discard ${findCardName(
        state,
        move.paymentCardId,
      )}`;
    case "activate": {
      // A Replicator is only as interesting as what it copies, so the copied
      // card is named ahead of everything the move settled.
      const name =
        findCardName(state, move.cardId) +
        (move.borrowCardId ? ` as ${findCardName(state, move.borrowCardId)}` : "");
      // A perk that changes dice: which ones, and what they become. The card
      // itself says how, so the label reads off its effect.
      const changing = move.targetDieIds ?? [];
      if (changing.length > 0) {
        const faces = changing.map((id) => dieFace(state, id));
        // A throw has no answer until it lands, so it only names what goes in.
        if (perkOf(state, move)?.effect.kind === "rerollDice") {
          return `Work ${name} — throw ${faces.join(", ")} again`;
        }
        const [face] = faces;
        return `Work ${name} — turn a ${face} into a ${changedFaceLabel(state, move, face)}`;
      }

      const dice =
        move.dieIds.length === 0
          ? ""
          : ` with ${move.dieIds.map((id) => dieFace(state, id)).join(", ")}`;
      // Whatever the move settled: what it eats, the face it buys, and which
      // of the perk's alternatives is being taken.
      const burnt = (move.paymentCardIds ?? []).map((cardId) => findCardName(state, cardId));
      const parts = [
        burnt.length > 0 ? `burn ${burnt.join(" and ")}` : "",
        move.face ? `take a die showing ${move.face}` : "",
        describeChoice(state, move),
      ].filter(Boolean);
      const settled = parts.length > 0 ? ` — ${parts.join(", ")}` : "";

      return `Work ${name}${dice}${settled}`;
    }
    case "discard":
      return move.kind === "resource"
        ? `Discard 1 ${move.resource}`
        : `Discard ${findCardName(state, move.cardId)}`;
    // The automaton's two moves. They are never offered to a human, but the
    // move list shows whatever is legal, so they still need a name.
    case "automaMarket":
      return "Read the green die";
    case "automaWork":
      return "Produce goods";
    case "endPhase":
      return state.phase === "cleanup" ? "Start next round" : "End turn";
  }
}

/** Stable key for a move, so React lists do not need array indices. */
export function moveKey(move: Move): string {
  return Object.entries(move)
    .map(([key, value]) => `${key}:${JSON.stringify(value)}`)
    .join("|");
}
