import { describe, expect, it } from "vitest";
import { createRandomAi } from "@/ai";
import {
  applyMove,
  BLUEPRINT_TYPES,
  createInitialState,
  currentPlayer,
  DIE_COLORS,
  legalMoves,
  MARKET_ROW_SIZE,
  MAX_ROUNDS,
  STARTING_HAND,
  STARTING_RESOURCES,
  STARTING_WORKFORCE,
  type BlueprintCard,
  type Card,
  type GameState,
  type Move,
} from "@/engine";

/** Guards against a rules bug turning a test run into an infinite loop. */
const MOVE_LIMIT = 20_000;

function playToEnd(state: GameState, choose: (state: GameState) => Move): GameState {
  let current = state;
  let moves = 0;
  while (!current.gameOver) {
    if (moves++ > MOVE_LIMIT) throw new Error("game exceeded the move limit");
    current = applyMove(current, choose(current));
  }
  return current;
}

/** Always acts if it can, so takes, builds and activations get exercised. */
function greedy(state: GameState): Move {
  const moves = legalMoves(state);
  return moves.find((move) => move.type !== "endPhase") ?? moves[0];
}

/** Takes the first face-up blueprint — the cheapest way to pass a market turn. */
function draftAnyBlueprint(state: GameState): GameState {
  return applyMove(state, {
    type: "draft",
    kind: "blueprint",
    cardId: state.blueprints.row[0].id,
  });
}

/** Walks both players through the Market Phase into the Work Phase. */
function toWorkPhase(state: GameState): GameState {
  return draftAnyBlueprint(draftAnyBlueprint(state));
}

function blueprintsIn(hand: readonly Card[]): BlueprintCard[] {
  return hand.filter((card): card is BlueprintCard => card.kind === "blueprint");
}

/** A contractor the player to act can actually pay for, with its payment. */
function takeableContractor(state: GameState) {
  const move = legalMoves(state).find(
    (candidate) => candidate.type === "draft" && candidate.kind === "contractor",
  );
  if (!move || move.type !== "draft" || move.kind !== "contractor") {
    throw new Error("expected a payable contractor");
  }
  return move;
}

