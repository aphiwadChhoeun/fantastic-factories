import { describe, expect, it } from "vitest";
import { createBlueprintDeck, createInitialState, legalMoves } from "@/engine";
import { grantableBlueprints, grantBlueprint } from "./grant";

const named = (name: string) => {
  const card = createBlueprintDeck().find((c) => c.name === name);
  if (!card) throw new Error(`no card named ${name}`);
  return card;
};

describe("granting a blueprint", () => {
  const state = createInitialState({ seed: 3 });
  const beacon = named("Beacon");

  it("offers one of every printed blueprint, and no duplicates", () => {
    const offered = grantableBlueprints();
    const names = offered.map((card) => card.name);

    expect(new Set(names).size).toBe(names.length);
    expect(new Set(names)).toEqual(new Set(createBlueprintDeck().map((card) => card.name)));
  });

  it("puts a card in hand without touching the deck or the row", () => {
    const next = grantBlueprint(state, 0, beacon, "hand");

    expect(next.players[0].hand).toHaveLength(state.players[0].hand.length + 1);
    expect(next.players[0].hand.at(-1)?.name).toBe("Beacon");
    // Conjured, not drawn: the piles are exactly as they were.
    expect(next.blueprints).toEqual(state.blueprints);
    expect(next.players[1]).toEqual(state.players[1]);
  });

  it("stands a card up unbuilt, ready to be worked", () => {
    const next = grantBlueprint(state, 0, named("Nuclear Plant"), "compound");
    const stood = next.players[0].compound.at(-1);

    expect(stood?.card.name).toBe("Nuclear Plant");
    expect(stood?.dice).toEqual([]);
    expect(stood?.worked).toBe(false);
    // Nothing was paid for it.
    expect(next.players[0].resources).toEqual(state.players[0].resources);
  });

  it("mints a fresh id, so two grants of one card are two cards", () => {
    const once = grantBlueprint(state, 0, beacon, "hand");
    const twice = grantBlueprint(once, 0, beacon, "hand");
    const ids = twice.players[0].hand.map((card) => card.id);

    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids.slice(-2)) expect(id).toMatch(/^dev-beacon-\d+$/);
    // And no granted id collides with a printed one.
    const printed = new Set(createBlueprintDeck().map((card) => card.id));
    for (const id of ids.slice(-2)) expect(printed.has(id)).toBe(false);
  });

  it("leaves a granted card playable by the ordinary rules", () => {
    // Stood up and worked like anything else: a 6 on the Nuclear Plant.
    const { color } = state.players[0];
    const staged = grantBlueprint({ ...state, phase: "work" }, 0, named("Nuclear Plant"), "compound");
    const rolled = {
      ...staged,
      players: staged.players.map((player, index) =>
        index === 0
          ? {
              ...player,
              rolled: true,
              dice: [{ id: "d0", face: 6 as const, color, extra: false, spent: false }],
            }
          : player,
      ),
    };

    const stood = rolled.players[0].compound.at(-1)!;
    expect(
      legalMoves(rolled).filter(
        (move) => move.type === "activate" && move.cardId === stood.card.id,
      ),
    ).toHaveLength(1);
  });

  it("says so in the log, so a poked game is not mistaken for a played one", () => {
    const next = grantBlueprint(state, 0, beacon, "compound");
    expect(next.log.at(-1)).toBe("[dev] granted Beacon into the compound");
  });
});
