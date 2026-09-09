/**
 * The two decks.
 *
 * Blueprints are built into your compound, where their perk can be used once
 * per round; contractors resolve the moment you take one from the market and
 * are discarded immediately.
 *
 * A blueprint's `buildCost` is on top of the real price of building: another
 * blueprint of the same tool, discarded from hand.
 *
 * Every card here is a real one — the invented placeholders the project was
 * scaffolded with are gone.
 *
 * TODO: neither deck is complete. The rest of the published blueprints and
 * contractors go here.
 */

import type { BlueprintCard, ContractorCard, Resources } from "./types";

type BlueprintTemplate = Omit<BlueprintCard, "id" | "kind">;
type ContractorTemplate = Omit<ContractorCard, "id" | "kind">;

const FREE: Resources = { metal: 0, energy: 0, goods: 0 };

const BLUEPRINTS: readonly { template: BlueprintTemplate; copies: number }[] = [
  {
    copies: 3,
    template: {
      name: "Aluminum Factory",
      type: "production",
      tool: "shovel",
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
      type: "production",
      tool: "gear",
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
      type: "production",
      tool: "wrench",
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
      type: "monument",
      tool: "shovel",
      buildCost: { metal: 2, energy: 4, goods: 0 },
      // Pure score, and the one blueprint you may stand more than one of:
      // one prestige each, plus one for having any at all.
      prestige: 1,
      prestigeBonus: 1,
      duplicable: true,
    },
  },
  {
    copies: 2,
    template: {
      name: "Biolab",
      type: "production",
      tool: "gear",
      buildCost: { metal: 1, energy: 3, goods: 0 },
      prestige: 1,
      perk: {
        dice: 1,
        pattern: "any",
        accepts: { kind: "exact", face: 1 },
        cost: { metal: 0, energy: 1, goods: 0 },
        effect: { kind: "gain", resources: { goods: 1 } },
      },
    },
  },
  {
    copies: 2,
    template: {
      name: "Black Market",
      type: "utility",
      tool: "gear",
      buildCost: { metal: 3, energy: 2, goods: 0 },
      prestige: 1,
      // The die is free; the price is a card out of hand, and what it paid for
      // comes back as resources — up to four of them.
      perk: {
        dice: 1,
        pattern: "any",
        accepts: { kind: "any" },
        cost: FREE,
        discardsCard: true,
        effect: { kind: "gainCardCost", max: 4 },
      },
    },
  },
  {
    copies: 2,
    template: {
      name: "Concrete Plant",
      type: "production",
      tool: "shovel",
      buildCost: { metal: 2, energy: 2, goods: 0 },
      // Cheap dice, cheap goods: a pair of 1s buys two goods for one metal,
      // and a pair of 6s buys the same two for six.
      perk: {
        dice: 2,
        pattern: "matching",
        accepts: { kind: "any" },
        cost: FREE,
        costByFace: "metal",
        effect: { kind: "gain", resources: { goods: 2 } },
      },
    },
  },
  {
    copies: 2,
    template: {
      name: "Dojo",
      type: "training",
      tool: "gear",
      buildCost: { metal: 1, energy: 2, goods: 0 },
      // Takes no die of its own. It turns one over and hands it straight back,
      // so the energy buys a face rather than an outcome.
      perk: {
        dice: 0,
        pattern: "any",
        accepts: { kind: "any" },
        cost: { metal: 0, energy: 1, goods: 0 },
        effect: { kind: "flipDie" },
      },
    },
  },
  {
    copies: 3,
    template: {
      name: "Fitness Center",
      type: "training",
      tool: "wrench",
      buildCost: { metal: 1, energy: 0, goods: 0 },
      // Takes no die of its own, like the Dojo — it nudges one and hands it
      // back. A 1 has nowhere to go, so it is simply not on offer.
      perk: {
        dice: 0,
        pattern: "any",
        accepts: { kind: "any" },
        cost: { metal: 0, energy: 1, goods: 0 },
        effect: { kind: "stepDie", by: -1 },
      },
    },
  },
  {
    copies: 2,
    template: {
      name: "Foundry",
      type: "utility",
      tool: "gear",
      buildCost: { metal: 2, energy: 1, goods: 0 },
      prestige: 1,
      // Energy in, metal out, at whatever rate the die says: a 5 costs five
      // energy and pays five metal.
      perk: {
        dice: 1,
        pattern: "any",
        accepts: { kind: "any" },
        cost: FREE,
        costByFace: "energy",
        effect: { kind: "gainByFace", resource: "metal" },
      },
    },
  },
  {
    copies: 2,
    template: {
      name: "Fulfillment Center",
      type: "production",
      tool: "hammer",
      buildCost: { metal: 2, energy: 1, goods: 0 },
      prestige: 1,
      perk: {
        dice: 1,
        pattern: "any",
        accepts: { kind: "exact", face: 4 },
        cost: { metal: 0, energy: 2, goods: 0 },
        effect: { kind: "gain", resources: { goods: 1, metal: 1 } },
      },
    },
  },
  {
    copies: 2,
    template: {
      name: "Golem",
      type: "monument",
      tool: "hammer",
      buildCost: { metal: 4, energy: 0, goods: 0 },
      prestige: 1,
      // Buys a die outright: name a face, pay that much energy, and it is on
      // the table for the rest of the round.
      perk: {
        dice: 0,
        pattern: "any",
        accepts: { kind: "any" },
        cost: FREE,
        costByFace: "energy",
        effect: { kind: "gainDie" },
      },
    },
  },
  {
    copies: 3,
    template: {
      name: "Gymnasium",
      type: "training",
      tool: "shovel",
      buildCost: { metal: 1, energy: 0, goods: 0 },
      // The Fitness Center the other way up. A 6 has nowhere above it, so it
      // is simply never on offer.
      perk: {
        dice: 0,
        pattern: "any",
        accepts: { kind: "any" },
        cost: { metal: 0, energy: 1, goods: 0 },
        effect: { kind: "stepDie", by: 1 },
      },
    },
  },
  {
    copies: 2,
    template: {
      name: "Harvester",
      type: "utility",
      tool: "hammer",
      buildCost: { metal: 1, energy: 2, goods: 0 },
      prestige: 1,
      // One payout or the other, never both.
      perk: {
        dice: 2,
        pattern: "matching",
        accepts: { kind: "any" },
        cost: FREE,
        effect: {
          kind: "oneOf",
          options: [
            { kind: "gain", resources: { metal: 4 } },
            { kind: "gain", resources: { energy: 7 } },
          ],
        },
      },
    },
  },
  {
    copies: 2,
    template: {
      name: "Incinerator",
      type: "utility",
      tool: "shovel",
      buildCost: { metal: 2, energy: 1, goods: 0 },
      prestige: 1,
      // Burns a card for energy. Unlike the Black Market it pays a flat rate,
      // so what goes in the fire makes no difference.
      perk: {
        dice: 0,
        pattern: "any",
        accepts: { kind: "any" },
        cost: { metal: 1, energy: 0, goods: 0 },
        discardsCard: true,
        effect: { kind: "gain", resources: { energy: 6 } },
      },
    },
  },
  {
    copies: 2,
    template: {
      name: "Laboratory",
      type: "special",
      tool: "wrench",
      buildCost: { metal: 1, energy: 4, goods: 0 },
      prestige: 1,
      // No perk at all: it watches for goods and draws once a round.
      passive: { kind: "drawOnGoods" },
    },
  },
  {
    copies: 2,
    template: {
      name: "Manufactory",
      type: "production",
      tool: "wrench",
      buildCost: { metal: 2, energy: 3, goods: 0 },
      prestige: 1,
      perk: {
        dice: 2,
        pattern: "matching",
        accepts: { kind: "any" },
        cost: FREE,
        // The good is certain; the rest is a choice, and one of the three is
        // not resources at all.
        effect: {
          kind: "all",
          effects: [
            { kind: "gain", resources: { goods: 1 } },
            {
              kind: "oneOf",
              options: [
                { kind: "gain", resources: { metal: 2 } },
                { kind: "gain", resources: { energy: 3 } },
                { kind: "draw", count: 2 },
              ],
            },
          ],
        },
      },
    },
  },
  {
    copies: 2,
    template: {
      name: "Mega Factory",
      type: "production",
      tool: "gear",
      buildCost: { metal: 3, energy: 2, goods: 0 },
      prestige: 1,
      perk: {
        dice: 3,
        pattern: "matching",
        accepts: { kind: "any" },
        cost: FREE,
        // A die at any face, and unlike the Golem's it costs nothing.
        effect: {
          kind: "all",
          effects: [{ kind: "gain", resources: { goods: 2 } }, { kind: "gainDie" }],
        },
      },
    },
  },
  {
    copies: 3,
    template: {
      name: "Megalith",
      type: "monument",
      tool: "wrench",
      buildCost: { metal: 5, energy: 2, goods: 0 },
      prestige: 3,
      // Meant to be stacked, like the Beacon, and every Monument already up
      // takes a metal off the next one — itself a Monument, so they compound.
      duplicable: true,
      passive: { kind: "cheaperPerCard", per: "monument" },
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
