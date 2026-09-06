/**
 * The Headquarters tile.
 *
 * Every player starts with one and it is not a card: it is never built,
 * bought, drafted or discarded, and it never enters the compound. It is simply
 * always there, which makes it the one place a die can always go.
 *
 * Each of its three sections takes dice during the Work Phase and pays out per
 * die placed. Placements clear at cleanup along with the dice.
 */

import type { DieFace, Effect, HqReward, HqSection, HqSectionId, Resources } from "./types";

/**
 * Faces that match dice already on the same section pay a bonus: the section's
 * payout is multiplied by the number of dice showing that face once yours
 * joins them. A second matching die doubles it, a third triples it — and every
 * section holds three, so triple is as far as it goes.
 */
export function matchMultiplier(placed: readonly DieFace[], face: DieFace): number {
  return 1 + placed.filter((other) => other === face).length;
}

export const HQ_SECTIONS: readonly HqSection[] = [
  {
    id: "research",
    name: "Research",
    slots: 3,
    accepts: { kind: "any" },
    reward: { kind: "drawBlueprint" },
  },
  {
    id: "generate",
    name: "Generate",
    slots: 3,
    accepts: { kind: "atMost", face: 3 },
    reward: { kind: "energyByFace" },
  },
  {
    id: "mine",
    name: "Mine",
    slots: 3,
    accepts: { kind: "atLeast", face: 4 },
    reward: { kind: "gain", resources: { metal: 1 } },
  },
];

export function hqSection(id: HqSectionId): HqSection {
  const section = HQ_SECTIONS.find((candidate) => candidate.id === id);
  if (!section) throw new Error(`No Headquarters section ${id}`);
  return section;
}

function scale(resources: Partial<Resources>, multiplier: number): Partial<Resources> {
  return {
    metal: (resources.metal ?? 0) * multiplier,
    energy: (resources.energy ?? 0) * multiplier,
    goods: (resources.goods ?? 0) * multiplier,
  };
}

/**
 * What a placement actually does, as an ordinary `Effect` — so the same code
 * that resolves a card resolves the tile.
 */
export function hqPayout(reward: HqReward, face: DieFace, multiplier: number): Effect {
  switch (reward.kind) {
    case "drawBlueprint":
      return { kind: "draw", count: multiplier };
    case "energyByFace":
      return { kind: "gain", resources: { energy: face * multiplier } };
    case "gain":
      return { kind: "gain", resources: scale(reward.resources, multiplier) };
  }
}