describe("setup", () => {
  it("deals a hand, a starting compound, and both market rows", () => {
    const state = createInitialState({ seed: 42 });

    expect(state.players).toHaveLength(2);
    expect(state.players[0].isAi).toBe(false);
    expect(state.players[1].isAi).toBe(true);
    for (const player of state.players) {
      expect(player.hand).toHaveLength(STARTING_HAND);
      expect(player.compound).toHaveLength(1);
    }
  });

  it("lays out four contractors and four blueprints, each in its own row", () => {
    const state = createInitialState({ seed: 42 });

    expect(MARKET_ROW_SIZE).toBe(4);
    expect(state.contractors.slots).toHaveLength(4);
    expect(state.blueprints.row).toHaveLength(4);
    for (const slot of state.contractors.slots) expect(slot.card?.kind).toBe("contractor");
    for (const card of state.blueprints.row) expect(card.kind).toBe("blueprint");
  });

  it("puts one token of each tool type on the contractor row", () => {
    const state = createInitialState({ seed: 42 });
    const tokens = state.contractors.slots.map((slot) => slot.token);

    expect(new Set(tokens)).toEqual(new Set(BLUEPRINT_TYPES));
    expect(tokens).toHaveLength(BLUEPRINT_TYPES.length);
  });

  it("gives every blueprint a tool type, and uses all four", () => {
    const state = createInitialState({ seed: 42 });
    const blueprints = [
      ...state.blueprints.row,
      ...state.blueprints.deck,
      ...state.players.flatMap((player) =>
        player.hand.filter((card) => card.kind === "blueprint"),
      ),
    ];

    for (const card of blueprints) {
      expect(BLUEPRINT_TYPES).toContain(card.type);
    }
    // The deck should exercise the whole palette, not just one or two types.
    expect(new Set(blueprints.map((card) => card.type))).toEqual(new Set(BLUEPRINT_TYPES));
  });

  it("gives the starting building a tool type too", () => {
    const state = createInitialState({ seed: 42 });
    for (const player of state.players) {
      expect(BLUEPRINT_TYPES).toContain(player.compound[0].card.type);
    }
  });

  it("keeps the two decks separate", () => {
    const state = createInitialState({ seed: 42 });

    for (const card of state.contractors.deck) expect(card.kind).toBe("contractor");
    for (const card of state.blueprints.deck) expect(card.kind).toBe("blueprint");
    expect(state.contractors.discard).toEqual([]);
    expect(state.blueprints.discard).toEqual([]);
  });

  it("starts each player with four blueprints, one metal and two energy", () => {
    const state = createInitialState({ seed: 42 });

    expect(STARTING_HAND).toBe(4);
    for (const player of state.players) {
      expect(player.hand).toHaveLength(4);
      for (const card of player.hand) expect(card.kind).toBe("blueprint");
      expect(player.resources).toEqual({ metal: 1, energy: 2, goods: 0 });
      expect(player.resources).toEqual(STARTING_RESOURCES);
    }
  });

  it("deals every player a distinct colour and four dice in it", () => {
    const state = createInitialState({ seed: 42 });
    const colors = state.players.map((player) => player.color);

    expect(STARTING_WORKFORCE).toBe(4);
    expect(new Set(colors).size).toBe(colors.length);
    for (const color of colors) {
      expect(DIE_COLORS).toContain(color);
    }
    for (const player of state.players) {
      expect(player.workforce).toBe(4);
    }
  });

  it("honours explicitly chosen colours", () => {
    const state = createInitialState({ seed: 1, playerColors: ["purple", "yellow"] });
    expect(state.players.map((player) => player.color)).toEqual(["purple", "yellow"]);
  });

  it("rejects two players sharing a colour", () => {
    expect(() => createInitialState({ seed: 1, playerColors: ["green", "green"] })).toThrow(
      /distinct colour/,
    );
  });

  it("rejects more players than there are die colours", () => {
    const names = [...DIE_COLORS, "one too many"].map((_, i) => `p${i}`);
    expect(() => createInitialState({ seed: 1, playerNames: names })).toThrow(/die colour/);
  });

  it("seats up to one player per colour", () => {
    const names = DIE_COLORS.map((color) => `Player ${color}`);
    const state = createInitialState({ seed: 1, playerNames: names });

    expect(state.players).toHaveLength(DIE_COLORS.length);
    expect(new Set(state.players.map((p) => p.color)).size).toBe(DIE_COLORS.length);
  });

  it("is deterministic — one seed always deals the same game", () => {
    expect(createInitialState({ seed: 7 })).toEqual(createInitialState({ seed: 7 }));
  });

  it("deals different games for different seeds", () => {
    const a = createInitialState({ seed: 1 });
    const b = createInitialState({ seed: 2 });
    expect(a.blueprints.row).not.toEqual(b.blueprints.row);
  });
});

describe("legalMoves", () => {
  it("offers the whole blueprint row in the Market Phase", () => {
    const state = createInitialState({ seed: 3 });
    const drafts = legalMoves(state).filter((move) => move.type === "draft");

    expect(drafts.filter((move) => move.kind === "blueprint")).toHaveLength(MARKET_ROW_SIZE);
  });

  it("offers no blind draw — every market move takes a face-up card", () => {
    const state = createInitialState({ seed: 3 });

    for (const move of legalMoves(state)) {
      expect(move.type).toBe("draft");
    }
  });

  it("offers one contractor move per matching blueprint in hand", () => {
    const state = createInitialState({ seed: 3 });
    const hand = blueprintsIn(state.players[0].hand);

    const offers = legalMoves(state).filter(
      (move) => move.type === "draft" && move.kind === "contractor",
    );

    // Every offer pays a blueprint whose type matches its slot's token.
    for (const move of offers) {
      if (move.type !== "draft" || move.kind !== "contractor") throw new Error("narrowing");
      const slot = state.contractors.slots.find((s) => s.card?.id === move.cardId);
      const payment = hand.find((card) => card.id === move.paymentCardId);
      expect(payment?.type).toBe(slot?.token);
    }

    // And every legal pairing is offered — no more, no fewer.
    const pairings = state.contractors.slots
      .filter((slot) => slot.card)
      .flatMap((slot) => hand.filter((card) => card.type === slot.token));
    expect(offers).toHaveLength(pairings.length);
  });

  it("offers nothing for a slot whose token no blueprint in hand matches", () => {
    const state = createInitialState({ seed: 3 });
    const handTypes = new Set(blueprintsIn(state.players[0].hand).map((card) => card.type));
    const unpayable = state.contractors.slots.filter(
      (slot) => slot.card && !handTypes.has(slot.token),
    );
    // The scenario only means something if such a slot exists for this seed.
    expect(unpayable.length).toBeGreaterThan(0);

    const offers = legalMoves(state).filter(
      (move) => move.type === "draft" && move.kind === "contractor",
    );
    for (const slot of unpayable) {
      expect(offers.some((move) => move.cardId === slot.card!.id)).toBe(false);
    }
  });

  it("requires a roll before anything else in the Work Phase", () => {
    const state = toWorkPhase(createInitialState({ seed: 3 }));

    expect(state.phase).toBe("work");
    expect(legalMoves(state)).toEqual([{ type: "rollDice" }]);
  });

  it("returns nothing once the game is over", () => {
    const finished = playToEnd(createInitialState({ seed: 5 }), greedy);
    expect(finished.gameOver).toBe(true);
    expect(legalMoves(finished)).toEqual([]);
  });
});

