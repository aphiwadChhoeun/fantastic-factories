/**
 * A handful of placeholder blueprints so the loop has something to chew on.
 *
 * TODO: replace with the real card list. Names and numbers here are invented,
 * not the published card set.
 */

import type { Card } from "./types";

type CardTemplate = Omit<Card, "id">;

const TEMPLATES: readonly { template: CardTemplate; copies: number }[] = [
  {
    copies: 6,
    template: {
      name: "Assembly Line",
      buildCost: { goods: 1, energy: 0 },
      buildRequirement: 3,
      activation: { kind: "atLeast", face: 4 },
      effect: { kind: "gain", resources: { goods: 2 } },
    },
  },
  {
    copies: 6,
    template: {
      name: "Generator",
      buildCost: { goods: 1, energy: 0 },
      buildRequirement: 2,
      activation: { kind: "any" },
      effect: { kind: "gain", resources: { energy: 2 } },
    },
  },
  {
    copies: 5,
    template: {
      name: "Warehouse",
      buildCost: { goods: 2, energy: 1 },
      buildRequirement: 4,
      activation: { kind: "atMost", face: 3 },
      effect: { kind: "gain", resources: { goods: 3 } },
    },
  },
  {
    copies: 5,
    template: {
      name: "Research Lab",
      buildCost: { goods: 1, energy: 1 },
      buildRequirement: 3,
      activation: { kind: "exact", face: 6 },
      effect: { kind: "draw", count: 2 },
    },
  },
  {
    copies: 4,
    template: {
      name: "Foundry",
      buildCost: { goods: 3, energy: 1 },
      buildRequirement: 5,
      activation: { kind: "atLeast", face: 2 },
      effect: { kind: "gain", resources: { goods: 2, energy: 1 } },
    },
  },
  {
    copies: 4,
    template: {
      name: "Depot",
      buildCost: { goods: 0, energy: 2 },
      buildRequirement: 2,
      activation: { kind: "exact", face: 1 },
      effect: { kind: "draw", count: 1 },
    },
  },
];

/**
 * Every player starts with one of these already built, so the economy has a
 * source. Without it nobody can afford a first blueprint and the game stalls.
 *
 * TODO: the published game hands out a starting card per player; swap this
 * placeholder for it.
 */
export function createStartingBuilding(playerId: string): Card {
  return {
    id: `${playerId}-headquarters`,
    name: "Headquarters",
    buildCost: { goods: 0, energy: 0 },
    buildRequirement: 1,
    activation: { kind: "any" },
    effect: { kind: "gain", resources: { goods: 1, energy: 1 } },
  };
}

/** Builds the unshuffled deck. Ids are stable, which keeps tests readable. */
export function createDeck(): Card[] {
  const cards: Card[] = [];
  for (const { template, copies } of TEMPLATES) {
    const slug = template.name.toLowerCase().replace(/\s+/g, "-");
    for (let i = 0; i < copies; i++) {
      cards.push({ ...template, id: `${slug}-${i}` });
    }
  }
  return cards;
}
