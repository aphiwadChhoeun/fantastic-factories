/** Presentation-only helpers. The engine stays free of display concerns. */

import {
  hqSection,
  oppositeFace,
  type ActivationRequirement,
  type BlueprintPerk,
  type Card,
  type DieFace,
  type Effect,
  type GameState,
  type HqReward,
  type Move,
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
    case "discardForResources":
      return `Discard a blueprint from hand — gain its build cost back, up to ${effect.max}`;
    case "flipDie":
      return "Turn an unspent die over to its opposite face — 5 becomes 2";
    case "stepDie": {
      const pips = Math.abs(effect.by);
      const way = effect.by < 0 ? "off" : "onto";
      return `Take ${pips} ${way} an unspent die — a ${effect.by < 0 ? "1" : "6"} is too far`;
    }
    case "gainByFace":
      return `Gain ${effect.resource} equal to the die placed`;
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
  const cost = costsSomething(perk.cost) ? describeResources(perk.cost) : "";
  // A price read off the dice cannot be a number until they are on the table.
  const scaled = perk.costByFace
    ? `${perk.costByFace} equal to the ${perk.dice === 1 ? "die" : "dice"}`
    : "";

  return [`${dice}${accepts}`, cost, scaled].filter(Boolean).join(" + ") || "nothing";
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
  const effect = state.players[state.currentPlayerIndex].compound.find(
    (building) => building.card.id === move.cardId,
  )?.card.perk?.effect;

  if (effect?.kind === "flipDie") return String(oppositeFace(current));
  if (effect?.kind === "stepDie") return String(current + effect.by);
  return "?";
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
      const name = findCardName(state, move.cardId);
      const dice =
        move.dieIds.length === 0
          ? ""
          : ` with ${move.dieIds.map((id) => dieFace(state, id)).join(", ")}`;
      // The Black Market: what it eats, and what it pays for it.
      const traded = move.paymentCardId
        ? ` — sell ${findCardName(state, move.paymentCardId)}${
            move.gain ? ` for ${describeResources(move.gain)}` : ""
          }`
        : "";
      // A perk that changes a die: which one, and what it becomes. The card
      // itself says how, so the label reads off its effect.
      if (move.targetDieId) {
        const face = dieFace(state, move.targetDieId);
        return `Work ${name} — turn a ${face} into a ${changedFaceLabel(state, move, face)}`;
      }
      return `Work ${name}${dice}${traded}`;
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