describe("applyMove", () => {
  it("does not mutate the state it was given", () => {
    const state = createInitialState({ seed: 9 });
    const snapshot = structuredClone(state);

    draftAnyBlueprint(state);

    expect(state).toEqual(snapshot);
  });

  it("moves a drafted blueprint from its row into the hand", () => {
    const state = createInitialState({ seed: 11 });
    const target = state.blueprints.row[0];

    const next = applyMove(state, { type: "draft", kind: "blueprint", cardId: target.id });

    expect(next.blueprints.row.map((card) => card.id)).not.toContain(target.id);
    expect(next.players[0].hand.map((card) => card.id)).toContain(target.id);
    expect(next.currentPlayerIndex).toBe(1);
  });

  it("takes a contractor by discarding a matching blueprint as payment", () => {
    const state = createInitialState({ seed: 11 });
    const move = takeableContractor(state);
    const slot = state.contractors.slots.find((s) => s.card?.id === move.cardId)!;
    const payment = state.players[0].hand.find((card) => card.id === move.paymentCardId)!;

    const next = applyMove(state, move);
    const [player] = next.players;

    // The payment leaves hand for the blueprint discard.
    expect(player.hand.map((card) => card.id)).not.toContain(payment.id);
    expect(next.blueprints.discard.map((card) => card.id)).toContain(payment.id);
    // The slot empties but keeps its token.
    const emptied = next.contractors.slots.find((s) => s.token === slot.token)!;
    expect(emptied.card).toBeNull();
    expect(emptied.token).toBe(slot.token);
  });

  it("resolves the contractor's effect at once and discards the card", () => {
    const state = createInitialState({ seed: 11 });
    const move = takeableContractor(state);
    const contractor = state.contractors.slots.find((s) => s.card?.id === move.cardId)!.card!;
    if (contractor.effect.kind !== "gain") throw new Error("expected a resource contractor");

    const before = state.players[0].resources;
    const next = applyMove(state, move);
    const [player] = next.players;

    // The benefit lands immediately...
    expect(player.resources.metal).toBe(before.metal + (contractor.effect.resources.metal ?? 0));
    expect(player.resources.energy).toBe(
      before.energy + (contractor.effect.resources.energy ?? 0),
    );
    expect(player.resources.goods).toBe(before.goods + (contractor.effect.resources.goods ?? 0));
    // ...and the card goes straight to the discard, never to hand.
    expect(next.contractors.discard.map((card) => card.id)).toContain(contractor.id);
    expect(player.hand.map((card) => card.id)).not.toContain(contractor.id);
  });

  it("never puts a contractor in hand", () => {
    const finished = playToEnd(createInitialState({ seed: 8 }), greedy);
    const taken = finished.log.filter((line) => line.includes("took")).length;
    expect(taken).toBeGreaterThan(0);

    for (const player of finished.players) {
      for (const card of player.hand) {
        expect(card.kind).toBe("blueprint");
      }
    }
  });

  it("refuses a payment whose type does not match the slot token", () => {
    const state = createInitialState({ seed: 11 });
    const move = takeableContractor(state);
    const slot = state.contractors.slots.find((s) => s.card?.id === move.cardId)!;
    const wrong = blueprintsIn(state.players[0].hand).find((card) => card.type !== slot.token);
    if (!wrong) throw new Error("expected a mismatched blueprint in hand");

    expect(() => applyMove(state, { ...move, paymentCardId: wrong.id })).toThrow(
      new RegExp(`costs a ${slot.token} blueprint`),
    );
  });

  it("will not draft a contractor through the blueprint row", () => {
    const state = createInitialState({ seed: 11 });
    const contractor = state.contractors.slots[0].card!;

    expect(() =>
      applyMove(state, { type: "draft", kind: "blueprint", cardId: contractor.id }),
    ).toThrow(/blueprint row/);
  });

  it("rejects a move that is not legal right now", () => {
    const state = createInitialState({ seed: 11 });
    expect(() => applyMove(state, { type: "rollDice" })).toThrow(/Work Phase/);
  });

  it("rolls one die per point of workforce, all in the player's colour", () => {
    let state = createInitialState({ seed: 3, playerColors: ["green", "yellow"] });
    state = applyMove(toWorkPhase(state), { type: "rollDice" });

    const [player] = state.players;
    expect(player.dice).toHaveLength(STARTING_WORKFORCE);
    for (const die of player.dice) {
      expect(die.color).toBe("green");
      expect(die.face).toBeGreaterThanOrEqual(1);
      expect(die.face).toBeLessThanOrEqual(6);
      expect(die.spent).toBe(false);
    }
  });

  it("charges metal for a build and puts the card in the compound", () => {
    const state = applyMove(toWorkPhase(createInitialState({ seed: 3 })), { type: "rollDice" });

    const build = legalMoves(state).find((move) => move.type === "build");
    if (!build || build.type !== "build") throw new Error("expected a build to be affordable");

    const before = state.players[0];
    const card = before.hand.find((c) => c.id === build.cardId)!;
    if (card.kind !== "blueprint") throw new Error("expected a blueprint");
    const after = applyMove(state, build).players[0];

    expect(after.resources.metal).toBe(before.resources.metal - card.buildCost.metal);
    expect(after.resources.energy).toBe(before.resources.energy - card.buildCost.energy);
    expect(after.compound.map((b) => b.card.id)).toContain(card.id);
    expect(after.hand.map((c) => c.id)).not.toContain(card.id);
  });

  it("replays identically from the same seed and move list", () => {
    const seed = 21;
    const ai = createRandomAi(seed);
    const moves: Move[] = [];

    let state = createInitialState({ seed });
    for (let i = 0; i < 40 && !state.gameOver; i++) {
      const move = ai.chooseMove(state);
      moves.push(move);
      state = applyMove(state, move);
    }

    const replayed = moves.reduce(applyMove, createInitialState({ seed }));
    expect(replayed).toEqual(state);
  });
});

