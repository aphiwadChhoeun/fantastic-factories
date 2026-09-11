import { describe, expect, it } from "vitest";
import { NO_PLACEMENTS, type DieFace, type GameState, type HqSectionId, type Phase } from "@/engine";
import { diffDeals, diffStates } from "./events";

type PlayerShape = {
  hand?: readonly string[];
  /** Card id -> whether its perk has fired this round. */
  compound?: Readonly<Record<string, boolean>>;
  /** Faces standing on each Headquarters section. */
  hq?: Partial<Record<HqSectionId, readonly DieFace[]>>;
  metal?: number;
  energy?: number;
  goods?: number;
};

type BoardShape = {
  players?: readonly PlayerShape[];
  /** Face-up cards, whichever row they sit on. */
  market?: readonly string[];
  turn?: number;
  phase?: Phase;
};

/**
 * Only the parts of a board this reads. A real `GameState` is far too large to
 * write out per case, and building one through the engine would test the
 * engine rather than the difference between two boards.
 */
function board({ players = [{}], market = [], turn = 0, phase = "market" }: BoardShape): GameState {
  return {
    players: players.map((player, index) => ({
      id: `p${index}`,
      hand: (player.hand ?? []).map((id) => ({ id })),
      compound: Object.entries(player.compound ?? {}).map(([id, worked]) => ({
        card: { id },
        worked,
      })),
      headquarters: { ...NO_PLACEMENTS, ...(player.hq ?? {}) },
      resources: {
        metal: player.metal ?? 0,
        energy: player.energy ?? 0,
        goods: player.goods ?? 0,
      },
    })),
    blueprints: { row: market.map((id) => ({ id })) },
    contractors: { slots: [] },
    currentPlayerIndex: turn,
    phase,
  } as unknown as GameState;
}

describe("diffStates", () => {
  it("says nothing about a board that did not change", () => {
    const state = board({ market: ["obelisk-0"] });

    // The same object, which is what every render that is not a move hands in.
    expect(diffStates(state, state)).toEqual([]);
  });

  it("calls a card taken out of the market a draft", () => {
    const before = board({ market: ["obelisk-0"] });
    const after = board({ players: [{ hand: ["obelisk-0"] }] });

    expect(diffStates(before, after)).toEqual([
      { kind: "drafted", cardId: "obelisk-0", playerIndex: 0 },
    ]);
  });

  it("does not call a drawn card a draft", () => {
    // Off the top of the deck, so it was never face up. It arrives in hand the
    // same way a drafted card does, and the market is the only thing that
    // tells the two apart.
    const before = board({ market: ["obelisk-0"] });
    const after = board({ players: [{ hand: ["warehouse-1"] }], market: ["obelisk-0"] });

    expect(diffStates(before, after)).toEqual([]);
  });

  it("names a card standing where none stood", () => {
    const before = board({ players: [{ hand: ["warehouse-1"] }] });
    const after = board({ players: [{ compound: { "warehouse-1": false } }] });

    expect(diffStates(before, after)).toEqual([
      { kind: "built", cardId: "warehouse-1", playerIndex: 0 },
    ]);
  });

  it("reads a perk firing off the rising edge of worked, with what it paid", () => {
    const before = board({ players: [{ compound: { "warehouse-1": false }, goods: 1 }] });
    const after = board({ players: [{ compound: { "warehouse-1": true }, goods: 3 }] });

    expect(diffStates(before, after)).toEqual([
      { kind: "produced", cardId: "warehouse-1", playerIndex: 0, goods: 2 },
      { kind: "gained", playerIndex: 0, metal: 0, energy: 0, goods: 2 },
    ]);
  });

  it("says nothing when cleanup clears worked again", () => {
    // The falling edge is the round ending, which is not something that
    // happened to the building.
    const before = board({ players: [{ compound: { "warehouse-1": true } }] });
    const after = board({ players: [{ compound: { "warehouse-1": false } }] });

    expect(diffStates(before, after)).toEqual([]);
  });

  it("names a die stood up on a Headquarters section, and its face", () => {
    const before = board({ players: [{}] });
    const after = board({ players: [{ hq: { generate: [5] }, energy: 5 }] });

    expect(diffStates(before, after)).toEqual([
      { kind: "placed", playerIndex: 0, section: "generate", face: 5 },
      { kind: "gained", playerIndex: 0, metal: 0, energy: 5, goods: 0 },
    ]);
  });

  it("reports only the die that is new, not the ones already standing", () => {
    const before = board({ players: [{ hq: { mine: [3] } }] });
    const after = board({ players: [{ hq: { mine: [3, 3] } }] });

    // Both faces are 3, which is exactly the case a face comparison would get
    // wrong — the second die has to be found by the list being longer.
    expect(diffStates(before, after)).toEqual([
      { kind: "placed", playerIndex: 0, section: "mine", face: 3 },
    ]);
  });

  it("says nothing when the tile is swept between rounds", () => {
    const before = board({ players: [{ hq: { research: [2, 6], mine: [4] } }] });
    const after = board({ players: [{}] });

    expect(diffStates(before, after)).toEqual([]);
  });

  it("reports stock going out as well as coming in", () => {
    const before = board({ players: [{ metal: 4, energy: 2 }] });
    const after = board({ players: [{ metal: 1, energy: 3 }] });

    expect(diffStates(before, after)).toEqual([
      { kind: "gained", playerIndex: 0, metal: -3, energy: 1, goods: 0 },
    ]);
  });

  it("follows every player, not just the one to act", () => {
    const before = board({ players: [{}, { goods: 0 }] });
    const after = board({ players: [{}, { goods: 2 }] });

    expect(diffStates(before, after)).toEqual([
      { kind: "gained", playerIndex: 1, metal: 0, energy: 0, goods: 2 },
    ]);
  });

  it("calls the turn and the phase", () => {
    const before = board({ players: [{}, {}], turn: 0, phase: "market" });
    const after = board({ players: [{}, {}], turn: 1, phase: "work" });

    expect(diffStates(before, after)).toEqual([
      { kind: "turn", playerIndex: 1 },
      { kind: "phase", phase: "work" },
    ]);
  });

  it("reads nothing off a board with no players at all", () => {
    // A new game replaces the players wholesale. Every card in the new hand
    // would otherwise look drafted, and a reset is not a move.
    const before = board({ players: [{}, {}] });
    const after = board({ players: [] });

    expect(diffStates(before, after)).toEqual([]);
  });
});

describe("diffDeals", () => {
  it("says nothing at all about a board dealt from a different seed", () => {
    // New game replaces both players wholesale, and the opponent is dealt an
    // opening compound. Compared as though it were a move, that reads as the
    // opponent having built all of it in one turn — and the board lights up
    // for every card of it.
    const before = { seed: 1, state: board({ players: [{}, {}] }) };
    const after = {
      seed: 2,
      state: board({
        players: [{ hand: ["obelisk-0"] }, { compound: { "solar-array-0": false } }],
      }),
    };

    expect(diffDeals(before, after)).toEqual([]);
  });

  it("still reads a move inside one deal", () => {
    const state = { seed: 7, state: board({ market: ["obelisk-0"] }) };
    const next = { seed: 7, state: board({ players: [{ hand: ["obelisk-0"] }] }) };

    expect(diffDeals(state, next)).toEqual([
      { kind: "drafted", cardId: "obelisk-0", playerIndex: 0 },
    ]);
  });
});
