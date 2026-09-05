/**
 * Placeholder cards so the loop has something to chew on.
 *
 * Two separate decks. Blueprints are built into your compound and activate
 * once per round; contractors resolve the moment you take one from the market
 * and are discarded immediately.
 *
 * Costs are in metal, energy is a secondary input, and goods are what you are
 * racing to accumulate.
 *
 * TODO: the blueprint list is still invented. The contractors below are real
 * cards, but not yet the whole deck.
 */

import type { BlueprintCard, ContractorCard } from "./types";

type BlueprintTemplate = Omit<BlueprintCard, "id" | "kind">;
type ContractorTemplate = Omit<ContractorCard, "id" | "kind">;

const BLUEPRINTS: readonly { template: BlueprintTemplate; copies: number }[] = [
  {
    copies: 6,
    template: {
      name: "Assembly Line",
      type: "gear",
      buildCost: { metal: 2, energy: 0, goods: 0 },
      buildRequirement: 3,
      activation: { kind: "atLeast", face: 4 },
      effect: { kind: "gain", resources: { goods: 2 } },
    },
  },
  {
    copies: 6,
    template: {
      name: "Generator",
      type: "wrench",
      buildCost: { metal: 1, energy: 0, goods: 0 },
      buildRequirement: 2,
      activation: { kind: "any" },
      effect: { kind: "gain", resources: { energy: 2 } },
    },
  },
  {
    copies: 5,
    template: {
      name: "Mine",
      type: "shovel",
      buildCost: { metal: 1, energy: 1, goods: 0 },
      buildRequirement: 2,
      activation: { kind: "atMost", face: 4 },
      effect: { kind: "gain", resources: { metal: 2 } },
    },
  },
  {
    copies: 5,
    template: {
      name: "Warehouse",
      type: "shovel",
      buildCost: { metal: 3, energy: 1, goods: 0 },
      buildRequirement: 4,
      activation: { kind: "atMost", face: 3 },
      effect: { kind: "gain", resources: { goods: 3 } },
    },
  },
  {
    copies: 5,
    template: {
      name: "Research Lab",
      type: "gear",
      buildCost: { metal: 2, energy: 1, goods: 0 },
      buildRequirement: 3,
      activation: { kind: "exact", face: 6 },
      effect: { kind: "draw", count: 2 },
    },
  },
  {
    copies: 4,
    template: {
      name: "Foundry",
      type: "hammer",
      buildCost: { metal: 3, energy: 0, goods: 0 },
      buildRequirement: 5,
      activation: { kind: "atLeast", face: 2 },
      effect: { kind: "gain", resources: { metal: 1, goods: 1 } },
    },
  },
  {
    copies: 4,
    template: {
      name: "Depot",
      type: "wrench",
      buildCost: { metal: 1, energy: 2, goods: 0 },
      buildRequirement: 2,
      activation: { kind: "exact", face: 1 },
      effect: { kind: "draw", count: 1 },
    },
  },
];

/**
 * The contractor deck, 17 cards. Several charge energy on top of their slot's
 * token, which is what keeps the strong ones honest.
 *
 * TODO: the rest of the published contractors go here.
 */
const CONTRACTORS: readonly { template: ContractorTemplate; copies: number }[] = [
  {
    copies: 2,
    template: {
      name: "Architect",
      effect: { kind: "draw", count: 3 },
    },
  },
  {
    copies: 2,
    template: {
      name: "Electrician",
      effect: { kind: "gain", resources: { energy: 5 } },
    },
  },
  {
    copies: 2,
    template: {
      name: "Miner",
      effect: { kind: "gain", resources: { metal: 3 } },
    },
  },
  {
    copies: 3,
    template: {
      name: "Investor",
      effect: { kind: "revealForResources" },
    },
  },
  {
    copies: 3,
    template: {
      name: "Specialist",
      effect: { kind: "extraDice", count: 1, chosen: true },
    },
  },
  {
    copies: 3,
    template: {
      name: "Hired Hands",
      extraCost: { metal: 0, energy: 3, goods: 0 },
      effect: { kind: "extraDice", count: 2, chosen: false },
    },
  },
  {
    copies: 1,
    template: {
      name: "Foreman",
      extraCost: { metal: 0, energy: 2, goods: 0 },
      // A full workforce, so in practice: name every face instead of rolling.
      effect: { kind: "chooseOwnFaces", count: 4 },
    },
  },
  {
    copies: 1,
    template: {
      name: "Engineer",
      extraCost: { metal: 0, energy: 4, goods: 0 },
      effect: { kind: "buildFromDeck" },
    },
  },
];

/**
 * Every player starts with one of these already standing in their compound, so
 * the economy has a source. Without it nobody can keep affording blueprints
 * and the game stalls.
 *
 * TODO: the published game hands out a starting card per player; swap this
 * placeholder for it.
 */
export function createStartingBuilding(playerId: string): BlueprintCard {
  return {
    id: `${playerId}-headquarters`,
    kind: "blueprint",
    name: "Headquarters",
    // TODO: placeholder tool type, like the rest of this card.
    type: "hammer",
    buildCost: { metal: 0, energy: 0, goods: 0 },
    buildRequirement: 1,
    activation: { kind: "any" },
    effect: { kind: "gain", resources: { metal: 1, energy: 1 } },
  };
}

/** Ids are stable, which keeps test failures readable. */
function expand<T extends { name: string }, K extends string>(
  templates: readonly { template: T; copies: number }[],
  kind: K,
): (T & { id: string; kind: K })[] {
  const cards: (T & { id: string; kind: K })[] = [];
  for (const { template, copies } of templates) {
    const slug = template.name.toLowerCase().replace(/\s+/g, "-");
    for (let i = 0; i < copies; i++) {
      cards.push({ ...template, id: `${slug}-${i}`, kind });
    }
  }
  return cards;
}

export function createBlueprintDeck(): BlueprintCard[] {
  return expand(BLUEPRINTS, "blueprint");
}

export function createContractorDeck(): ContractorCard[] {
  return expand(CONTRACTORS, "contractor");
}