describe("a full game", () => {
  it("terminates under random play without throwing", () => {
    const ai = createRandomAi(99);
    const finished = playToEnd(createInitialState({ seed: 4 }), (state) => ai.chooseMove(state));

    expect(finished.gameOver).toBe(true);
    expect(finished.round).toBeLessThanOrEqual(MAX_ROUNDS + 1);
  });

  it("lets a greedy player build a compound that pays out", () => {
    const finished = playToEnd(createInitialState({ seed: 8 }), greedy);
    const [player] = finished.players;

    expect(player.compound.length).toBeGreaterThan(1);
    expect(finished.log.filter((line) => line.includes("built")).length).toBeGreaterThan(0);
    expect(finished.log.filter((line) => line.includes("activated")).length).toBeGreaterThan(0);
    // Greedy spends metal the moment it has it, so energy is where the
    // surplus shows up.
    expect(player.resources.energy).toBeGreaterThan(0);
    // Reached a real end condition rather than running into the round cap.
    expect(finished.round).toBeLessThan(MAX_ROUNDS);
  });

  it("names a winner or an explicit draw", () => {
    const finished = playToEnd(createInitialState({ seed: 8 }), greedy);
    expect(finished.winner === null || finished.players[finished.winner]).toBeTruthy();
  });

  it("keeps the player to act consistent with the phase", () => {
    const state = createInitialState({ seed: 13 });
    expect(currentPlayer(state)).toBe(state.players[0]);
  });
});
