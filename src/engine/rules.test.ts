import { describe, expect, it } from "vitest";
import { createRandomAi } from "@/ai";
import {
  applyMove,
  AUTOMA_COMPOUND_SIZE,
  AUTOMA_DIE_COLORS,
  dealAutomaCompound,
  groupByCategory,
  standing,
  BLUEPRINT_CATEGORIES,
  BLUEPRINT_TOOLS,
  canAfford,
  createBlueprintDeck,
  createContractorDeck,
  createInitialState,
  currentPlayer,
  DIE_COLORS,
  DIE_FACES,
  END_GOODS,
  HQ_SECTIONS,
  legalMoves,
  MARKET_ROW_SIZE,
  MAX_ROUNDS,
  NO_PLACEMENTS,
  oppositeFace,
  prestigeOf,
  scoreOf,
  STARTING_HAND,
  STARTING_RESOURCES,
  STARTING_WORKFORCE,
  type BlueprintCard,
  type BlueprintCategory,
  type Building,
  type Card,
  type ContractorCard,
  type Die,
  type DieColor,
  type DieFace,
  type GameState,
  type HqSectionId,
  type Move,
  type Player,
  type Resources,
} from "@/engine";

/** Guards against a rules bug turning a test run into an infinite loop. */
const MOVE_LIMIT = 20_000;

const FREE: Resources = { metal: 0, energy: 0, goods: 0 };

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

/**
 * Takes the player to act through their Market Phase into their own Work
 * Phase. A turn is market then work, so that is one draft, not one per player.
 */
function toWorkPhase(state: GameState): GameState {
  return draftAnyBlueprint(state);
}

