/** Presentation-only helpers. The engine stays free of display concerns. */

import type { ActivationRequirement, Card, Effect, GameState, Move, Resources } from "@/engine";

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

export function describeMove(state: GameState, move: Move): string {
  switch (move.type) {
    case "draft":
      return move.kind === "blueprint"
        ? `Draft ${findCardName(state, move.cardId)}`
        : `Take ${findCardName(state, move.cardId)} — pay ${findCardName(
            state,
            move.paymentCardId,
          )}`;
    case "rollDice":
      return "Roll dice";
    case "build":
      return `Build ${findCardName(state, move.cardId)} with a ${dieFace(state, move.dieId)}`;
    case "activate":
      return `Activate ${findCardName(state, move.cardId)} with a ${dieFace(state, move.dieId)}`;
    case "endPhase":
      return state.phase === "cleanup" ? "Start next round" : "End turn";
  }
}

/** Stable key for a move, so React lists do not need array indices. */
export function moveKey(move: Move): string {
  return Object.entries(move)
    .map(([key, value]) => `${key}:${value}`)
    .join("|");
}
