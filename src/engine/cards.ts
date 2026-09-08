/**
 * Placeholder cards so the loop has something to chew on.
 *
 * Two separate decks. Blueprints are built into your compound, where their
 * perk can be used once per round; contractors resolve the moment you take one
 * from the market and are discarded immediately.
 *
 * A blueprint's `buildCost` is on top of the real price of building: another
 * blueprint of the same symbol, discarded from hand.
 *
 * TODO: the first four blueprints below are real cards; the rest are still
 * invented, and are worth no prestige because their real values are unknown.
 * The contractors are real, but not yet the whole deck.
 */

import type {
  ActivationRequirement,
  BlueprintCard,
  BlueprintPerk,
  ContractorCard,
  Effect,
  Resources,
} from "./types";

type BlueprintTemplate = Omit<BlueprintCard, "id" | "kind">;
type ContractorTemplate = Omit<ContractorCard, "id" | "kind">;

const FREE: Resources = { metal: 0, energy: 0, goods: 0 };

/** The common shape: one die of any face, nothing else to pay. */
function oneDie(effect: Effect, accepts: ActivationRequirement = { kind: "any" }): BlueprintPerk {
  return { dice: 1, pattern: "any", accepts, cost: FREE, effect };
}

const BLUEPRINTS: readonly { template: BlueprintTemplate; copies: number }[] = [
  {
    copies: 3,
    template: {
      name: "Aluminum Factory",
      type: "shovel",
      buildCost: { metal: 2, energy: 2, goods: 0 },
      prestige: 1,
      perk: {
        dice: 2,
        pattern: "matching",
        accepts: { kind: "any" },
        cost: { metal: 0, energy: 5, goods: 0 },
        effect: { kind: "gain", resources: { goods: 2, metal: 1 } },
      },
    },
  },
  {
    copies: 2,
    template: {
      name: "Assembly Line",
      type: "gear",
      buildCost: { metal: 2, energy: 1, goods: 0 },
      prestige: 1,
      perk: {
        dice: 3,
        pattern: "consecutive",
        accepts: { kind: "any" },
        cost: FREE,
        effect: { kind: "gain", resources: { goods: 2 } },
      },
    },
  },
  {
    copies: 2,
    template: {
      name: "Battery Factory",
      type: "wrench",
      buildCost: { metal: 2, energy: 1, goods: 0 },
      prestige: 1,
      // No dice at all: the energy is the whole price.
      perk: {
        dice: 0,
        pattern: "any",
        accepts: { kind: "any" },
        cost: { metal: 0, energy: 4, goods: 0 },
        effect: { kind: "gain", resources: { goods: 1 } },
      },
    },
  },
  {
    copies: 4,
    template: {
      name: "Beacon",
      type: "shovel",
      buildCost: { metal: 2, energy: 4, goods: 0 },
      // Pure score, and the one blueprint you may stand more than one of:
      // one prestige each, plus one for having any at all.
      prestige: 1,
      prestigeBonus: 1,
      duplicable: true,
    },
  },
  {
    copies: 6,
    template: {
      name: "Generator",
      type: "wrench",
      buildCost: { metal: 1, energy: 0, goods: 0 },
      perk: oneDie({ kind: "gain", resources: { energy: 2 } }),
    },
  },
  {
    copies: 5,
    template: {
      name: "Mine",
      type: "shovel",
      buildCost: { metal: 1, energy: 1, goods: 0 },
      perk: oneDie({ kind: "gain", resources: { metal: 2 } }, { kind: "atMost", face: 4 }),
    },
  },
  {
    copies: 5,
    template: {
      name: "Warehouse",
      type: "shovel",
      buildCost: { metal: 3, energy: 1, goods: 0 },
      perk: oneDie({ kind: "gain", resources: { goods: 3 } }, { kind: "atMost", face: 3 }),
    },
  },
  {
    copies: 5,
    template: {
      name: "Research Lab",
      type: "gear",
      buildCost: { metal: 2, energy: 1, goods: 0 },
      perk: oneDie({ kind: "draw", count: 2 }, { kind: "exact", face: 6 }),
    },
  },
  {
    copies: 4,
    template: {
      name: "Foundry",
      type: "hammer",
      buildCost: { metal: 3, energy: 0, goods: 0 },
      perk: oneDie({ kind: "gain", resources: { metal: 1, goods: 1 } }, { kind: "atLeast", face: 2 }),
    },
  },
  {
    copies: 4,
    template: {
      name: "Depot",
      type: "wrench",
      buildCost: { metal: 1, energy: 2, goods: 0 },
      perk: oneDie({ kind: "draw", count: 1 }, { kind: "exact", face: 1 }),
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