/** The log as a whole — the last line is usually a phase announcement. */
function logged(state: GameState, pattern: RegExp): boolean {
  return state.log.some((line) => pattern.test(line));
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

function cardNamed<T extends Card>(cards: readonly T[], name: string): T {
  const card = cards.find((c) => c.name === name);
  if (!card) throw new Error(`no card named ${name}`);
  return card;
}

/** The distinct printed copies of one blueprint, for duplicate scenarios. */
function copiesOf(name: string): BlueprintCard[] {
  return createBlueprintDeck().filter((card) => card.name === name);
}

function patchPlayer(state: GameState, index: number, patch: Partial<Player>): GameState {
  return {
    ...state,
    players: state.players.map((player, i) => (i === index ? { ...player, ...patch } : player)),
  };
}

/**
 * Sets up one specific take: `contractor` goes on the only occupied slot, with
 * a token matching the first blueprint in the player's hand.
 */
function stageContractor(
  state: GameState,
  contractor: ContractorCard,
  patch: Partial<Player> = {},
  deck?: readonly BlueprintCard[],
): GameState {
  const staged = patchPlayer(state, 0, patch);
  const token = staged.players[0].hand[0].tool;
  return {
    ...staged,
    contractors: {
      ...staged.contractors,
      slots: staged.contractors.slots.map((slot, i) =>
        i === 0 ? { token, card: contractor } : { ...slot, card: null },
      ),
    },
    blueprints: deck ? { ...staged.blueprints, deck, discard: [] } : staged.blueprints,
  };
}

function takeStaged(state: GameState): GameState {
  return applyMove(state, {
    type: "draft",
    kind: "contractor",
    cardId: state.contractors.slots[0].card!.id,
    paymentCardId: state.players[0].hand[0].id,
  });
}

describe("setup", () => {
  it("deals the human a hand and an empty compound", () => {
    const state = createInitialState({ seed: 42 });
    const [human, automaton] = state.players;

    expect(state.players).toHaveLength(2);
    expect(human.isAi).toBe(false);
    expect(automaton.isAi).toBe(true);

    expect(human.hand).toHaveLength(STARTING_HAND);
    // Nothing is built yet — the Headquarters is a tile, not a building.
    expect(human.compound).toEqual([]);
  });

  it("deals the automaton a standing compound and no hand at all", () => {
    const state = createInitialState({ seed: 42 });
    const automaton = state.players[1];

    // It takes cards straight into its compound, so it never holds one.
    expect(automaton.hand).toEqual([]);
    expect(automaton.compound).toHaveLength(AUTOMA_COMPOUND_SIZE);
    for (const building of automaton.compound) {
      expect(building.dice).toEqual([]);
      expect(building.worked).toBe(false);
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

    expect(new Set(tokens)).toEqual(new Set(BLUEPRINT_TOOLS));
    expect(tokens).toHaveLength(BLUEPRINT_TOOLS.length);
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
      expect(BLUEPRINT_TOOLS).toContain(card.tool);
    }
    // The deck should exercise the whole palette, not just one or two types.
    expect(new Set(blueprints.map((card) => card.tool))).toEqual(new Set(BLUEPRINT_TOOLS));
  });

  it("gives every player an empty Headquarters", () => {
    const state = createInitialState({ seed: 42 });
    for (const player of state.players) {
      expect(player.headquarters).toEqual(NO_PLACEMENTS);
      for (const section of HQ_SECTIONS) {
        expect(player.headquarters[section.id]).toEqual([]);
      }
    }
  });

  it("keeps the two decks separate", () => {
    const state = createInitialState({ seed: 42 });

    for (const card of state.contractors.deck) expect(card.kind).toBe("contractor");
    for (const card of state.blueprints.deck) expect(card.kind).toBe("blueprint");
    expect(state.contractors.discard).toEqual([]);
    // Nothing has been played yet, so the only cards in a discard are the
    // Monuments the automaton's opening deal turned down.
    for (const card of state.blueprints.discard) expect(card.type).toBe("monument");
  });

  it("starts the human with four blueprints, one metal and two energy", () => {
    const human = createInitialState({ seed: 42 }).players[0];

    expect(STARTING_HAND).toBe(4);
    expect(human.hand).toHaveLength(4);
    for (const card of human.hand) expect(card.kind).toBe("blueprint");
    expect(human.resources).toEqual({ metal: 1, energy: 2, goods: 0 });
    expect(human.resources).toEqual(STARTING_RESOURCES);
  });

  it("starts the automaton with nothing to spend — it buys nothing", () => {
    const automaton = createInitialState({ seed: 42 }).players[1];

    expect(automaton.resources).toEqual({ metal: 0, energy: 0, goods: 0 });
  });

  it("deals every player a distinct colour, and dice to match how they play", () => {
    const state = createInitialState({ seed: 42 });
    const colors = state.players.map((player) => player.color);

    expect(new Set(colors).size).toBe(colors.length);
    for (const color of colors) {
      expect(DIE_COLORS).toContain(color);
    }

    // A human rolls a workforce in their own colour; the automaton rolls one
    // die of each of five colours, which is a different thing entirely.
    expect(STARTING_WORKFORCE).toBe(4);
    expect(state.players[0].workforce).toBe(4);
    expect(state.players[1].workforce).toBe(AUTOMA_DIE_COLORS.length);
    expect(AUTOMA_DIE_COLORS).toEqual(["red", "blue", "purple", "yellow", "green"]);
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

describe("turn order", () => {
  /** Rolls, then passes — the shortest legal Work Phase. */
  function passWorkPhase(state: GameState): GameState {
    return applyMove(applyMove(state, { type: "rollDice" }), { type: "endPhase" });
  }

  it("gives each player a whole turn — market then work — before the next", () => {
    const start = createInitialState({ seed: 42 });
    expect([start.phase, start.currentPlayerIndex]).toEqual(["market", 0]);

    // Taking a card ends your Market Phase and opens your own Work Phase.
    const working = draftAnyBlueprint(start);
    expect([working.phase, working.currentPlayerIndex]).toEqual(["work", 0]);

    // Only ending the Work Phase passes the turn on, back to a Market Phase.
    const opponent = passWorkPhase(working);
    expect([opponent.phase, opponent.currentPlayerIndex]).toEqual(["market", 1]);

    // The automaton takes the same two phases, but plays them off its dice:
    // it rolls at the top of the turn and its green die does the shopping.
    const automaWorking = applyMove(applyMove(opponent, { type: "rollDice" }), {
      type: "automaMarket",
    });
    expect([automaWorking.phase, automaWorking.currentPlayerIndex]).toEqual(["work", 1]);

    // Cleanup runs once, after the last player's turn.
    const cleanup = applyMove(automaWorking, { type: "automaWork" });
    expect([cleanup.phase, cleanup.currentPlayerIndex]).toEqual(["cleanup", 0]);

    const round2 = applyMove(cleanup, { type: "endPhase" });
    expect([round2.round, round2.phase, round2.currentPlayerIndex]).toEqual([2, "market", 0]);
  });

  it("keeps the opponent out of the market until their own turn", () => {
    // Player 0 is still mid-turn, so every legal move is theirs.
    const working = draftAnyBlueprint(createInitialState({ seed: 42 }));

    expect(currentPlayer(working)).toBe(working.players[0]);
    expect(legalMoves(working)).toEqual([{ type: "rollDice" }]);
  });

  it("names the player in the log at each phase", () => {
    const state = draftAnyBlueprint(createInitialState({ seed: 42 }));

    expect(state.log.slice(0, 2)).toEqual(["Round 1", "You — Market Phase"]);
    expect(state.log.at(-1)).toBe("You — Work Phase");
  });
});

describe("the contractor deck", () => {
  const deck = createContractorDeck();

  it("deals the printed number of copies of each contractor", () => {
    const copies = (name: string) => deck.filter((card) => card.name === name).length;

    expect(copies("Architect")).toBe(2);
    expect(copies("Electrician")).toBe(2);
    expect(copies("Miner")).toBe(2);
    expect(copies("Investor")).toBe(3);
    expect(copies("Specialist")).toBe(3);
    expect(copies("Hired Hands")).toBe(3);
    expect(copies("Foreman")).toBe(1);
    expect(copies("Engineer")).toBe(1);
    // No stragglers: the counts above are the whole deck.
    expect(deck).toHaveLength(17);
  });

  it("gives each contractor its printed effect", () => {
    expect(cardNamed(deck, "Architect").effect).toEqual({ kind: "draw", count: 3 });
    expect(cardNamed(deck, "Electrician").effect).toEqual({
      kind: "gain",
      resources: { energy: 5 },
    });
    expect(cardNamed(deck, "Miner").effect).toEqual({ kind: "gain", resources: { metal: 3 } });
    expect(cardNamed(deck, "Investor").effect).toEqual({ kind: "revealForResources" });
    expect(cardNamed(deck, "Specialist").effect).toEqual({
      kind: "extraDice",
      count: 1,
      chosen: true,
    });
    expect(cardNamed(deck, "Hired Hands").effect).toEqual({
      kind: "extraDice",
      count: 2,
      chosen: false,
    });
    expect(cardNamed(deck, "Foreman").effect).toEqual({ kind: "chooseOwnFaces", count: 4 });
    expect(cardNamed(deck, "Engineer").effect).toEqual({ kind: "buildFromDeck" });
  });

  it("charges energy on top of the token only where the card says so", () => {
    const energyCost = (name: string) => cardNamed(deck, name).extraCost?.energy;

    expect(energyCost("Engineer")).toBe(4);
    expect(energyCost("Hired Hands")).toBe(3);
    expect(energyCost("Foreman")).toBe(2);

    const charged = ["Engineer", "Hired Hands", "Foreman"];
    for (const card of deck.filter((c) => !charged.includes(c.name))) {
      expect(card.extraCost).toBeUndefined();
    }
    // Nothing charges anything but energy.
    for (const card of deck.filter((c) => charged.includes(c.name))) {
      expect(card.extraCost?.metal).toBe(0);
      expect(card.extraCost?.goods).toBe(0);
    }
  });

  it("Architect draws three blueprints into hand", () => {
    const state = createInitialState({ seed: 11 });
    const architect = cardNamed(createContractorDeck(), "Architect");
    const staged = stageContractor(state, architect);
    const topThree = staged.blueprints.deck.slice(0, 3).map((card) => card.id);

    const next = takeStaged(staged);

    // Four dealt, one spent as payment.
    expect(next.players[0].hand).toHaveLength(STARTING_HAND - 1 + 3);
    expect(next.players[0].hand.map((card) => card.id)).toEqual(
      expect.arrayContaining(topThree),
    );
  });

  it("Electrician gives five energy", () => {
    const state = createInitialState({ seed: 11 });
    const electrician = cardNamed(createContractorDeck(), "Electrician");
    const staged = stageContractor(state, electrician);

    const next = takeStaged(staged);

    expect(next.players[0].resources.energy).toBe(STARTING_RESOURCES.energy + 5);
  });
});

describe("the Engineer", () => {
  const engineer = cardNamed(createContractorDeck(), "Engineer");

  it("is out of reach until the player holds four energy", () => {
    const state = createInitialState({ seed: 11 });
    const broke = stageContractor(state, engineer, {
      resources: { metal: 0, energy: 3, goods: 0 },
    });

    expect(legalMoves(broke).filter((move) => move.type === "draft")).not.toContainEqual(
      expect.objectContaining({ cardId: engineer.id }),
    );
    expect(() => takeStaged(broke)).toThrow(/4 energy/);

    const funded = stageContractor(state, engineer, {
      resources: { metal: 0, energy: 4, goods: 0 },
    });
    expect(legalMoves(funded).filter((move) => move.type === "draft")).toContainEqual(
      expect.objectContaining({ cardId: engineer.id }),
    );
  });

  it("charges four energy and builds the drawn blueprint for nothing", () => {
    const state = createInitialState({ seed: 11 });
    const mine = copiesOf("Mine")[0];
    const staged = stageContractor(
      state,
      engineer,
      { resources: { metal: 0, energy: 4, goods: 0 } },
      [mine, ...copiesOf("Depot")],
    );

    const [player] = takeStaged(staged).players;

    expect(player.compound.map((b) => b.card.id)).toContain(mine.id);
    // The Engineer's own cost is paid, the blueprint's build cost is not.
    expect(player.resources).toEqual({ metal: 0, energy: 0, goods: 0 });
    // No die was needed, and the card never passed through hand.
    expect(player.hand.map((card) => card.id)).not.toContain(mine.id);
    expect(player.dice).toEqual([]);
  });

  it("discards a duplicate and draws again", () => {
    const state = createInitialState({ seed: 11 });
    const [built, duplicate] = copiesOf("Generator");
    const mine = copiesOf("Mine")[0];
    const staged = stageContractor(
      state,
      engineer,
      {
        resources: { metal: 0, energy: 4, goods: 0 },
        compound: [{ card: built, dice: [], worked: false }],
      },
      [duplicate, mine],
    );

    const next = takeStaged(staged);
    const [player] = next.players;

    expect(player.compound.map((b) => b.card.id)).toEqual([built.id, mine.id]);
    expect(next.blueprints.discard.map((card) => card.id)).toContain(duplicate.id);
    expect(logged(next, /built Mine for free \(discarded 1/)).toBe(true);
  });

  it("builds nothing when every blueprint left is one the player has built", () => {
    const state = createInitialState({ seed: 11 });
    const [built, duplicate, payment] = copiesOf("Generator");
    const staged = stageContractor(
      state,
      engineer,
      {
        resources: { metal: 0, energy: 4, goods: 0 },
        // The payment is a Generator too, so even a reshuffle finds nothing.
        hand: [payment],
        compound: [{ card: built, dice: [], worked: false }],
      },
      [duplicate],
    );

    const next = takeStaged(staged);

    expect(next.players[0].compound).toHaveLength(1);
    expect(logged(next, /found no new blueprint to build/)).toBe(true);
    expect(next.blueprints.deck).toEqual([]);
    expect(next.blueprints.discard.map((card) => card.id)).toEqual(
      expect.arrayContaining([duplicate.id, payment.id]),
    );
  });
});

describe("blueprint types", () => {
  const deck = createBlueprintDeck();

  it("gives every real blueprint its printed type", () => {
    const printed: Record<string, BlueprintCategory> = {
      "Aluminum Factory": "production",
      "Assembly Line": "production",
      "Battery Factory": "production",
      Beacon: "monument",
      Biolab: "production",
      "Black Market": "utility",
      "Concrete Plant": "production",
    };

    for (const [name, type] of Object.entries(printed)) {
      expect(cardNamed(deck, name).type).toBe(type);
    }
  });

  it("leaves the placeholders untyped rather than guessing", () => {
    // Same rule as prestige: an invented card carries no printed value.
    for (const name of ["Generator", "Mine", "Warehouse", "Research Lab", "Foundry", "Depot"]) {
      expect(cardNamed(deck, name).type).toBeUndefined();
    }
  });

  it("uses no type outside the five printed ones", () => {
    for (const card of deck) {
      if (card.type) expect(BLUEPRINT_CATEGORIES).toContain(card.type);
    }
  });

  it("keeps the type apart from the tool — a card carries both", () => {
    const beacon = cardNamed(deck, "Beacon");

    // The Monument is paid for with a shovel; what it is and what it is worth
    // as payment are two different things.
    expect(beacon.type).toBe("monument");
    expect(beacon.tool).toBe("shovel");
  });
});

describe("the Aluminum Factory", () => {
  const factory = cardNamed(createBlueprintDeck(), "Aluminum Factory");

  /** The factory standing in the compound, with dice and resources to hand. */
  function withFactory(faces: readonly DieFace[], resources: Resources): GameState {
    const state = createInitialState({ seed: 3 });
    const { color } = state.players[0];
    return patchPlayer({ ...state, phase: "work" }, 0, {
      compound: [{ card: factory, dice: [], worked: false }],
      dice: faces.map((face, i) => ({ id: `d${i}`, face, color, extra: false, spent: false })),
      rolled: true,
      resources,
    });
  }

  function activations(state: GameState) {
    return legalMoves(state).filter((move) => move.type === "activate");
  }

  it("is a shovel costing 2 metal and 2 energy on top of the discard", () => {
    expect(factory.tool).toBe("shovel");
    expect(factory.buildCost).toEqual({ metal: 2, energy: 2, goods: 0 });
  });

  it("takes two matching dice and 5 energy, and pays 2 goods and 1 metal", () => {
    expect(factory.perk).toEqual({
      dice: 2,
      pattern: "matching",
      accepts: { kind: "any" },
      cost: { metal: 0, energy: 5, goods: 0 },
      effect: { kind: "gain", resources: { goods: 2, metal: 1 } },
    });
    expect(factory.prestige).toBe(1);
  });

  it("spends both dice and the energy, and fills both slots", () => {
    const state = withFactory([4, 4], { metal: 0, energy: 5, goods: 0 });

    const next = applyMove(state, {
      type: "activate",
      cardId: factory.id,
      dieIds: ["d0", "d1"],
    });
    const [player] = next.players;

    expect(player.resources).toEqual({ metal: 1, energy: 0, goods: 2 });
    expect(player.dice.every((die) => die.spent)).toBe(true);
    expect(player.compound[0].dice).toEqual([4, 4]);
    expect(logged(next, /worked Aluminum Factory with 4, 4 for 5 energy/)).toBe(true);
  });

  it("is not offered without two matching dice, or without the energy", () => {
    expect(activations(withFactory([4, 5], { metal: 0, energy: 5, goods: 0 }))).toEqual([]);
    expect(activations(withFactory([4, 4], { metal: 0, energy: 4, goods: 0 }))).toEqual([]);
    expect(activations(withFactory([4, 4], { metal: 0, energy: 5, goods: 0 }))).toHaveLength(1);
  });

  it("refuses a mismatched pair, or one it cannot pay for", () => {
    expect(() =>
      applyMove(withFactory([4, 5], { metal: 0, energy: 9, goods: 0 }), {
        type: "activate",
        cardId: factory.id,
        dieIds: ["d0", "d1"],
      }),
    ).toThrow(/needs matching dice/);

    expect(() =>
      applyMove(withFactory([4, 4], { metal: 0, energy: 4, goods: 0 }), {
        type: "activate",
        cardId: factory.id,
        dieIds: ["d0", "d1"],
      }),
    ).toThrow(/costs 5 energy to use/);
  });

  it("will not take one die, or the same die twice", () => {
    const state = withFactory([4, 4], { metal: 0, energy: 5, goods: 0 });

    expect(() =>
      applyMove(state, { type: "activate", cardId: factory.id, dieIds: ["d0"] }),
    ).toThrow(/takes 2 dice, not 1/);
    expect(() =>
      applyMove(state, { type: "activate", cardId: factory.id, dieIds: ["d0", "d0"] }),
    ).toThrow(/same die twice/);
  });

  it("finds the pair in a mixed roll", () => {
    // A roll of 3, 3, 5, 1: the two 3s are the pair, and the 5 and 1 are not.
    const state = withFactory([3, 3, 5, 1], { metal: 0, energy: 5, goods: 0 });

    const moves = activations(state);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toEqual({
      type: "activate",
      cardId: factory.id,
      dieIds: ["d0", "d1"],
    });

    // The same roll one energy short offers nothing at all — which is the
    // whole reason a building says what it still needs.
    expect(activations(withFactory([3, 3, 5, 1], { metal: 0, energy: 4, goods: 0 }))).toEqual([]);
  });

  it("offers one move per matching face, not one per pair of dice", () => {
    // Three 4s make three pairs, but they are the same move to a player.
    const state = withFactory([4, 4, 4, 2, 2], { metal: 0, energy: 5, goods: 0 });

    const moves = activations(state);
    expect(moves).toHaveLength(2);
    expect(
      moves.map((move) => (move.type === "activate" ? move.dieIds.length : 0)),
    ).toEqual([2, 2]);
  });

  it("works once a round, and is free again after cleanup", () => {
    const used = applyMove(withFactory([4, 4, 6, 6], { metal: 0, energy: 20, goods: 0 }), {
      type: "activate",
      cardId: factory.id,
      dieIds: ["d0", "d1"],
    });

    expect(activations(used)).toEqual([]);
    expect(() =>
      applyMove(used, { type: "activate", cardId: factory.id, dieIds: ["d2", "d3"] }),
    ).toThrow(/already used this round/);

    const cleaned = applyMove({ ...used, phase: "cleanup" }, { type: "endPhase" });
    expect(cleaned.players[0].compound[0].dice).toEqual([]);
  });
});

describe("the Assembly Line", () => {
  const line = cardNamed(createBlueprintDeck(), "Assembly Line");

  function withLine(faces: readonly DieFace[]): GameState {
    const state = createInitialState({ seed: 3 });
    const { color } = state.players[0];
    return patchPlayer({ ...state, phase: "work" }, 0, {
      compound: [{ card: line, dice: [], worked: false }],
      dice: faces.map((face, i) => ({ id: `d${i}`, face, color, extra: false, spent: false })),
      rolled: true,
    });
  }

  function runs(state: GameState) {
    return legalMoves(state)
      .filter((move) => move.type === "activate")
      .map((move) =>
        move.type === "activate"
          ? move.dieIds.map((id) => state.players[0].dice.find((d) => d.id === id)!.face)
          : [],
      );
  }

  it("is a gear costing 2 metal and 1 energy, worth a prestige", () => {
    expect(line.tool).toBe("gear");
    expect(line.buildCost).toEqual({ metal: 2, energy: 1, goods: 0 });
    expect(line.prestige).toBe(1);
    expect(line.perk?.dice).toBe(3);
    expect(line.perk?.pattern).toBe("consecutive");
    expect(line.perk?.effect).toEqual({ kind: "gain", resources: { goods: 2 } });
  });

  it("takes a run of three and pays 2 goods", () => {
    const state = withLine([2, 3, 4, 6]);
    expect(runs(state)).toEqual([[2, 3, 4]]);

    const next = applyMove(state, {
      type: "activate",
      cardId: line.id,
      dieIds: ["d0", "d1", "d2"],
    });

    expect(next.players[0].resources.goods).toBe(STARTING_RESOURCES.goods + 2);
    expect(next.players[0].compound[0].dice).toEqual([2, 3, 4]);
  });

  it("finds a run in any order, and offers each distinct run once", () => {
    // 4, 2, 3 is the same run as 2, 3, 4 — order of the dice is not the point.
    expect(runs(withLine([4, 2, 3, 6]))).toEqual([[4, 2, 3]]);
    // 1..4 holds two runs: 1-2-3 and 2-3-4.
    expect(runs(withLine([1, 2, 3, 4]))).toHaveLength(2);
  });

  it("refuses a gap and a repeat", () => {
    expect(runs(withLine([2, 3, 5, 5]))).toEqual([]);
    expect(runs(withLine([3, 3, 4, 6]))).toEqual([]);

    expect(() =>
      applyMove(withLine([2, 3, 5, 6]), {
        type: "activate",
        cardId: line.id,
        dieIds: ["d0", "d1", "d2"],
      }),
    ).toThrow(/needs consecutive dice/);
  });
});

describe("the Battery Factory", () => {
  const battery = cardNamed(createBlueprintDeck(), "Battery Factory");

  function withBattery(energy: number): GameState {
    const state = createInitialState({ seed: 3 });
    return patchPlayer({ ...state, phase: "work" }, 0, {
      compound: [{ card: battery, dice: [], worked: false }],
      rolled: true,
      resources: { metal: 0, energy, goods: 0 },
    });
  }

  it("is a wrench costing 2 metal and 1 energy, worth a prestige", () => {
    expect(battery.tool).toBe("wrench");
    expect(battery.buildCost).toEqual({ metal: 2, energy: 1, goods: 0 });
    expect(battery.prestige).toBe(1);
  });

  it("takes no dice at all — 4 energy buys a good", () => {
    expect(battery.perk?.dice).toBe(0);

    const state = withBattery(4);
    const moves = legalMoves(state).filter((move) => move.type === "activate");
    expect(moves).toEqual([{ type: "activate", cardId: battery.id, dieIds: [] }]);

    const next = applyMove(state, { type: "activate", cardId: battery.id, dieIds: [] });

    expect(next.players[0].resources).toEqual({ metal: 0, energy: 0, goods: 1 });
    // Nothing to show on the card, so the flag is all that marks it used.
    expect(next.players[0].compound[0].worked).toBe(true);
    expect(next.players[0].compound[0].dice).toEqual([]);
    expect(legalMoves(next).filter((move) => move.type === "activate")).toEqual([]);
  });

  it("is offered only when the energy is there, and only once a round", () => {
    expect(legalMoves(withBattery(3)).filter((m) => m.type === "activate")).toEqual([]);
    expect(() =>
      applyMove(withBattery(3), { type: "activate", cardId: battery.id, dieIds: [] }),
    ).toThrow(/costs 4 energy to use/);
  });
});

describe("the Beacon", () => {
  const beacons = createBlueprintDeck().filter((card) => card.name === "Beacon");

  function standing(count: number) {
    return beacons.slice(0, count).map((card) => ({ card, dice: [], worked: false }));
  }

  it("is a shovel costing 2 metal and 4 energy, and does nothing once up", () => {
    expect(beacons).toHaveLength(4);
    expect(beacons[0].tool).toBe("shovel");
    expect(beacons[0].buildCost).toEqual({ metal: 2, energy: 4, goods: 0 });
    expect(beacons[0].perk).toBeUndefined();
  });

  it("scores one each plus one for the set", () => {
    expect(prestigeOf(standing(0))).toBe(0);
    expect(prestigeOf(standing(1))).toBe(2);
    expect(prestigeOf(standing(2))).toBe(3);
    expect(prestigeOf(standing(3))).toBe(4);
    expect(prestigeOf(standing(4))).toBe(5);
  });

  it("may be built more than once, unlike every other blueprint", () => {
    const state = createInitialState({ seed: 3 });
    const shovel = copiesOf("Mine")[0];
    const staged: GameState = patchPlayer({ ...state, phase: "work" }, 0, {
      compound: standing(1),
      hand: [beacons[1], shovel],
      resources: { metal: 5, energy: 5, goods: 0 },
      rolled: true,
    });

    const builds = legalMoves(staged).filter((move) => move.type === "build");
    expect(builds.map((move) => move.cardId)).toContain(beacons[1].id);

    const next = applyMove(staged, {
      type: "build",
      cardId: beacons[1].id,
      paymentCardId: shovel.id,
    });
    expect(next.players[0].compound).toHaveLength(2);
    expect(prestigeOf(next.players[0].compound)).toBe(3);
  });

  it("has no perk to work", () => {
    const state = createInitialState({ seed: 3 });
    const staged: GameState = patchPlayer({ ...state, phase: "work" }, 0, {
      compound: standing(1),
      rolled: true,
    });

    expect(legalMoves(staged).filter((move) => move.type === "activate")).toEqual([]);
    expect(() =>
      applyMove(staged, { type: "activate", cardId: beacons[0].id, dieIds: [] }),
    ).toThrow(/no perk to work/);
  });
});

describe("the Biolab", () => {
  const biolab = cardNamed(createBlueprintDeck(), "Biolab");

  function withBiolab(faces: readonly DieFace[], energy = 3): GameState {
    const state = createInitialState({ seed: 3 });
    const { color } = state.players[0];
    return patchPlayer({ ...state, phase: "work" }, 0, {
      compound: [{ card: biolab, dice: [], worked: false }],
      dice: faces.map((face, i) => ({ id: `d${i}`, face, color, extra: false, spent: false })),
      rolled: true,
      resources: { metal: 0, energy, goods: 0 },
    });
  }

  it("is a gear costing 1 metal and 3 energy, worth a prestige", () => {
    expect(biolab.tool).toBe("gear");
    expect(biolab.buildCost).toEqual({ metal: 1, energy: 3, goods: 0 });
    expect(biolab.prestige).toBe(1);
  });

  it("takes a 1 and one energy, and pays a good", () => {
    const state = withBiolab([1, 4, 5, 6]);
    const next = applyMove(state, { type: "activate", cardId: biolab.id, dieIds: ["d0"] });

    expect(next.players[0].resources).toEqual({ metal: 0, energy: 2, goods: 1 });
    expect(next.players[0].compound[0].dice).toEqual([1]);
  });

  it("takes nothing but a 1, and not without the energy", () => {
    const activations = (state: GameState) =>
      legalMoves(state).filter((move) => move.type === "activate");

    expect(activations(withBiolab([2, 3, 4, 5]))).toEqual([]);
    expect(activations(withBiolab([1, 1, 4, 5]))).toHaveLength(1);
    expect(activations(withBiolab([1, 4, 5, 6], 0))).toEqual([]);

    expect(() =>
      applyMove(withBiolab([2, 3, 4, 5]), { type: "activate", cardId: biolab.id, dieIds: ["d0"] }),
    ).toThrow(/A 2 does not work Biolab/);
  });
});

describe("the Black Market", () => {
  const market = cardNamed(createBlueprintDeck(), "Black Market");
  /** 2 metal, 1 energy — three resources, so it pays out whole. */
  const line = cardNamed(createBlueprintDeck(), "Assembly Line");
  /** 2 metal, 4 energy — six, so the cap of four bites and the player picks. */
  const beacon = copiesOf("Beacon")[0];

  function withMarket(hand: readonly BlueprintCard[]): GameState {
    const state = createInitialState({ seed: 3 });
    const { color } = state.players[0];
    return patchPlayer({ ...state, phase: "work" }, 0, {
      compound: [{ card: market, dice: [], worked: false }],
      dice: [{ id: "d0", face: 5, color, extra: false, spent: false }],
      rolled: true,
      hand: [...hand],
      resources: { metal: 0, energy: 0, goods: 0 },
    });
  }

  function offers(state: GameState) {
    return legalMoves(state).filter((move) => move.type === "activate");
  }

  it("is a gear costing 3 metal and 2 energy, worth a prestige", () => {
    expect(market.tool).toBe("gear");
    expect(market.buildCost).toEqual({ metal: 3, energy: 2, goods: 0 });
    expect(market.prestige).toBe(1);
    expect(market.perk?.dice).toBe(1);
    expect(market.perk?.accepts).toEqual({ kind: "any" });
    expect(market.perk?.cost).toEqual({ metal: 0, energy: 0, goods: 0 });
  });

  it("eats a blueprint and pays back what it cost", () => {
    const state = withMarket([line]);
    const [move] = offers(state);

    const next = applyMove(state, move);

    expect(next.players[0].resources).toEqual({ metal: 2, energy: 1, goods: 0 });
    expect(next.players[0].hand).toEqual([]);
    expect(next.blueprints.discard).toContain(line);
    expect(logged(next, /sold Assembly Line — gained 2 metal, 1 energy/)).toBe(true);
  });

  it("offers one move per blueprint in hand, and none with an empty hand", () => {
    expect(offers(withMarket([line, cardNamed(createBlueprintDeck(), "Biolab")]))).toHaveLength(2);
    expect(offers(withMarket([]))).toEqual([]);
  });

  it("caps the payout at four, and offers every way to take it", () => {
    const gains = offers(withMarket([beacon])).map((move) =>
      move.type === "activate" ? move.gain : undefined,
    );

    // A Beacon cost 2 metal and 4 energy; four of those six come back.
    expect(gains).toEqual([
      { metal: 0, energy: 4, goods: 0 },
      { metal: 1, energy: 3, goods: 0 },
      { metal: 2, energy: 2, goods: 0 },
    ]);
  });

  it("refuses a haul the discarded card does not pay", () => {
    const state = withMarket([beacon]);
    const activate = (gain: Resources): Move => ({
      type: "activate",
      cardId: market.id,
      dieIds: ["d0"],
      paymentCardId: beacon.id,
      gain,
    });

    // Over the cap, and under it but more metal than the Beacon ever cost.
    expect(() => applyMove(state, activate({ metal: 2, energy: 4, goods: 0 }))).toThrow(
      /does not pay/,
    );
    expect(() => applyMove(state, activate({ metal: 3, energy: 1, goods: 0 }))).toThrow(
      /does not pay/,
    );
    expect(() =>
      applyMove(state, { type: "activate", cardId: market.id, dieIds: ["d0"] }),
    ).toThrow(/needs a blueprint to discard/);
  });

  it("leaves every other perk alone — nothing else takes a card", () => {
    const battery = cardNamed(createBlueprintDeck(), "Battery Factory");
    const state = patchPlayer(withMarket([line]), 0, {
      compound: [{ card: battery, dice: [], worked: false }],
      resources: { metal: 0, energy: 4, goods: 0 },
    });

    expect(() =>
      applyMove(state, {
        type: "activate",
        cardId: battery.id,
        dieIds: [],
        paymentCardId: line.id,
      }),
    ).toThrow(/does not take a blueprint/);
  });
});

describe("the Concrete Plant", () => {
  const plant = cardNamed(createBlueprintDeck(), "Concrete Plant");

  function withPlant(faces: readonly DieFace[], metal: number): GameState {
    const state = createInitialState({ seed: 3 });
    const { color } = state.players[0];
    return patchPlayer({ ...state, phase: "work" }, 0, {
      compound: [{ card: plant, dice: [], worked: false }],
      dice: faces.map((face, i) => ({ id: `d${i}`, face, color, extra: false, spent: false })),
      rolled: true,
      resources: { metal, energy: 0, goods: 0 },
    });
  }

  function pairs(state: GameState) {
    return legalMoves(state)
      .filter((move) => move.type === "activate")
      .map((move) =>
        move.type === "activate"
          ? move.dieIds.map((id) => state.players[0].dice.find((d) => d.id === id)!.face)
          : [],
      );
  }

  it("is a shovel costing 2 metal and 2 energy, and charges metal by the dice", () => {
    expect(plant.tool).toBe("shovel");
    expect(plant.buildCost).toEqual({ metal: 2, energy: 2, goods: 0 });
    expect(plant.perk?.dice).toBe(2);
    expect(plant.perk?.pattern).toBe("matching");
    expect(plant.perk?.costByFace).toBe("metal");
    expect(plant.perk?.effect).toEqual({ kind: "gain", resources: { goods: 2 } });
  });

  it("charges metal equal to the pair, not to both dice", () => {
    const next = applyMove(withPlant([3, 3, 5, 1], 4), {
      type: "activate",
      cardId: plant.id,
      dieIds: ["d0", "d1"],
    });

    expect(next.players[0].resources).toEqual({ metal: 1, energy: 0, goods: 2 });
    expect(next.players[0].compound[0].dice).toEqual([3, 3]);
  });

  it("prices each pair on its own — a cheap one is offered when a dear one is not", () => {
    // Two metal buys the pair of 2s and nowhere near the pair of 5s.
    expect(pairs(withPlant([2, 2, 5, 5], 2))).toEqual([[2, 2]]);
    expect(pairs(withPlant([2, 2, 5, 5], 5))).toHaveLength(2);
    expect(pairs(withPlant([2, 2, 5, 5], 1))).toEqual([]);

    expect(() =>
      applyMove(withPlant([5, 5, 1, 2], 4), {
        type: "activate",
        cardId: plant.id,
        dieIds: ["d0", "d1"],
      }),
    ).toThrow(/costs 5 metal to use/);
  });
});

describe("prestige", () => {
  it("counts one card's prestige once, and ignores cards worth none", () => {
    const generator = copiesOf("Generator")[0];
    const factory = cardNamed(createBlueprintDeck(), "Aluminum Factory");

    expect(prestigeOf([{ card: generator, dice: [], worked: false }])).toBe(0);
    expect(
      prestigeOf([
        { card: generator, dice: [], worked: false },
        { card: factory, dice: [], worked: false },
      ]),
    ).toBe(1);
  });

  it("adds to goods to make the score", () => {
    const factory = cardNamed(createBlueprintDeck(), "Aluminum Factory");
    const state = createInitialState({ seed: 3 });
    const [player] = patchPlayer(state, 0, {
      compound: [{ card: factory, dice: [], worked: false }],
      resources: { metal: 9, energy: 9, goods: 4 },
    }).players;

    // 4 goods plus the factory's prestige. Metal and energy are not score.
    expect(scoreOf(player)).toBe(5);
  });

  it("counts prestige in the compound, never in hand", () => {
    const beacons = createBlueprintDeck().filter((card) => card.name === "Beacon");
    const state = createInitialState({ seed: 3 });
    const [inHand] = patchPlayer(state, 0, {
      hand: beacons,
      compound: [],
      resources: { metal: 0, energy: 0, goods: 3 },
    }).players;

    expect(scoreOf(inHand)).toBe(3);

    const [built] = patchPlayer(state, 0, {
      hand: [],
      compound: beacons.map((card) => ({ card, dice: [], worked: false })),
      resources: { metal: 0, energy: 0, goods: 3 },
    }).players;

    // Four Beacons score five, on top of the three goods.
    expect(scoreOf(built)).toBe(8);
  });

  it("wins the game on the total, not on either half", () => {
    const factory = cardNamed(createBlueprintDeck(), "Aluminum Factory");
    const state = createInitialState({ seed: 3 });
    const scored = patchPlayer(
      patchPlayer({ ...state, phase: "cleanup" }, 0, {
        compound: [{ card: factory, dice: [], worked: false }],
        // One prestige and enough goods to end it: 13 all told.
        resources: { metal: 0, energy: 0, goods: END_GOODS },
      }),
      1,
      // More goods, but nothing built, so 12.
      { resources: { metal: 0, energy: 0, goods: END_GOODS } },
    );

    const finished = applyMove(scored, { type: "endPhase" });
    expect(finished.winner).toBe(0);
  });

  it("calls an equal score a draw", () => {
    const state = createInitialState({ seed: 3 });
    const drawn = patchPlayer(
      patchPlayer({ ...state, phase: "cleanup" }, 0, {
        resources: { metal: 0, energy: 0, goods: END_GOODS },
      }),
      1,
      { resources: { metal: 0, energy: 0, goods: END_GOODS } },
    );

    expect(applyMove(drawn, { type: "endPhase" }).winner).toBeNull();
  });
});

describe("the Headquarters", () => {
  const section = (id: HqSectionId) => HQ_SECTIONS.find((s) => s.id === id)!;

  /** A player in the Work Phase holding exactly these faces, already rolled. */
  function withDice(
    state: GameState,
    faces: readonly DieFace[],
    patch: Partial<Player> = {},
  ): GameState {
    const { color } = state.players[0];
    return patchPlayer({ ...state, phase: "work" }, 0, {
      dice: faces.map((face, i) => ({ id: `d${i}`, face, color, extra: false, spent: false })),
      rolled: true,
      ...patch,
    });
  }

  function place(state: GameState, id: HqSectionId, dieIndex: number): GameState {
    return applyMove(state, { type: "placeDie", section: id, dieId: `d${dieIndex}` });
  }

  it("has the three printed sections, three slots each", () => {
    expect(HQ_SECTIONS.map((s) => s.id)).toEqual(["research", "generate", "mine"]);
    for (const s of HQ_SECTIONS) expect(s.slots).toBe(3);

    expect(section("research").slots).toBe(3);
    expect(section("research").accepts).toEqual({ kind: "any" });
    expect(section("research").reward).toEqual({ kind: "drawBlueprint" });

    expect(section("generate").slots).toBe(3);
    expect(section("generate").accepts).toEqual({ kind: "atMost", face: 3 });
    expect(section("generate").reward).toEqual({ kind: "energyByFace" });

    expect(section("mine").slots).toBe(3);
    expect(section("mine").accepts).toEqual({ kind: "atLeast", face: 4 });
    expect(section("mine").reward).toEqual({ kind: "gain", resources: { metal: 1 } });
  });

  it("offers a low die Research and Generate, a high die Research and Mine", () => {
    const state = withDice(createInitialState({ seed: 3 }), [2, 5]);
    const sectionsFor = (dieId: string) =>
      legalMoves(state)
        .filter((move) => move.type === "placeDie" && move.dieId === dieId)
        .map((move) => (move.type === "placeDie" ? move.section : null));

    expect(sectionsFor("d0")).toEqual(["research", "generate"]);
    expect(sectionsFor("d1")).toEqual(["research", "mine"]);
  });

  it("draws a blueprint off the deck for a die on Research", () => {
    const state = withDice(createInitialState({ seed: 3 }), [6]);
    const top = state.blueprints.deck[0];
    const row = state.blueprints.row.map((card) => card.id);

    const next = place(state, "research", 0);
    const [player] = next.players;

    expect(player.hand.map((card) => card.id)).toContain(top.id);
    expect(next.blueprints.deck).toHaveLength(state.blueprints.deck.length - 1);
    // Off the top of the deck, never out of the market row.
    expect(next.blueprints.row.map((card) => card.id)).toEqual(row);
    expect(player.headquarters.research).toEqual([6]);
    expect(player.dice[0].spent).toBe(true);
  });

  it("reshuffles the discard when Research empties the deck", () => {
    const discarded = copiesOf("Depot");
    const state = withDice(createInitialState({ seed: 3 }), [1]);
    const empty: GameState = {
      ...state,
      blueprints: { ...state.blueprints, deck: [], discard: discarded },
    };

    const next = place(empty, "research", 0);

    expect(next.players[0].hand).toHaveLength(state.players[0].hand.length + 1);
    expect(next.blueprints.discard).toEqual([]);
    expect(next.blueprints.deck).toHaveLength(discarded.length - 1);
  });

  it("pays energy equal to the die on Generate, and one metal on Mine", () => {
    const state = withDice(createInitialState({ seed: 3 }), [3, 4], {
      resources: { metal: 0, energy: 0, goods: 0 },
    });

    expect(place(state, "generate", 0).players[0].resources.energy).toBe(3);
    expect(place(state, "mine", 1).players[0].resources.metal).toBe(1);
  });

  it("refuses a face the section does not take, and a section that is full", () => {
    const state = withDice(createInitialState({ seed: 3 }), [4, 1]);

    expect(() => place(state, "generate", 0)).toThrow(/takes 3 or less, not a 4/);
    expect(() => place(state, "mine", 1)).toThrow(/takes 4 or more, not a 1/);

    const full = withDice(createInitialState({ seed: 3 }), [1], {
      headquarters: { ...NO_PLACEMENTS, generate: [1, 2, 3] },
    });
    expect(() => place(full, "generate", 0)).toThrow(/Generate is full/);
    expect(legalMoves(full).filter((move) => move.type === "placeDie")).toHaveLength(1);
  });

  it("doubles for a matching die and triples for a third", () => {
    let state = withDice(createInitialState({ seed: 3 }), [2, 2, 2], {
      resources: { metal: 0, energy: 0, goods: 0 },
    });

    // 2 energy, then 2×2, then 2×3 — the bonus is on the die being placed.
    state = place(state, "generate", 0);
    expect(state.players[0].resources.energy).toBe(2);
    state = place(state, "generate", 1);
    expect(state.players[0].resources.energy).toBe(6);
    state = place(state, "generate", 2);
    expect(state.players[0].resources.energy).toBe(12);

    expect(state.players[0].headquarters.generate).toEqual([2, 2, 2]);
    expect(state.log.at(-1)).toMatch(/placed a 2 on Generate ×3 for matching/);
  });

  it("counts matches per section, not across the tile", () => {
    let state = withDice(createInitialState({ seed: 3 }), [5, 5], {
      resources: { metal: 0, energy: 0, goods: 0 },
    });

    // A 5 on Research does not make the 5 on Mine a match.
    state = place(state, "research", 0);
    state = place(state, "mine", 1);

    expect(state.players[0].resources.metal).toBe(1);
  });

  it("tops out at triple — three slots is the whole section", () => {
    let state = withDice(createInitialState({ seed: 3 }), [6, 6, 6, 6], {
      resources: { metal: 0, energy: 0, goods: 0 },
    });

    for (let i = 0; i < 3; i++) state = place(state, "mine", i);

    // 1 + 2 + 3, and the fourth 6 has nowhere on Mine to go.
    expect(state.players[0].resources.metal).toBe(6);
    expect(() => place(state, "mine", 3)).toThrow(/Mine is full/);
    expect(legalMoves(state).filter((move) => move.type === "placeDie")).toEqual([
      { type: "placeDie", section: "research", dieId: "d3" },
    ]);
  });

  it("clears its placements at cleanup", () => {
    const state = withDice(createInitialState({ seed: 3 }), [5], {
      headquarters: { ...NO_PLACEMENTS, mine: [4, 4] },
    });
    const cleaned = applyMove({ ...state, phase: "cleanup" }, { type: "endPhase" });

    for (const player of cleaned.players) {
      expect(player.headquarters).toEqual(NO_PLACEMENTS);
    }
  });
});

describe("the Dojo", () => {
  const dojo = cardNamed(createBlueprintDeck(), "Dojo");

  function withDojo(faces: readonly DieFace[], energy = 2): GameState {
    const state = createInitialState({ seed: 3 });
    const { color } = state.players[0];
    return patchPlayer({ ...state, phase: "work" }, 0, {
      compound: [{ card: dojo, dice: [], worked: false }],
      dice: faces.map((face, i) => ({ id: `d${i}`, face, color, extra: false, spent: false })),
      rolled: true,
      resources: { metal: 0, energy, goods: 0 },
    });
  }

  function flips(state: GameState) {
    return legalMoves(state)
      .filter((move) => move.type === "activate")
      .map((move) =>
        move.type === "activate" && move.targetDieId
          ? state.players[0].dice.find((d) => d.id === move.targetDieId)!.face
          : null,
      );
  }

  it("is a Training gear costing 1 metal and 2 energy, worth no prestige", () => {
    expect(dojo.type).toBe("training");
    expect(dojo.tool).toBe("gear");
    expect(dojo.buildCost).toEqual({ metal: 1, energy: 2, goods: 0 });
    expect(dojo.prestige).toBeUndefined();
    // It takes no die of its own — the die it names is not paid to it.
    expect(dojo.perk?.dice).toBe(0);
    expect(dojo.perk?.cost).toEqual({ metal: 0, energy: 1, goods: 0 });
    expect(dojo.perk?.effect).toEqual({ kind: "flipDie" });
  });

  it("opposite faces always add up to seven", () => {
    expect(DIE_FACES.map(oppositeFace)).toEqual([6, 5, 4, 3, 2, 1]);
  });

  it("turns a die over and leaves it on the table, unspent", () => {
    const next = applyMove(withDojo([5, 1, 3, 4]), {
      type: "activate",
      cardId: dojo.id,
      dieIds: [],
      targetDieId: "d0",
    });

    const die = next.players[0].dice.find((d) => d.id === "d0")!;
    expect(die.face).toBe(2);
    // The whole point is to use it afterwards, so it must not be spent.
    expect(die.spent).toBe(false);
    expect(next.players[0].resources.energy).toBe(1);
    expect(logged(next, /turned a 5 over to a 2/)).toBe(true);
  });

  it("offers one flip per face, not one per die", () => {
    // Two 5s turn over to the same thing, so they are the same move.
    expect(flips(withDojo([5, 5, 1, 3]))).toEqual([5, 1, 3]);
    expect(flips(withDojo([2, 4, 6, 1]))).toEqual([2, 4, 6, 1]);
  });

  it("will not turn over a die that has been spent", () => {
    const state = withDojo([5, 1, 3, 4]);
    const used = patchPlayer(state, 0, {
      dice: state.players[0].dice.map((die) => (die.id === "d0" ? { ...die, spent: true } : die)),
    });

    expect(flips(used)).toEqual([1, 3, 4]);
    expect(() =>
      applyMove(used, { type: "activate", cardId: dojo.id, dieIds: [], targetDieId: "d0" }),
    ).toThrow(/was already spent/);
  });

  it("is not offered without the energy, and works once a round", () => {
    expect(flips(withDojo([5, 1, 3, 4], 0))).toEqual([]);

    const once = applyMove(withDojo([5, 1, 3, 4]), {
      type: "activate",
      cardId: dojo.id,
      dieIds: [],
      targetDieId: "d0",
    });
    expect(flips(once)).toEqual([]);
    expect(once.players[0].compound[0].worked).toBe(true);
  });

  it("needs to be told which die, and no other perk accepts one", () => {
    expect(() =>
      applyMove(withDojo([5, 1, 3, 4]), { type: "activate", cardId: dojo.id, dieIds: [] }),
    ).toThrow(/needs a die to turn over/);

    // A perk that pays out on its own must not be handed a target.
    const battery = cardNamed(createBlueprintDeck(), "Battery Factory");
    const state = patchPlayer(withDojo([5, 1, 3, 4], 4), 0, {
      compound: [{ card: battery, dice: [], worked: false }],
    });
    expect(() =>
      applyMove(state, {
        type: "activate",
        cardId: battery.id,
        dieIds: [],
        targetDieId: "d0",
      }),
    ).toThrow(/does not turn a die over/);
  });

  it("turns a die into one that works something else", () => {
    // A 5 works nothing on the Biolab, which wants a 1. Turned over it is a 2,
    // which still does not — but a 6 turns into the 1 the Biolab needs.
    const biolab = cardNamed(createBlueprintDeck(), "Biolab");
    const state = patchPlayer(withDojo([6, 3, 4, 5], 3), 0, {
      compound: [
        { card: dojo, dice: [], worked: false },
        { card: biolab, dice: [], worked: false },
      ],
    });

    const flipped = applyMove(state, {
      type: "activate",
      cardId: dojo.id,
      dieIds: [],
      targetDieId: "d0",
    });
    expect(flipped.players[0].dice.find((d) => d.id === "d0")!.face).toBe(1);

    const worked = applyMove(flipped, {
      type: "activate",
      cardId: biolab.id,
      dieIds: ["d0"],
    });
    expect(worked.players[0].resources.goods).toBe(1);
  });
});

describe("the automaton", () => {
  const factory = cardNamed(createBlueprintDeck(), "Aluminum Factory"); // production
  const market = cardNamed(createBlueprintDeck(), "Black Market"); // utility
  const beacons = copiesOf("Beacon"); // monument — no die answers for it
  const generator = cardNamed(createBlueprintDeck(), "Generator"); // untyped placeholder

  /** The automaton to act in its Market Phase, dice already on the table. */
  function staged(
    faces: Partial<Record<DieColor, DieFace>>,
    compound?: readonly Building[],
  ): GameState {
    const state = createInitialState({ seed: 42 });
    const dice: Die[] = AUTOMA_DIE_COLORS.map((color, i) => ({
      id: `a${i}`,
      face: faces[color] ?? 6,
      color,
      extra: false,
      spent: false,
    }));
    return patchPlayer({ ...state, currentPlayerIndex: 1 }, 1, {
      dice,
      rolled: true,
      ...(compound ? { compound } : {}),
    });
  }

  function working(faces: Partial<Record<DieColor, DieFace>>, compound: readonly Building[]) {
    return { ...staged(faces, compound), phase: "work" as const };
  }

  describe("setup", () => {
    it("passes over a Monument and deals another in its place", () => {
      const line = cardNamed(createBlueprintDeck(), "Assembly Line");
      const biolab = cardNamed(createBlueprintDeck(), "Biolab");
      const draw = [beacons[0], factory, beacons[1], line, biolab];

      const { compound, setAside } = dealAutomaCompound(draw, 3);

      expect(compound.map((b) => b.card.name)).toEqual([
        "Aluminum Factory",
        "Assembly Line",
        "Biolab",
      ]);
      expect(setAside).toEqual([beacons[0], beacons[1]]);
      expect(draw).toEqual([]);
    });

    it("never opens with a Monument, whatever the shuffle", () => {
      for (let seed = 1; seed <= 30; seed++) {
        const state = createInitialState({ seed });
        expect(state.players[1].compound).toHaveLength(AUTOMA_COMPOUND_SIZE);
        for (const building of state.players[1].compound) {
          expect(building.card.type).not.toBe("monument");
        }
      }
    });

    it("throws the passed-over Monuments into the blueprint discard", () => {
      let sawOne = false;
      for (let seed = 1; seed <= 30; seed++) {
        const state = createInitialState({ seed });
        // Nothing else reaches the discard at setup, so anything there was
        // dealt to the automaton and rejected.
        for (const card of state.blueprints.discard) expect(card.type).toBe("monument");
        sawOne ||= state.blueprints.discard.length > 0;
      }
      expect(sawOne).toBe(true);
    });

    it("keeps the compound grouped by type", () => {
      const mixed = [beacons[0], market, factory].map(standing);

      expect(groupByCategory(mixed).map((b) => b.card.name)).toEqual([
        "Aluminum Factory", // production
        "Black Market", // utility
        "Beacon", // monument
      ]);
    });
  });

  describe("its turn", () => {
    it("rolls one die of each colour at the top of the turn, not in the Work Phase", () => {
      const start = { ...createInitialState({ seed: 42 }), currentPlayerIndex: 1 };
      expect(legalMoves(start)).toEqual([{ type: "rollDice" }]);

      const rolled = applyMove(start, { type: "rollDice" });
      const dice = rolled.players[1].dice;

      expect(dice.map((die) => die.color)).toEqual([...AUTOMA_DIE_COLORS]);
      for (const die of dice) {
        expect(die.face).toBeGreaterThanOrEqual(1);
        expect(die.face).toBeLessThanOrEqual(6);
        expect(die.extra).toBe(false);
      }
      // The roll is its Market Phase opening, so the phase has not moved on.
      expect(rolled.phase).toBe("market");
    });

    it("is offered exactly one move at every point of its turn", () => {
      let state: GameState = { ...createInitialState({ seed: 42 }), currentPlayerIndex: 1 };
      for (const expected of ["rollDice", "automaMarket", "automaWork"]) {
        const moves = legalMoves(state);
        expect(moves).toHaveLength(1);
        expect(moves[0].type).toBe(expected);
        state = applyMove(state, moves[0]);
      }
    });
  });

  describe("its Market Phase", () => {
    it("takes the blueprint the green die points at, counting from the left", () => {
      for (const face of [1, 2, 3, 4] as const) {
        const state = staged({ green: face });
        const wanted = state.blueprints.row[face - 1];

        const next = applyMove(state, { type: "automaMarket" });

        expect(next.players[1].compound.map((b) => b.card.id)).toContain(wanted.id);
        expect(next.blueprints.row.map((c) => c.id)).not.toContain(wanted.id);
        // The row closes up at once, as it does for a human take.
        expect(next.blueprints.row).toHaveLength(MARKET_ROW_SIZE);
      }
    });

    it("stands the card up for free — nothing is paid and nothing is held", () => {
      const state = staged({ green: 1 });
      const next = applyMove(state, { type: "automaMarket" });

      expect(next.players[1].resources).toEqual({ metal: 0, energy: 0, goods: 0 });
      expect(next.players[1].hand).toEqual([]);
      expect(next.players[1].compound).toHaveLength(AUTOMA_COMPOUND_SIZE + 1);
    });

    it("reveals the top of the deck and sweeps the blueprint row on a 5", () => {
      const state = staged({ green: 5 });
      const [top] = state.blueprints.deck;
      const swept = state.blueprints.row;

      const next = applyMove(state, { type: "automaMarket" });

      expect(next.players[1].compound.map((b) => b.card.id)).toContain(top.id);
      for (const card of swept) {
        expect(next.blueprints.discard.map((c) => c.id)).toContain(card.id);
        expect(next.blueprints.row.map((c) => c.id)).not.toContain(card.id);
      }
      // Swept, then refilled: the human still faces a full row.
      expect(next.blueprints.row).toHaveLength(MARKET_ROW_SIZE);
      expect(logged(next, /swept the blueprint row away/)).toBe(true);
    });

    it("reveals the top of the deck and sweeps the contractor row on a 6", () => {
      const state = staged({ green: 6 });
      const [top] = state.blueprints.deck;
      const swept = state.contractors.slots.flatMap((slot) => (slot.card ? [slot.card] : []));

      const next = applyMove(state, { type: "automaMarket" });

      expect(next.players[1].compound.map((b) => b.card.id)).toContain(top.id);
      for (const card of swept) {
        expect(next.contractors.discard.map((c) => c.id)).toContain(card.id);
      }
      // Tokens stay put; only the cards change.
      expect(next.contractors.slots.map((slot) => slot.token)).toEqual(
        state.contractors.slots.map((slot) => slot.token),
      );
      for (const slot of next.contractors.slots) expect(slot.card).not.toBeNull();
      // A 6 leaves the blueprint row alone.
      expect(next.blueprints.row).toEqual(state.blueprints.row);
    });

    it("takes nothing when the slot the die points at is empty", () => {
      const state = staged({ green: 4 });
      const empty: GameState = {
        ...state,
        blueprints: { row: [], deck: [], discard: [] },
      };

      const next = applyMove(empty, { type: "automaMarket" });

      expect(next.players[1].compound).toHaveLength(AUTOMA_COMPOUND_SIZE);
      expect(logged(next, /slot 4 was empty/)).toBe(true);
      // The turn still moves on — a wasted die is not a stuck game.
      expect(next.phase).toBe("work");
    });

    it("spends the green die, whatever it said", () => {
      const next = applyMove(staged({ green: 2 }), { type: "automaMarket" });
      const green = next.players[1].dice.find((die) => die.color === "green");

      expect(green?.spent).toBe(true);
    });
  });

  describe("its Work Phase", () => {
    /** Blue answers for Production, so this compound is what blue counts. */
    const twoProduction = [factory, cardNamed(createBlueprintDeck(), "Biolab")].map(standing);

    it("pays a good when the die is at most the cards of its type", () => {
      // Two Production cards: blue pays on a 1 or a 2, and not on a 3.
      for (const [face, goods] of [
        [1, 1],
        [2, 1],
        [3, 0],
      ] as const) {
        const next = applyMove(
          working({ blue: face, red: 6, purple: 6, yellow: 6 }, twoProduction),
          { type: "automaWork" },
        );
        expect(next.players[1].resources.goods).toBe(goods);
      }
    });

    it("counts each colour against its own type, and adds them up", () => {
      const compound = [factory, market].map(standing); // 1 production, 1 utility

      const next = applyMove(
        working({ blue: 1, yellow: 1, red: 1, purple: 1 }, compound),
        { type: "automaWork" },
      );

      // Blue and yellow each find their one card; red and purple find none.
      expect(next.players[1].resources.goods).toBe(2);
      expect(logged(next, /produced 2 goods — production, utility/)).toBe(true);
    });

    it("never produces from a Monument — no die answers for one", () => {
      const next = applyMove(
        working({ red: 1, blue: 1, purple: 1, yellow: 1 }, beacons.map(standing)),
        { type: "automaWork" },
      );

      expect(next.players[1].resources.goods).toBe(0);
      expect(logged(next, /produced nothing/)).toBe(true);
    });

    it("never produces from an untyped placeholder either", () => {
      const next = applyMove(
        working({ red: 1, blue: 1, purple: 1, yellow: 1 }, [standing(generator)]),
        { type: "automaWork" },
      );

      expect(next.players[1].resources.goods).toBe(0);
    });

    it("ignores the green die, which has already had its say", () => {
      const compound = [factory].map(standing);
      // Green shows a 1, but green answers for no type.
      const next = applyMove(working({ green: 1, red: 6, blue: 6, purple: 6, yellow: 6 }, compound), {
        type: "automaWork",
      });

      expect(next.players[1].resources.goods).toBe(0);
    });

    it("ends the turn, and clears its dice at cleanup", () => {
      const next = applyMove(working({ blue: 1 }, [standing(factory)]), { type: "automaWork" });

      expect(next.phase).toBe("cleanup");
      expect(next.players[1].dice.every((die) => die.spent)).toBe(true);

      const round2 = applyMove(next, { type: "endPhase" });
      expect(round2.players[1].dice).toEqual([]);
      expect(round2.players[1].rolled).toBe(false);
    });
  });

  it("keeps its moves to itself, and the human's away from it", () => {
    const human = createInitialState({ seed: 42 });
    expect(() => applyMove(human, { type: "automaMarket" })).toThrow(/shops for themselves/);

    const automaton = staged({ green: 1 });
    expect(() => applyMove(automaton, { type: "draft", kind: "blueprint", cardId: "x" })).toThrow();
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
      expect(payment?.tool).toBe(slot?.token);
    }

    // And every legal pairing is offered — no more, no fewer. A contractor
    // that also charges resources is only a pairing if they can be paid.
    const pairings = state.contractors.slots
      .filter(
        (slot) =>
          slot.card && canAfford(state.players[0].resources, slot.card.extraCost ?? FREE),
      )
      .flatMap((slot) => hand.filter((card) => card.tool === slot.token));
    expect(offers).toHaveLength(pairings.length);
  });

  it("offers nothing for a slot whose token no blueprint in hand matches", () => {
    const state = createInitialState({ seed: 3 });
    const handTools = new Set(blueprintsIn(state.players[0].hand).map((card) => card.tool));
    const unpayable = state.contractors.slots.filter(
      (slot) => slot.card && !handTools.has(slot.token),
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
    // Taking a card ends the Market Phase for that player, who carries on
    // into their own Work Phase rather than passing the turn.
    expect(next.currentPlayerIndex).toBe(0);
    expect(next.phase).toBe("work");
  });

  it("refills the blueprint row from the deck the moment a card is taken", () => {
    const state = createInitialState({ seed: 11 });
    const target = state.blueprints.row[0];
    const nextUp = state.blueprints.deck[0];

    const next = applyMove(state, { type: "draft", kind: "blueprint", cardId: target.id });

    expect(next.blueprints.row).toHaveLength(MARKET_ROW_SIZE);
    expect(next.blueprints.row.map((card) => card.id)).toContain(nextUp.id);
    expect(next.blueprints.deck).toHaveLength(state.blueprints.deck.length - 1);
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
    // The slot keeps its token and is refilled at once with a fresh contractor.
    const refilled = next.contractors.slots.find((s) => s.token === slot.token)!;
    expect(refilled.token).toBe(slot.token);
    expect(refilled.card?.id).toBe(state.contractors.deck[0].id);
  });

  it("refills a contractor slot from the deck the moment it is taken", () => {
    const state = createInitialState({ seed: 11 });
    const move = takeableContractor(state);

    const next = applyMove(state, move);

    expect(next.contractors.slots.every((slot) => slot.card !== null)).toBe(true);
    expect(next.contractors.deck).toHaveLength(state.contractors.deck.length - 1);
    // The card just taken sits in the discard, not back on the row.
    expect(next.contractors.slots.map((slot) => slot.card!.id)).not.toContain(move.cardId);
    expect(next.contractors.discard.map((card) => card.id)).toContain(move.cardId);
  });

  it("resolves the contractor's effect at once and discards the card", () => {
    const miner = cardNamed(createContractorDeck(), "Miner");
    const staged = stageContractor(createInitialState({ seed: 11 }), miner);

    const before = staged.players[0].resources;
    const next = takeStaged(staged);
    const [player] = next.players;

    // The benefit lands immediately...
    expect(player.resources.metal).toBe(before.metal + 3);
    expect(player.resources.energy).toBe(before.energy);
    expect(player.resources.goods).toBe(before.goods);
    // ...and the card goes straight to the discard, never to hand.
    expect(next.contractors.discard.map((card) => card.id)).toContain(miner.id);
    expect(player.hand.map((card) => card.id)).not.toContain(miner.id);
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
    const wrong = blueprintsIn(state.players[0].hand).find((card) => card.tool !== slot.token);
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

  it("builds by discarding a same-tool blueprint and paying the cost", () => {
    const state = createInitialState({ seed: 3 });
    // Mine is a shovel costing 1 metal and 1 energy.
    const [card, payment] = copiesOf("Mine");
    const staged: GameState = patchPlayer({ ...state, phase: "work" }, 0, {
      hand: [card, payment],
      resources: { metal: 3, energy: 3, goods: 0 },
      rolled: true,
    });

    const next = applyMove(staged, {
      type: "build",
      cardId: card.id,
      paymentCardId: payment.id,
    });
    const [player] = next.players;

    expect(player.compound.map((b) => b.card.id)).toEqual([card.id]);
    expect(player.resources).toEqual({ metal: 2, energy: 2, goods: 0 });
    // Both cards leave hand: one is built, the other is discarded as payment.
    expect(player.hand).toEqual([]);
    expect(next.blueprints.discard.map((c) => c.id)).toContain(payment.id);
    // No die was spent — building takes none.
    expect(player.dice).toEqual([]);
  });

  it("will not build without a matching tool to discard", () => {
    const state = createInitialState({ seed: 3 });
    const mine = copiesOf("Mine")[0];
    const generator = copiesOf("Generator")[0];
    const staged: GameState = patchPlayer({ ...state, phase: "work" }, 0, {
      hand: [mine, generator],
      resources: { metal: 5, energy: 5, goods: 0 },
      rolled: true,
    });

    // A shovel and a wrench cannot pay for each other.
    expect(legalMoves(staged).filter((move) => move.type === "build")).toEqual([]);
    expect(() =>
      applyMove(staged, { type: "build", cardId: mine.id, paymentCardId: generator.id }),
    ).toThrow(/costs a shovel blueprint, but Generator is wrench/);
    expect(() =>
      applyMove(staged, { type: "build", cardId: mine.id, paymentCardId: mine.id }),
    ).toThrow(/cannot pay for itself/);
  });

  it("refuses a second copy of a blueprint already in the compound", () => {
    const state = createInitialState({ seed: 3 });
    const [built, spare, alsoSpare] = copiesOf("Generator");
    const [mine, otherMine] = copiesOf("Mine");
    const staged: GameState = patchPlayer({ ...state, phase: "work" }, 0, {
      hand: [spare, alsoSpare, mine, otherMine],
      compound: [{ card: built, dice: [], worked: false }],
      resources: { metal: 5, energy: 5, goods: 0 },
      rolled: true,
    });

    const builds = legalMoves(staged).filter((move) => move.type === "build");

    // Two wrenches in hand could pay for a Generator, but one is already up.
    expect(new Set(builds.map((move) => move.cardId))).toEqual(new Set([mine.id, otherMine.id]));
    expect(() =>
      applyMove(staged, { type: "build", cardId: spare.id, paymentCardId: alsoSpare.id }),
    ).toThrow(/already built Generator/);
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
    expect(finished.log.filter((line) => line.includes("worked")).length).toBeGreaterThan(0);
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
