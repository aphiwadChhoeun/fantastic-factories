import { describe, expect, it } from "vitest";
import { createRandomAi } from "@/ai";
import {
  applyMove,
  AUTOMA_COMPOUND_SIZE,
  activationOptions,
  AUTOMA_DIE_COLORS,
  dealAutomaCompound,
  groupByCategory,
  standing,
  BLUEPRINT_CATEGORIES,
  BLUEPRINT_TOOLS,
  buildCostFor,
  canAfford,
  createBlueprintDeck,
  createContractorDeck,
  createInitialState,
  currentPlayer,
  DIE_COLORS,
  DIE_FACES,
  END_GOODS,
  EXTRA_DIE_COLOR,
  HAND_LIMIT,
  HQ_SECTIONS,
  overLimits,
  perkFor,
  RESOURCE_LIMIT,
  stockOf,
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
    const factory = copiesOf("Aluminum Factory")[0];
    const staged = stageContractor(
      state,
      engineer,
      { resources: { metal: 0, energy: 4, goods: 0 } },
      [factory, ...copiesOf("Battery Factory")],
    );

    const before = staged.players[0].hand;
    const [player] = takeStaged(staged).players;

    expect(player.compound.map((b) => b.card.id)).toContain(factory.id);
    // The Engineer's own cost is paid, the blueprint's build cost is not.
    expect(player.resources).toEqual({ metal: 0, energy: 0, goods: 0 });
    // No die was needed, and the card never passed through hand: the hand is
    // exactly what it was, less the blueprint spent on the contractor.
    expect(player.hand).toEqual(before.slice(1));
    expect(player.dice).toEqual([]);
  });

  it("discards a duplicate and draws again", () => {
    const state = createInitialState({ seed: 11 });
    const [built, duplicate] = copiesOf("Fitness Center");
    const factory = copiesOf("Aluminum Factory")[0];
    const staged = stageContractor(
      state,
      engineer,
      {
        resources: { metal: 0, energy: 4, goods: 0 },
        compound: [{ card: built, dice: [], worked: false }],
      },
      [duplicate, factory],
    );

    const next = takeStaged(staged);
    const [player] = next.players;

    expect(player.compound.map((b) => b.card.id)).toEqual([built.id, factory.id]);
    expect(next.blueprints.discard.map((card) => card.id)).toContain(duplicate.id);
    expect(logged(next, /built Aluminum Factory for free \(discarded 1/)).toBe(true);
  });

  it("builds nothing when every blueprint left is one the player has built", () => {
    const state = createInitialState({ seed: 11 });
    const [built, duplicate, payment] = copiesOf("Fitness Center");
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

  it("gives every blueprint in the deck a printed type", () => {
    // The scaffold's invented cards are gone, so there is no untyped card
    // left to answer to no die.
    for (const card of deck) {
      expect(BLUEPRINT_CATEGORIES).toContain(card.type);
    }
  });

  it("has no card the scaffold made up", () => {
    const invented = ["Generator", "Mine", "Warehouse", "Research Lab", "Depot"];
    for (const name of invented) {
      expect(deck.map((card) => card.name)).not.toContain(name);
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
    const shovel = copiesOf("Concrete Plant")[0];
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
    expect(logged(next, /worked Black Market with 5 for Assembly Line/)).toBe(true);
    expect(logged(next, /chose: gained 2 metal, 1 energy/)).toBe(true);
  });

  it("offers one move per blueprint in hand, and none with an empty hand", () => {
    expect(offers(withMarket([line, cardNamed(createBlueprintDeck(), "Biolab")]))).toHaveLength(2);
    expect(offers(withMarket([]))).toEqual([]);
  });

  it("caps the payout at four, and offers every way to take it", () => {
    const state = withMarket([beacon]);
    const perk = market.perk!;
    const options = activationOptions(perk, [beacon]);

    // A Beacon cost 2 metal and 4 energy; four of those six come back.
    expect(options).toEqual([
      { kind: "gain", resources: { metal: 0, energy: 4, goods: 0 } },
      { kind: "gain", resources: { metal: 1, energy: 3, goods: 0 } },
      { kind: "gain", resources: { metal: 2, energy: 2, goods: 0 } },
    ]);
    // One move per way, each pointing at its option by index.
    expect(
      offers(state).map((move) => (move.type === "activate" ? move.option : undefined)),
    ).toEqual([0, 1, 2]);

    const next = applyMove(state, {
      type: "activate",
      cardId: market.id,
      dieIds: ["d0"],
      paymentCardIds: [beacon.id],
      option: 2,
    });
    expect(next.players[0].resources).toEqual({ metal: 2, energy: 2, goods: 0 });
  });

  it("refuses a haul the discarded card does not pay", () => {
    const state = withMarket([beacon]);
    const activate = (option: number): Move => ({
      type: "activate",
      cardId: market.id,
      dieIds: ["d0"],
      paymentCardIds: [beacon.id],
      option,
    });

    // There are three ways to take four; there is no fourth.
    expect(() => applyMove(state, activate(3))).toThrow(/no such payout/);
    expect(() => applyMove(state, activate(-1))).toThrow(/no such payout/);
    expect(() =>
      applyMove(state, { type: "activate", cardId: market.id, dieIds: ["d0"] }),
    ).toThrow(/eats 1 blueprint, not 0/);
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
        paymentCardIds: [line.id],
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
    const plant = copiesOf("Concrete Plant")[0];
    const factory = cardNamed(createBlueprintDeck(), "Aluminum Factory");

    expect(prestigeOf([{ card: plant, dice: [], worked: false }])).toBe(0);
    expect(
      prestigeOf([
        { card: plant, dice: [], worked: false },
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
      // The same goods, but nothing standing, so 12. The automaton is dealt a
      // compound at setup, so it has to be cleared to make the point.
      { compound: [], resources: { metal: 0, energy: 0, goods: END_GOODS } },
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
      // Nothing standing on either side, so the goods are the whole score.
      { compound: [], resources: { metal: 0, energy: 0, goods: END_GOODS } },
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
    const discarded = copiesOf("Battery Factory");
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
    expect(logged(next, /turned a 5 into a 2/)).toBe(true);
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
    ).toThrow(/needs a die to change/);

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
    ).toThrow(/does not change a die/);
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

describe("the Fitness Center", () => {
  const gym = cardNamed(createBlueprintDeck(), "Fitness Center");

  function withGym(faces: readonly DieFace[], energy = 2): GameState {
    const state = createInitialState({ seed: 3 });
    const { color } = state.players[0];
    return patchPlayer({ ...state, phase: "work" }, 0, {
      compound: [{ card: gym, dice: [], worked: false }],
      dice: faces.map((face, i) => ({ id: `d${i}`, face, color, extra: false, spent: false })),
      rolled: true,
      resources: { metal: 0, energy, goods: 0 },
    });
  }

  function targets(state: GameState) {
    return legalMoves(state)
      .filter((move) => move.type === "activate")
      .map((move) =>
        move.type === "activate" && move.targetDieId
          ? state.players[0].dice.find((d) => d.id === move.targetDieId)!.face
          : null,
      );
  }

  it("is a Training wrench costing 1 metal, worth no prestige", () => {
    expect(gym.type).toBe("training");
    expect(gym.tool).toBe("wrench");
    expect(gym.buildCost).toEqual({ metal: 1, energy: 0, goods: 0 });
    expect(gym.prestige).toBeUndefined();
    expect(gym.perk?.dice).toBe(0);
    expect(gym.perk?.cost).toEqual({ metal: 0, energy: 1, goods: 0 });
    expect(gym.perk?.effect).toEqual({ kind: "stepDie", by: -1 });
  });

  it("takes one off a die and leaves it unspent", () => {
    const next = applyMove(withGym([5, 2, 3, 4]), {
      type: "activate",
      cardId: gym.id,
      dieIds: [],
      targetDieId: "d0",
    });

    const die = next.players[0].dice.find((d) => d.id === "d0")!;
    expect(die.face).toBe(4);
    expect(die.spent).toBe(false);
    expect(next.players[0].resources.energy).toBe(1);
    expect(logged(next, /turned a 5 into a 4/)).toBe(true);
  });

  it("will not touch a 1 — there is nowhere for it to go", () => {
    expect(targets(withGym([1, 1, 1, 1]))).toEqual([]);
    // A 1 among others is skipped, and the rest are still offered once each.
    expect(targets(withGym([1, 6, 6, 3]))).toEqual([6, 3]);

    expect(() =>
      applyMove(withGym([1, 6, 3, 4]), {
        type: "activate",
        cardId: gym.id,
        dieIds: [],
        targetDieId: "d0",
      }),
    ).toThrow(/Fitness Center cannot change a 1/);
  });

  it("is not offered without the energy, and works once a round", () => {
    expect(targets(withGym([5, 2, 3, 4], 0))).toEqual([]);

    const once = applyMove(withGym([5, 2, 3, 4]), {
      type: "activate",
      cardId: gym.id,
      dieIds: [],
      targetDieId: "d0",
    });
    expect(targets(once)).toEqual([]);
  });
});

describe("the Foundry", () => {
  const foundry = cardNamed(createBlueprintDeck(), "Foundry");

  function withFoundry(faces: readonly DieFace[], energy: number): GameState {
    const state = createInitialState({ seed: 3 });
    const { color } = state.players[0];
    return patchPlayer({ ...state, phase: "work" }, 0, {
      compound: [{ card: foundry, dice: [], worked: false }],
      dice: faces.map((face, i) => ({ id: `d${i}`, face, color, extra: false, spent: false })),
      rolled: true,
      resources: { metal: 0, energy, goods: 0 },
    });
  }

  function placeable(state: GameState) {
    return legalMoves(state)
      .filter((move) => move.type === "activate")
      .map((move) =>
        move.type === "activate"
          ? state.players[0].dice.find((d) => d.id === move.dieIds[0])!.face
          : null,
      );
  }

  it("is a Utility gear costing 2 metal and 1 energy, worth a prestige", () => {
    expect(foundry.type).toBe("utility");
    expect(foundry.tool).toBe("gear");
    expect(foundry.buildCost).toEqual({ metal: 2, energy: 1, goods: 0 });
    expect(foundry.prestige).toBe(1);
    expect(foundry.perk?.costByFace).toBe("energy");
    expect(foundry.perk?.effect).toEqual({ kind: "gainByFace", resource: "metal" });
  });

  it("trades energy for metal at whatever rate the die says", () => {
    const next = applyMove(withFoundry([5, 1, 3, 4], 6), {
      type: "activate",
      cardId: foundry.id,
      dieIds: ["d0"],
    });

    // Five in, five out — and the die is spent on the card.
    expect(next.players[0].resources).toEqual({ metal: 5, energy: 1, goods: 0 });
    expect(next.players[0].compound[0].dice).toEqual([5]);
    expect(next.players[0].dice.find((d) => d.id === "d0")!.spent).toBe(true);
  });

  it("offers only the dice the energy covers", () => {
    // Three energy buys a 1, a 2 or a 3, and no more.
    expect(placeable(withFoundry([1, 3, 5, 6], 3))).toEqual([1, 3]);
    expect(placeable(withFoundry([1, 3, 5, 6], 6))).toEqual([1, 3, 5, 6]);
    expect(placeable(withFoundry([2, 4, 5, 6], 1))).toEqual([]);

    expect(() =>
      applyMove(withFoundry([5, 1, 3, 4], 2), {
        type: "activate",
        cardId: foundry.id,
        dieIds: ["d0"],
      }),
    ).toThrow(/costs 5 energy to use/);
  });
});

describe("the Fulfillment Center", () => {
  const centre = cardNamed(createBlueprintDeck(), "Fulfillment Center");

  function withCentre(faces: readonly DieFace[], energy = 2): GameState {
    const state = createInitialState({ seed: 3 });
    const { color } = state.players[0];
    return patchPlayer({ ...state, phase: "work" }, 0, {
      compound: [{ card: centre, dice: [], worked: false }],
      dice: faces.map((face, i) => ({ id: `d${i}`, face, color, extra: false, spent: false })),
      rolled: true,
      resources: { metal: 0, energy, goods: 0 },
    });
  }

  it("is a Production hammer costing 2 metal and 1 energy, worth a prestige", () => {
    expect(centre.type).toBe("production");
    expect(centre.tool).toBe("hammer");
    expect(centre.buildCost).toEqual({ metal: 2, energy: 1, goods: 0 });
    expect(centre.prestige).toBe(1);
  });

  it("takes a 4 and two energy, and pays a good and a metal", () => {
    const next = applyMove(withCentre([4, 1, 3, 5]), {
      type: "activate",
      cardId: centre.id,
      dieIds: ["d0"],
    });

    expect(next.players[0].resources).toEqual({ metal: 1, energy: 0, goods: 1 });
    expect(next.players[0].compound[0].dice).toEqual([4]);
  });

  it("takes nothing but a 4, and not without the energy", () => {
    const activations = (state: GameState) =>
      legalMoves(state).filter((move) => move.type === "activate");

    expect(activations(withCentre([1, 3, 5, 6]))).toEqual([]);
    expect(activations(withCentre([4, 4, 5, 6]))).toHaveLength(1);
    expect(activations(withCentre([4, 1, 3, 5], 1))).toEqual([]);

    expect(() =>
      applyMove(withCentre([5, 1, 3, 4]), {
        type: "activate",
        cardId: centre.id,
        dieIds: ["d0"],
      }),
    ).toThrow(/A 5 does not work Fulfillment Center/);
  });
});

describe("the Golem", () => {
  const golem = cardNamed(createBlueprintDeck(), "Golem");

  function withGolem(energy: number): GameState {
    const state = createInitialState({ seed: 3 });
    const { color } = state.players[0];
    return patchPlayer({ ...state, phase: "work" }, 0, {
      compound: [{ card: golem, dice: [], worked: false }],
      dice: [{ id: "d0", face: 2, color, extra: false, spent: false }],
      rolled: true,
      resources: { metal: 0, energy, goods: 0 },
    });
  }

  function faces(state: GameState) {
    return legalMoves(state)
      .filter((move) => move.type === "activate")
      .map((move) => (move.type === "activate" ? move.face : undefined));
  }

  it("is a Monument hammer costing 4 metal, worth a prestige", () => {
    expect(golem.type).toBe("monument");
    expect(golem.tool).toBe("hammer");
    expect(golem.buildCost).toEqual({ metal: 4, energy: 0, goods: 0 });
    expect(golem.prestige).toBe(1);
    expect(golem.perk?.dice).toBe(0);
    expect(golem.perk?.costByFace).toBe("energy");
    expect(golem.perk?.effect).toEqual({ kind: "gainDie" });
  });

  it("sells a die at the face you name, for that much energy", () => {
    const next = applyMove(withGolem(6), {
      type: "activate",
      cardId: golem.id,
      dieIds: [],
      face: 4,
    });

    const bought = next.players[0].dice.at(-1)!;
    expect(bought.face).toBe(4);
    expect(bought.spent).toBe(false);
    // White and lent for the round, like a contractor's dice.
    expect(bought.color).toBe(EXTRA_DIE_COLOR);
    expect(bought.extra).toBe(true);
    expect(next.players[0].resources.energy).toBe(2);
    expect(logged(next, /bought an extra white die showing 4/)).toBe(true);
  });

  it("offers only the faces the energy stretches to", () => {
    expect(faces(withGolem(6))).toEqual([1, 2, 3, 4, 5, 6]);
    expect(faces(withGolem(3))).toEqual([1, 2, 3]);
    expect(faces(withGolem(0))).toEqual([]);

    expect(() =>
      applyMove(withGolem(3), { type: "activate", cardId: golem.id, dieIds: [], face: 5 }),
    ).toThrow(/costs 5 energy to use/);
  });

  it("needs a face, and no other perk takes one", () => {
    expect(() =>
      applyMove(withGolem(6), { type: "activate", cardId: golem.id, dieIds: [] }),
    ).toThrow(/needs a face for the die/);

    const battery = cardNamed(createBlueprintDeck(), "Battery Factory");
    const state = patchPlayer(withGolem(6), 0, {
      compound: [{ card: battery, dice: [], worked: false }],
    });
    expect(() =>
      applyMove(state, { type: "activate", cardId: battery.id, dieIds: [], face: 3 }),
    ).toThrow(/does not hand over a die/);
  });

  it("hands back a die that can be spent, and cleanup takes it away", () => {
    const bought = applyMove(withGolem(6), {
      type: "activate",
      cardId: golem.id,
      dieIds: [],
      face: 5,
    });

    // The bought die is on the table like any other: it can go on the HQ.
    const placements = legalMoves(bought).filter(
      (move) => move.type === "placeDie" && move.dieId === bought.players[0].dice.at(-1)!.id,
    );
    expect(placements.length).toBeGreaterThan(0);

    const cleaned = applyMove({ ...bought, phase: "cleanup" }, { type: "endPhase" });
    expect(cleaned.players[0].dice).toEqual([]);
  });

  it("works once a round, like any other perk", () => {
    const once = applyMove(withGolem(6), {
      type: "activate",
      cardId: golem.id,
      dieIds: [],
      face: 1,
    });

    expect(faces(once)).toEqual([]);
    expect(once.players[0].compound[0].worked).toBe(true);
  });
});

describe("the Gymnasium", () => {
  const gym = cardNamed(createBlueprintDeck(), "Gymnasium");

  function withGym(dice: readonly DieFace[], energy = 2): GameState {
    const state = createInitialState({ seed: 3 });
    const { color } = state.players[0];
    return patchPlayer({ ...state, phase: "work" }, 0, {
      compound: [{ card: gym, dice: [], worked: false }],
      dice: dice.map((face, i) => ({ id: `d${i}`, face, color, extra: false, spent: false })),
      rolled: true,
      resources: { metal: 0, energy, goods: 0 },
    });
  }

  function targets(state: GameState) {
    return legalMoves(state)
      .filter((move) => move.type === "activate")
      .map((move) =>
        move.type === "activate" && move.targetDieId
          ? state.players[0].dice.find((d) => d.id === move.targetDieId)!.face
          : null,
      );
  }

  it("is a Training shovel costing 1 metal, worth no prestige", () => {
    expect(gym.type).toBe("training");
    expect(gym.tool).toBe("shovel");
    expect(gym.buildCost).toEqual({ metal: 1, energy: 0, goods: 0 });
    expect(gym.prestige).toBeUndefined();
    // The Fitness Center's step, the other way up.
    expect(gym.perk?.effect).toEqual({ kind: "stepDie", by: 1 });
  });

  it("puts one on a die and leaves it unspent", () => {
    const next = applyMove(withGym([2, 5, 3, 4]), {
      type: "activate",
      cardId: gym.id,
      dieIds: [],
      targetDieId: "d0",
    });

    const die = next.players[0].dice.find((d) => d.id === "d0")!;
    expect(die.face).toBe(3);
    expect(die.spent).toBe(false);
    expect(next.players[0].resources.energy).toBe(1);
    expect(logged(next, /turned a 2 into a 3/)).toBe(true);
  });

  it("will not touch a 6 — there is nowhere for it to go", () => {
    expect(targets(withGym([6, 6, 6, 6]))).toEqual([]);
    expect(targets(withGym([6, 1, 1, 4]))).toEqual([1, 4]);

    expect(() =>
      applyMove(withGym([6, 1, 3, 4]), {
        type: "activate",
        cardId: gym.id,
        dieIds: [],
        targetDieId: "d0",
      }),
    ).toThrow(/Gymnasium cannot change a 6/);
  });
});

describe("the Harvester", () => {
  const harvester = cardNamed(createBlueprintDeck(), "Harvester");
  function withHarvester(dice: readonly DieFace[]): GameState {
    const state = createInitialState({ seed: 3 });
    const { color } = state.players[0];
    return patchPlayer({ ...state, phase: "work" }, 0, {
      compound: [{ card: harvester, dice: [], worked: false }],
      dice: dice.map((face, i) => ({ id: `d${i}`, face, color, extra: false, spent: false })),
      rolled: true,
      resources: { metal: 0, energy: 0, goods: 0 },
    });
  }

  it("is a Utility hammer costing 1 metal and 2 energy, worth a prestige", () => {
    expect(harvester.type).toBe("utility");
    expect(harvester.tool).toBe("hammer");
    expect(harvester.buildCost).toEqual({ metal: 1, energy: 2, goods: 0 });
    expect(harvester.prestige).toBe(1);
    expect(harvester.perk?.dice).toBe(2);
    expect(harvester.perk?.pattern).toBe("matching");
    expect(harvester.perk?.effect).toEqual({
      kind: "oneOf",
      options: [
        { kind: "gain", resources: { metal: 4 } },
        { kind: "gain", resources: { energy: 7 } },
      ],
    });
  });

  it("offers both payouts for a pair, and pays only the one taken", () => {
    const state = withHarvester([3, 3, 5, 1]);
    const options = legalMoves(state)
      .filter((move) => move.type === "activate")
      .map((move) => (move.type === "activate" ? move.option : undefined));

    expect(options).toEqual([0, 1]);

    const next = applyMove(state, {
      type: "activate",
      cardId: harvester.id,
      dieIds: ["d0", "d1"],
      option: 1,
    });
    expect(next.players[0].resources).toEqual({ metal: 0, energy: 7, goods: 0 });
    expect(logged(next, /chose: gained 7 energy/)).toBe(true);
  });

  it("refuses a payout it does not print", () => {
    const state = withHarvester([3, 3, 5, 1]);
    const activate = (option: number): Move => ({
      type: "activate",
      cardId: harvester.id,
      dieIds: ["d0", "d1"],
      option,
    });

    expect(() => applyMove(state, activate(2))).toThrow(/no such payout/);
    expect(() => applyMove(state, activate(-1))).toThrow(/no such payout/);
    // Two payouts and no word on which is not a move.
    expect(() =>
      applyMove(state, { type: "activate", cardId: harvester.id, dieIds: ["d0", "d1"] }),
    ).toThrow(/pays more than one way/);
  });

  it("still wants a matching pair", () => {
    expect(
      legalMoves(withHarvester([1, 2, 3, 4])).filter((move) => move.type === "activate"),
    ).toEqual([]);
  });
});

describe("the Incinerator", () => {
  const incinerator = cardNamed(createBlueprintDeck(), "Incinerator");
  const beacon = copiesOf("Beacon")[0];

  function withIncinerator(hand: readonly BlueprintCard[], metal = 1): GameState {
    const state = createInitialState({ seed: 3 });
    return patchPlayer({ ...state, phase: "work" }, 0, {
      compound: [{ card: incinerator, dice: [], worked: false }],
      rolled: true,
      hand: [...hand],
      resources: { metal, energy: 0, goods: 0 },
    });
  }

  it("is a Utility shovel costing 2 metal and 1 energy, worth a prestige", () => {
    expect(incinerator.type).toBe("utility");
    expect(incinerator.tool).toBe("shovel");
    expect(incinerator.buildCost).toEqual({ metal: 2, energy: 1, goods: 0 });
    expect(incinerator.prestige).toBe(1);
    // No dice: a card and a metal are the whole price.
    expect(incinerator.perk?.dice).toBe(0);
    expect(incinerator.perk?.discardsCards).toBe(1);
    expect(incinerator.perk?.cost).toEqual({ metal: 1, energy: 0, goods: 0 });
  });

  it("burns a card and a metal for six energy, whatever the card was", () => {
    const state = withIncinerator([beacon]);

    const next = applyMove(state, {
      type: "activate",
      cardId: incinerator.id,
      dieIds: [],
      paymentCardIds: [beacon.id],
    });

    // A Beacon cost 2 metal and 4 energy, and the fire pays the same flat 6.
    expect(next.players[0].resources).toEqual({ metal: 0, energy: 6, goods: 0 });
    expect(next.players[0].hand).toEqual([]);
    expect(next.blueprints.discard).toContain(beacon);
    expect(logged(next, /worked Incinerator for Beacon and 1 metal/)).toBe(true);
  });

  it("offers one move per card in hand, and none with an empty hand or no metal", () => {
    const line = cardNamed(createBlueprintDeck(), "Assembly Line");
    const activations = (state: GameState) =>
      legalMoves(state).filter((move) => move.type === "activate");

    expect(activations(withIncinerator([beacon, line]))).toHaveLength(2);
    expect(activations(withIncinerator([]))).toEqual([]);
    expect(activations(withIncinerator([beacon], 0))).toEqual([]);
  });

  it("needs to be told which card to burn", () => {
    expect(() =>
      applyMove(withIncinerator([beacon]), {
        type: "activate",
        cardId: incinerator.id,
        dieIds: [],
      }),
    ).toThrow(/eats 1 blueprint, not 0/);
  });
});

describe("the Laboratory", () => {
  const lab = cardNamed(createBlueprintDeck(), "Laboratory");
  const battery = cardNamed(createBlueprintDeck(), "Battery Factory");

  /** The Battery Factory beside a Laboratory: 4 energy buys a good. */
  function withLab(energy = 8): GameState {
    const state = createInitialState({ seed: 3 });
    return patchPlayer({ ...state, phase: "work" }, 0, {
      compound: [
        { card: lab, dice: [], worked: false },
        { card: battery, dice: [], worked: false },
      ],
      rolled: true,
      hand: [],
      resources: { metal: 0, energy, goods: 0 },
    });
  }

  const workBattery = (state: GameState) =>
    applyMove(state, { type: "activate", cardId: battery.id, dieIds: [] });

  it("is a Special wrench costing 1 metal and 4 energy, and has no perk", () => {
    expect(lab.type).toBe("special");
    expect(lab.tool).toBe("wrench");
    expect(lab.buildCost).toEqual({ metal: 1, energy: 4, goods: 0 });
    expect(lab.prestige).toBe(1);
    // Nothing is placed on it and nothing paid — it is not worked at all.
    expect(lab.perk).toBeUndefined();
    expect(lab.passive).toEqual({ kind: "drawOnGoods" });
  });

  it("is never offered as a move — it fires by itself", () => {
    const state = withLab();
    const activations = legalMoves(state).filter(
      (move) => move.type === "activate" && move.cardId === lab.id,
    );

    expect(activations).toEqual([]);
    expect(() =>
      applyMove(state, { type: "activate", cardId: lab.id, dieIds: [] }),
    ).toThrow(/has no perk to work/);
  });

  it("draws a blueprint the first time goods are gained", () => {
    const next = workBattery(withLab());

    expect(next.players[0].resources.goods).toBe(1);
    expect(next.players[0].hand).toHaveLength(1);
    expect(logged(next, /drew a blueprint from Laboratory/)).toBe(true);
  });

  it("draws once a round however many goods arrive, and again after cleanup", () => {
    // Two Battery Factories would be two builds, so this reuses the one card
    // by clearing `worked` the way cleanup does.
    const first = workBattery(withLab());
    const refreshed = patchPlayer(first, 0, {
      compound: first.players[0].compound.map((b) =>
        b.card.id === battery.id ? { ...b, worked: false } : b,
      ),
    });

    const second = workBattery(refreshed);
    expect(second.players[0].resources.goods).toBe(2);
    // Still one card: the Laboratory has spent its round.
    expect(second.players[0].hand).toHaveLength(1);
    expect(second.players[0].compound.find((b) => b.card.id === lab.id)?.worked).toBe(true);

    const cleaned = applyMove({ ...second, phase: "cleanup" }, { type: "endPhase" });
    expect(cleaned.players[0].compound.find((b) => b.card.id === lab.id)?.worked).toBe(false);
  });

  it("does not fire on metal or energy", () => {
    const foundry = cardNamed(createBlueprintDeck(), "Foundry");
    const state = createInitialState({ seed: 3 });
    const { color } = state.players[0];
    const staged = patchPlayer({ ...state, phase: "work" }, 0, {
      compound: [
        { card: lab, dice: [], worked: false },
        { card: foundry, dice: [], worked: false },
      ],
      dice: [{ id: "d0", face: 3, color, extra: false, spent: false }],
      rolled: true,
      hand: [],
      resources: { metal: 0, energy: 3, goods: 0 },
    });

    // Three energy in, three metal out — and not a good in sight.
    const next = applyMove(staged, { type: "activate", cardId: foundry.id, dieIds: ["d0"] });
    expect(next.players[0].resources).toEqual({ metal: 3, energy: 0, goods: 0 });
    expect(next.players[0].hand).toEqual([]);
  });

  it("stays quiet for the automaton, which holds no cards", () => {
    const state = createInitialState({ seed: 3 });
    const staged = patchPlayer({ ...state, phase: "work", currentPlayerIndex: 1 }, 1, {
      compound: [
        { card: lab, dice: [], worked: false },
        { card: cardNamed(createBlueprintDeck(), "Aluminum Factory"), dice: [], worked: false },
      ],
      dice: AUTOMA_DIE_COLORS.map((color, i) => ({
        id: `a${i}`,
        face: 1,
        color,
        extra: false,
        spent: false,
      })),
      rolled: true,
    });

    // Blue 1 finds the Production card and purple 1 finds the Laboratory,
    // which is Special — so goods do arrive, and the trigger has its chance.
    const next = applyMove(staged, { type: "automaWork" });

    expect(next.players[1].resources.goods).toBe(2);
    expect(next.players[1].hand).toEqual([]);
  });
});

describe("the Manufactory", () => {
  const manufactory = cardNamed(createBlueprintDeck(), "Manufactory");

  function withManufactory(dice: readonly DieFace[]): GameState {
    const state = createInitialState({ seed: 3 });
    const { color } = state.players[0];
    return patchPlayer({ ...state, phase: "work" }, 0, {
      compound: [{ card: manufactory, dice: [], worked: false }],
      dice: dice.map((face, i) => ({ id: `d${i}`, face, color, extra: false, spent: false })),
      rolled: true,
      hand: [],
      resources: { metal: 0, energy: 0, goods: 0 },
    });
  }

  const work = (state: GameState, option: number) =>
    applyMove(state, {
      type: "activate",
      cardId: manufactory.id,
      dieIds: ["d0", "d1"],
      option,
    });

  it("is a Production wrench costing 2 metal and 3 energy, worth a prestige", () => {
    expect(manufactory.type).toBe("production");
    expect(manufactory.tool).toBe("wrench");
    expect(manufactory.buildCost).toEqual({ metal: 2, energy: 3, goods: 0 });
    expect(manufactory.prestige).toBe(1);
    expect(manufactory.perk?.dice).toBe(2);
    expect(manufactory.perk?.pattern).toBe("matching");
  });

  it("always pays the good, and then whichever of the three is taken", () => {
    const state = withManufactory([4, 4, 1, 2]);
    expect(
      legalMoves(state)
        .filter((move) => move.type === "activate")
        .map((move) => (move.type === "activate" ? move.option : undefined)),
    ).toEqual([0, 1, 2]);

    expect(work(state, 0).players[0].resources).toEqual({ metal: 2, energy: 0, goods: 1 });
    expect(work(state, 1).players[0].resources).toEqual({ metal: 0, energy: 3, goods: 1 });

    // The third is not resources at all.
    const drawn = work(state, 2);
    expect(drawn.players[0].resources).toEqual({ metal: 0, energy: 0, goods: 1 });
    expect(drawn.players[0].hand).toHaveLength(2);
  });

  it("draws off the deck, never the market row", () => {
    const state = withManufactory([4, 4, 1, 2]);
    const row = state.blueprints.row.map((card) => card.id);
    const top = state.blueprints.deck.slice(0, 2).map((card) => card.id);

    const next = work(state, 2);

    expect(next.players[0].hand.map((card) => card.id)).toEqual(top);
    expect(next.blueprints.row.map((card) => card.id)).toEqual(row);
  });

  it("will not be worked without saying which of the three", () => {
    expect(() =>
      applyMove(withManufactory([4, 4, 1, 2]), {
        type: "activate",
        cardId: manufactory.id,
        dieIds: ["d0", "d1"],
      }),
    ).toThrow(/pays more than one way/);
  });
});

describe("the Mega Factory", () => {
  const mega = cardNamed(createBlueprintDeck(), "Mega Factory");

  function withMega(dice: readonly DieFace[]): GameState {
    const state = createInitialState({ seed: 3 });
    const { color } = state.players[0];
    return patchPlayer({ ...state, phase: "work" }, 0, {
      compound: [{ card: mega, dice: [], worked: false }],
      dice: dice.map((face, i) => ({ id: `d${i}`, face, color, extra: false, spent: false })),
      rolled: true,
      resources: { metal: 0, energy: 0, goods: 0 },
    });
  }

  it("is a Production gear costing 3 metal and 2 energy, worth a prestige", () => {
    expect(mega.type).toBe("production");
    expect(mega.tool).toBe("gear");
    expect(mega.buildCost).toEqual({ metal: 3, energy: 2, goods: 0 });
    expect(mega.prestige).toBe(1);
    expect(mega.perk?.dice).toBe(3);
    expect(mega.perk?.pattern).toBe("matching");
  });

  it("pays two goods and hands over a die at the face named", () => {
    const state = withMega([2, 2, 2, 5]);

    const next = applyMove(state, {
      type: "activate",
      cardId: mega.id,
      dieIds: ["d0", "d1", "d2"],
      face: 6,
    });

    expect(next.players[0].resources).toEqual({ metal: 0, energy: 0, goods: 2 });
    const bought = next.players[0].dice.at(-1)!;
    expect(bought.face).toBe(6);
    expect(bought.color).toBe(EXTRA_DIE_COLOR);
    expect(bought.extra).toBe(true);
    expect(bought.spent).toBe(false);
  });

  it("gives the die away free — unlike the Golem, any face will do", () => {
    const faces = legalMoves(withMega([2, 2, 2, 5]))
      .filter((move) => move.type === "activate")
      .map((move) => (move.type === "activate" ? move.face : undefined));

    // No energy at all, and still every face on offer.
    expect(faces).toEqual([1, 2, 3, 4, 5, 6]);
    expect(mega.perk?.costByFace).toBeUndefined();
  });

  it("wants three matching, not two", () => {
    expect(
      legalMoves(withMega([2, 2, 5, 5])).filter((move) => move.type === "activate"),
    ).toEqual([]);
  });
});

describe("the Megalith", () => {
  const megaliths = copiesOf("Megalith");
  const beacons = copiesOf("Beacon");

  function holdingMegalith(compound: readonly Building[]): GameState {
    const state = createInitialState({ seed: 3 });
    return patchPlayer({ ...state, phase: "work" }, 0, {
      compound: [...compound],
      rolled: true,
      hand: [megaliths[1], cardNamed(createBlueprintDeck(), "Battery Factory")],
      resources: { metal: 9, energy: 9, goods: 0 },
    });
  }

  it("is a Monument wrench costing 5 metal and 2 energy, worth three prestige", () => {
    expect(megaliths[0].type).toBe("monument");
    expect(megaliths[0].tool).toBe("wrench");
    expect(megaliths[0].buildCost).toEqual({ metal: 5, energy: 2, goods: 0 });
    expect(megaliths[0].prestige).toBe(3);
    // "Future Megaliths" only means anything if you may stand more than one.
    expect(megaliths[0].duplicable).toBe(true);
    expect(megaliths[0].perk).toBeUndefined();
    expect(megaliths[0].passive).toEqual({ kind: "cheaperPerCard", per: "monument" });
  });

  it("costs full price with nothing standing", () => {
    expect(buildCostFor(holdingMegalith([]).players[0], megaliths[1])).toEqual({
      metal: 5,
      energy: 2,
      goods: 0,
    });
  });

  it("is discounted by Monuments already up, with no Megalith among them", () => {
    const state = holdingMegalith(beacons.slice(0, 3).map(standing));

    // The discount is read when the card is built, so the first Megalith is
    // as cheap as the three Beacons beside it make it.
    expect(buildCostFor(state.players[0], megaliths[1])).toEqual({
      metal: 2,
      energy: 2,
      goods: 0,
    });
  });

  it("takes a metal off for every Monument standing, itself included", () => {
    // One Megalith and two Beacons: three Monuments, so three metal off.
    const state = holdingMegalith([megaliths[0], beacons[0], beacons[1]].map(standing));

    expect(buildCostFor(state.players[0], megaliths[1])).toEqual({
      metal: 2,
      energy: 2,
      goods: 0,
    });

    const next = applyMove(state, {
      type: "build",
      cardId: megaliths[1].id,
      paymentCardId: state.players[0].hand[1].id,
    });
    expect(next.players[0].resources).toEqual({ metal: 7, energy: 7, goods: 0 });
    expect(logged(next, /built Megalith for Battery Factory and 2 metal, 2 energy/)).toBe(true);
  });

  it("never goes below nothing", () => {
    // Six Monuments would be six off a five-metal card.
    const compound = [megaliths[0], ...beacons].map(standing);
    const state = holdingMegalith([...compound, standing(megaliths[2])]);

    expect(buildCostFor(state.players[0], megaliths[1]).metal).toBe(0);
  });

  it("discounts only its own kind", () => {
    const state = holdingMegalith([megaliths[0], beacons[0]].map(standing));
    const battery = cardNamed(createBlueprintDeck(), "Battery Factory");

    // The Beacon is a Monument too, and gets no discount from any of it.
    expect(buildCostFor(state.players[0], beacons[2])).toEqual(beacons[2].buildCost);
    expect(buildCostFor(state.players[0], battery)).toEqual(battery.buildCost);
  });

  it("may be stacked, like the Beacon", () => {
    const state = holdingMegalith([standing(megaliths[0])]);
    const builds = legalMoves(state).filter((move) => move.type === "build");

    expect(builds.map((move) => move.cardId)).toContain(megaliths[1].id);
  });
});

describe("the Motherlode", () => {
  const lode = cardNamed(createBlueprintDeck(), "Motherlode");

  function withLode(dice: readonly DieFace[]): GameState {
    const state = createInitialState({ seed: 3 });
    const { color } = state.players[0];
    return patchPlayer({ ...state, phase: "work" }, 0, {
      compound: [{ card: lode, dice: [], worked: false }],
      dice: dice.map((face, i) => ({ id: `d${i}`, face, color, extra: false, spent: false })),
      rolled: true,
      resources: { metal: 0, energy: 0, goods: 0 },
    });
  }

  const metalFrom = (face: DieFace) =>
    applyMove(withLode([face]), { type: "activate", cardId: lode.id, dieIds: ["d0"] }).players[0]
      .resources.metal;

  it("is a Training shovel costing 1 metal and 3 energy, worth a prestige", () => {
    expect(lode.type).toBe("training");
    expect(lode.tool).toBe("shovel");
    expect(lode.buildCost).toEqual({ metal: 1, energy: 3, goods: 0 });
    expect(lode.prestige).toBe(1);
    // One die, read for its value — not a run of three.
    expect(lode.perk?.dice).toBe(1);
    expect(lode.perk?.accepts).toEqual({ kind: "any" });
  });

  it("pays 1 metal for a low die and 2 for a high one", () => {
    expect([1, 2, 3].map((face) => metalFrom(face as DieFace))).toEqual([1, 1, 1]);
    expect([4, 5, 6].map((face) => metalFrom(face as DieFace))).toEqual([2, 2, 2]);
  });

  it("takes any die at all — the bands cover the whole d6", () => {
    const state = withLode([1, 3, 4, 6]);
    const dice = legalMoves(state)
      .filter((move) => move.type === "activate")
      .map((move) => (move.type === "activate" ? move.dieIds[0] : undefined));

    expect(dice).toEqual(["d0", "d1", "d2", "d3"]);
  });
});

describe("the Nuclear Plant", () => {
  const plant = cardNamed(createBlueprintDeck(), "Nuclear Plant");

  function withPlant(dice: readonly DieFace[]): GameState {
    const state = createInitialState({ seed: 3 });
    const { color } = state.players[0];
    return patchPlayer({ ...state, phase: "work" }, 0, {
      compound: [{ card: plant, dice: [], worked: false }],
      dice: dice.map((face, i) => ({ id: `d${i}`, face, color, extra: false, spent: false })),
      rolled: true,
      resources: { metal: 0, energy: 0, goods: 0 },
    });
  }

  it("is a Production gear costing 2 metal and 2 energy, worth a prestige", () => {
    expect(plant.type).toBe("production");
    expect(plant.tool).toBe("gear");
    expect(plant.buildCost).toEqual({ metal: 2, energy: 2, goods: 0 });
    expect(plant.prestige).toBe(1);
  });

  it("takes a 6 for a good and an energy, and nothing else at all", () => {
    const next = applyMove(withPlant([6, 5, 1, 3]), {
      type: "activate",
      cardId: plant.id,
      dieIds: ["d0"],
    });
    expect(next.players[0].resources).toEqual({ metal: 0, energy: 1, goods: 1 });

    expect(
      legalMoves(withPlant([1, 2, 3, 5])).filter((move) => move.type === "activate"),
    ).toEqual([]);
    expect(() =>
      applyMove(withPlant([5, 1, 3, 4]), { type: "activate", cardId: plant.id, dieIds: ["d0"] }),
    ).toThrow(/A 5 does not work Nuclear Plant/);
  });
});

describe("the Obelisk", () => {
  const obelisks = copiesOf("Obelisk");

  it("is a hammer costing 3 metal and 1 energy, worth two prestige", () => {
    expect(obelisks).toHaveLength(5);
    expect(obelisks[0].tool).toBe("hammer");
    expect(obelisks[0].buildCost).toEqual({ metal: 3, energy: 1, goods: 0 });
    expect(obelisks[0].prestige).toBe(2);
    // Read as a Monument — the card gave no type. See cards.ts.
    expect(obelisks[0].type).toBe("monument");
  });

  it("is pure score: nothing to work, and no set bonus", () => {
    expect(obelisks[0].perk).toBeUndefined();
    expect(obelisks[0].passive).toBeUndefined();
    expect(obelisks[0].prestigeBonus).toBeUndefined();
    // Five of them are worth ten, and not a pip more.
    expect(prestigeOf(obelisks.map(standing))).toBe(10);
  });

  it("may be stacked, and counts as a Monument for the Megalith", () => {
    const megaliths = copiesOf("Megalith");
    const state = createInitialState({ seed: 3 });
    const staged = patchPlayer({ ...state, phase: "work" }, 0, {
      compound: obelisks.slice(0, 2).map(standing),
      hand: [obelisks[2], obelisks[3], megaliths[0], cardNamed(createBlueprintDeck(), "Golem")],
      resources: { metal: 9, energy: 9, goods: 0 },
      rolled: true,
    });

    const builds = legalMoves(staged).filter((move) => move.type === "build");
    expect(builds.map((move) => move.cardId)).toContain(obelisks[2].id);

    // Two Obelisks standing take two metal off a Megalith.
    expect(buildCostFor(staged.players[0], megaliths[0])).toEqual({
      metal: 3,
      energy: 2,
      goods: 0,
    });
  });
});

describe("the Power Plant", () => {
  const plant = cardNamed(createBlueprintDeck(), "Power Plant");

  function withPlant(face: DieFace): GameState {
    const state = createInitialState({ seed: 3 });
    const { color } = state.players[0];
    return patchPlayer({ ...state, phase: "work" }, 0, {
      compound: [{ card: plant, dice: [], worked: false }],
      dice: [{ id: "d0", face, color, extra: false, spent: false }],
      rolled: true,
      hand: [],
      resources: { metal: 0, energy: 0, goods: 0 },
    });
  }

  it("is a Utility gear costing 3 metal, worth a prestige", () => {
    expect(plant.type).toBe("utility");
    expect(plant.tool).toBe("gear");
    expect(plant.buildCost).toEqual({ metal: 3, energy: 0, goods: 0 });
    expect(plant.prestige).toBe(1);
    // Any die, and nothing on top of it.
    expect(plant.perk?.dice).toBe(1);
    expect(plant.perk?.accepts).toEqual({ kind: "any" });
    expect(plant.perk?.cost).toEqual({ metal: 0, energy: 0, goods: 0 });
    expect(plant.perk?.costByFace).toBeUndefined();
  });

  it("pays energy equal to the die placed, from a 1 to a 6", () => {
    for (const face of [1, 3, 6] as const) {
      const state = withPlant(face);
      const [move] = legalMoves(state).filter((m) => m.type === "activate");
      const next = applyMove(state, move);

      expect(next.players[0].resources).toEqual({ metal: 0, energy: face, goods: 0 });
    }
  });

  it("takes any die, so a poor roll is still worth something", () => {
    // The Foundry charges for its face and so can price itself out; this one
    // is free, so every face on the table is a move.
    const state = withPlant(1);
    expect(legalMoves(state).filter((m) => m.type === "activate")).toHaveLength(1);
  });
});

describe("the Recycling Plant", () => {
  const plant = cardNamed(createBlueprintDeck(), "Recycling Plant");
  const beacon = copiesOf("Beacon")[0];
  const golem = copiesOf("Golem")[0];
  const obelisk = copiesOf("Obelisk")[0];

  function withPlant(hand: readonly BlueprintCard[], energy = 2): GameState {
    const state = createInitialState({ seed: 3 });
    return patchPlayer({ ...state, phase: "work" }, 0, {
      compound: [{ card: plant, dice: [], worked: false }],
      rolled: true,
      hand: [...hand],
      resources: { metal: 0, energy, goods: 0 },
    });
  }

  const activations = (state: GameState) =>
    legalMoves(state).filter((move) => move.type === "activate");

  it("is a Production gear costing 2 metal, worth a prestige", () => {
    expect(plant.type).toBe("production");
    expect(plant.tool).toBe("gear");
    expect(plant.buildCost).toEqual({ metal: 2, energy: 0, goods: 0 });
    expect(plant.prestige).toBe(1);
    // No dice at all: two cards and two energy are the whole price.
    expect(plant.perk?.dice).toBe(0);
    expect(plant.perk?.discardsCards).toBe(2);
    expect(plant.perk?.cost).toEqual({ metal: 0, energy: 2, goods: 0 });
  });

  it("eats two blueprints and 2 energy for a good and a card", () => {
    const state = withPlant([beacon, golem]);
    const [move] = activations(state);

    const next = applyMove(state, move);

    expect(next.players[0].resources).toEqual({ metal: 0, energy: 0, goods: 1 });
    // Two out of hand and one back in, so the hand is one card down.
    expect(next.players[0].hand).toHaveLength(1);
    expect(next.players[0].hand.map((card) => card.id)).not.toContain(beacon.id);
    expect(next.players[0].hand.map((card) => card.id)).not.toContain(golem.id);
    expect(next.blueprints.discard).toContain(beacon);
    expect(next.blueprints.discard).toContain(golem);
    expect(logged(next, /worked Recycling Plant for Beacon, Golem and 2 energy/)).toBe(true);
  });

  it("offers one move per pair in hand, unordered", () => {
    // Three cards make three pairs, not six: which one was clicked first is
    // not a different move.
    expect(activations(withPlant([beacon, golem, obelisk]))).toHaveLength(3);
    expect(activations(withPlant([beacon, golem]))).toHaveLength(1);
    // One card is not a pair, and neither is none.
    expect(activations(withPlant([beacon]))).toEqual([]);
    expect(activations(withPlant([]))).toEqual([]);
    // Nor is a pair it cannot power.
    expect(activations(withPlant([beacon, golem], 1))).toEqual([]);
  });

  it("refuses a single card, a third, or the same card twice", () => {
    const state = withPlant([beacon, golem]);
    const feed = (...paymentCardIds: string[]): Move => ({
      type: "activate",
      cardId: plant.id,
      dieIds: [],
      paymentCardIds,
    });

    expect(() => applyMove(state, feed(beacon.id))).toThrow(/eats 2 blueprints, not 1/);
    expect(() => applyMove(state, feed(beacon.id, golem.id, obelisk.id))).toThrow(
      /eats 2 blueprints, not 3/,
    );
    expect(() => applyMove(state, feed(beacon.id, beacon.id))).toThrow(
      /cannot eat the same blueprint twice/,
    );
    // And a card that is not in hand at all.
    expect(() => applyMove(state, feed(beacon.id, obelisk.id))).toThrow(/does not hold/);
  });

  it("draws the replacement off the deck, not out of the discard it just filled", () => {
    // The two it ate are in the discard by the time the draw happens; the deck
    // is not empty, so neither should come back.
    const state = withPlant([beacon, golem]);
    const next = applyMove(state, activations(state)[0]);
    const drawn = next.players[0].hand[0];

    expect(drawn.id).not.toBe(beacon.id);
    expect(drawn.id).not.toBe(golem.id);
  });
});

describe("the Refinery", () => {
  const refinery = cardNamed(createBlueprintDeck(), "Refinery");
  const beacon = copiesOf("Beacon")[0];

  function withRefinery(hand: readonly BlueprintCard[], energy = 3): GameState {
    const state = createInitialState({ seed: 3 });
    return patchPlayer({ ...state, phase: "work" }, 0, {
      compound: [{ card: refinery, dice: [], worked: false }],
      rolled: true,
      hand: [...hand],
      resources: { metal: 0, energy, goods: 0 },
    });
  }

  it("is a Utility wrench costing 1 metal and 3 energy, worth a prestige", () => {
    expect(refinery.type).toBe("utility");
    expect(refinery.tool).toBe("wrench");
    expect(refinery.buildCost).toEqual({ metal: 1, energy: 3, goods: 0 });
    expect(refinery.prestige).toBe(1);
    expect(refinery.perk?.dice).toBe(0);
    expect(refinery.perk?.discardsCards).toBe(1);
    expect(refinery.perk?.cost).toEqual({ metal: 0, energy: 3, goods: 0 });
  });

  it("turns a card and 3 energy into 3 metal, whatever the card was", () => {
    const state = withRefinery([beacon]);
    const [move] = legalMoves(state).filter((m) => m.type === "activate");

    const next = applyMove(state, move);

    // A Beacon cost 2 metal and 4 energy; the rate is flat all the same.
    expect(next.players[0].resources).toEqual({ metal: 3, energy: 0, goods: 0 });
    expect(next.players[0].hand).toEqual([]);
    expect(next.blueprints.discard).toContain(beacon);
    expect(logged(next, /worked Refinery for Beacon and 3 energy/)).toBe(true);
  });

  it("is not offered without a card to burn or the energy to burn it", () => {
    const activations = (state: GameState) =>
      legalMoves(state).filter((move) => move.type === "activate");

    expect(activations(withRefinery([]))).toEqual([]);
    expect(activations(withRefinery([beacon], 2))).toEqual([]);
  });
});

describe("the Replicator", () => {
  const deck = createBlueprintDeck();
  const replicator = cardNamed(deck, "Replicator");
  const named = (name: string) => cardNamed(deck, name);

  /**
   * A Replicator standing, with exactly `row` face up in the market. The dice
   * and resources are whatever the copied card will need.
   */
  function withReplicator(
    row: readonly string[],
    faces: readonly DieFace[] = [],
    patch: Partial<Player> = {},
  ): GameState {
    const state = createInitialState({ seed: 3 });
    const { color } = state.players[0];
    const staged: GameState = {
      ...state,
      phase: "work",
      blueprints: { ...state.blueprints, row: row.map(named) },
    };
    return patchPlayer(staged, 0, {
      compound: [{ card: replicator, dice: [], worked: false }],
      dice: faces.map((face, i) => ({
        id: `d${i}`,
        face,
        color,
        extra: false,
        spent: false,
      })),
      rolled: true,
      hand: [],
      resources: { metal: 0, energy: 0, goods: 0 },
      ...patch,
    });
  }

  const activations = (state: GameState) =>
    legalMoves(state).filter((move) => move.type === "activate");

  it("is a Special shovel costing 2 metal and 2 energy, worth a prestige", () => {
    expect(replicator.type).toBe("special");
    expect(replicator.tool).toBe("shovel");
    expect(replicator.buildCost).toEqual({ metal: 2, energy: 2, goods: 0 });
    expect(replicator.prestige).toBe(1);
    // It asks for no dice of its own — whatever it copies does the asking.
    expect(replicator.perk?.dice).toBe(0);
    expect(replicator.perk?.cost).toEqual({ metal: 0, energy: 1, goods: 0 });
    expect(replicator.perk?.effect).toEqual({ kind: "borrowFromMarket" });
  });

  it("offers one activation per face-up blueprint that has a perk", () => {
    // The Beacon and the Laboratory have no perk to lend; the other two do.
    const state = withReplicator(
      ["Beacon", "Laboratory", "Nuclear Plant", "Power Plant"],
      [6],
      { resources: { metal: 0, energy: 1, goods: 0 } },
    );

    const copied = activations(state).map((move) =>
      move.type === "activate" ? move.borrowCardId : undefined,
    );

    expect(copied).toEqual([named("Nuclear Plant").id, named("Power Plant").id]);
  });

  it("charges its own energy on top of what the copied card asks", () => {
    const foundry = named("Foundry");
    const perk = perkFor(
      withReplicator(["Foundry"]),
      replicator,
      foundry.id,
    );

    // The Foundry's own perk is free but scales with the face; the
    // Replicator's 1 energy rides on top of it.
    expect(perk?.dice).toBe(foundry.perk?.dice);
    expect(perk?.accepts).toEqual(foundry.perk?.accepts);
    expect(perk?.effect).toEqual(foundry.perk?.effect);
    expect(perk?.cost).toEqual({ metal: 0, energy: 1, goods: 0 });
    expect(perk?.costByFace).toBe("energy");
  });

  it("works the copied perk, pays for both, and keeps the die on itself", () => {
    // A 5 on a borrowed Foundry: 5 energy for the Foundry, 1 for the
    // Replicator, and 5 metal back.
    const state = withReplicator(["Foundry"], [5], {
      resources: { metal: 0, energy: 6, goods: 0 },
    });
    const [move] = activations(state);

    const next = applyMove(state, move);

    expect(next.players[0].resources).toEqual({ metal: 5, energy: 0, goods: 0 });
    // The die is spent, and stands on the Replicator rather than the Foundry.
    expect(next.players[0].dice[0].spent).toBe(true);
    expect(next.players[0].compound[0].card.name).toBe("Replicator");
    expect(next.players[0].compound[0].dice).toEqual([5]);
    expect(next.players[0].compound[0].worked).toBe(true);
    expect(logged(next, /worked Replicator as Foundry with 5 for 6 energy/)).toBe(true);
  });

  it("leaves the copied card face up in the market — it is only borrowed", () => {
    const state = withReplicator(["Foundry"], [5], {
      resources: { metal: 0, energy: 6, goods: 0 },
    });

    const next = applyMove(state, activations(state)[0]);

    expect(next.blueprints).toEqual(state.blueprints);
    expect(next.players[0].compound).toHaveLength(1);
  });

  it("copies once a round, however many cards are face up", () => {
    const state = withReplicator(["Power Plant", "Nuclear Plant"], [6], {
      resources: { metal: 0, energy: 1, goods: 0 },
    });
    expect(activations(state)).toHaveLength(2);

    const next = applyMove(state, activations(state)[0]);
    expect(activations(next)).toEqual([]);
  });

  it("copies a perk that eats a card, and takes the card too", () => {
    const beacon = copiesOf("Beacon")[1];
    const state = withReplicator(["Incinerator"], [], {
      hand: [beacon],
      // 1 metal for the Incinerator, 1 energy for the Replicator.
      resources: { metal: 1, energy: 1, goods: 0 },
    });

    const next = applyMove(state, activations(state)[0]);

    expect(next.players[0].resources).toEqual({ metal: 0, energy: 6, goods: 0 });
    expect(next.players[0].hand).toEqual([]);
    expect(next.blueprints.discard).toContain(beacon);
  });

  it("copies a perk that turns a die over, and hands the die back", () => {
    const state = withReplicator(["Dojo"], [5], {
      // 1 energy for the Dojo, 1 for the Replicator.
      resources: { metal: 0, energy: 2, goods: 0 },
    });
    const [move] = activations(state);

    expect(move.type === "activate" && move.targetDieId).toBe("d0");

    const next = applyMove(state, move);
    // Turned over, not spent: it is back on the table showing a 2.
    expect(next.players[0].dice[0]).toMatchObject({ face: 2, spent: false });
    expect(next.players[0].resources.energy).toBe(0);
  });

  it("will not copy a card that is not face up, or has nothing to lend", () => {
    const state = withReplicator(["Beacon", "Power Plant"], [3], {
      resources: { metal: 0, energy: 1, goods: 0 },
    });
    const copy = (borrowCardId?: string): Move => ({
      type: "activate",
      cardId: replicator.id,
      dieIds: borrowCardId === named("Power Plant").id ? ["d0"] : [],
      borrowCardId,
    });

    expect(() => applyMove(state, copy(named("Beacon").id))).toThrow(/has no perk to copy/);
    expect(() => applyMove(state, copy(named("Foundry").id))).toThrow(/is not face up/);
    expect(() => applyMove(state, copy())).toThrow(/needs a blueprint to copy/);
  });

  it("will not copy another Replicator — that would only ask again", () => {
    const other = copiesOf("Replicator")[1];
    const state = withReplicator(["Power Plant"], [3], {
      resources: { metal: 0, energy: 1, goods: 0 },
    });
    const staged: GameState = {
      ...state,
      blueprints: { ...state.blueprints, row: [...state.blueprints.row, other] },
    };

    // Only the Power Plant is on offer, and naming the other one is refused.
    expect(activations(staged)).toHaveLength(1);
    expect(() =>
      applyMove(staged, {
        type: "activate",
        cardId: replicator.id,
        dieIds: [],
        borrowCardId: other.id,
      }),
    ).toThrow(/has no perk of its own to copy/);
  });

  /**
   * "Use that card as if it were in player compound" read as an equivalence:
   * whatever the card would do standing in the compound, it does copied — and
   * the only difference is the Replicator's own energy.
   *
   * Runs over every blueprint that has a perk to lend, so a card added later
   * that the Replicator cannot faithfully copy fails here rather than in play.
   */
  describe("copying is the same as owning, for 1 energy more", () => {
    const lendable = deck.filter(
      (card, index) =>
        card.perk &&
        card.perk.effect.kind !== "borrowFromMarket" &&
        deck.findIndex((other) => other.name === card.name) === index,
    );

    /** Faces enough to work anything printed: pairs, a triple, and a run. */
    const POOL: readonly DieFace[] = [1, 1, 2, 3, 4, 6, 6, 6];
    const purse: Resources = { metal: 20, energy: 20, goods: 0 };

    /** The same player twice over: once owning `card`, once copying it. */
    function stage(card: BlueprintCard, owning: boolean): GameState {
      const state = createInitialState({ seed: 3 });
      const { color } = state.players[0];
      const staged: GameState = {
        ...state,
        phase: "work",
        blueprints: { ...state.blueprints, row: [card] },
      };
      return patchPlayer(staged, 0, {
        compound: [{ card: owning ? card : replicator, dice: [], worked: false }],
        dice: POOL.map((face, i) => ({ id: `d${i}`, face, color, extra: false, spent: false })),
        rolled: true,
        // Two cards, so a perk that eats one or two has something to eat.
        hand: copiesOf("Beacon").slice(0, 2),
        resources: purse,
      });
    }

    /** What the move left behind, ignoring which card it was played on. */
    function outcome(state: GameState) {
      const player = state.players[0];
      return {
        resources: player.resources,
        hand: player.hand.map((card) => card.name),
        dice: player.dice.map((die) => `${die.face}${die.spent ? " spent" : ""}`),
      };
    }

    for (const card of lendable) {
      it(`copies the ${card.name}`, () => {
        const owned = stage(card, true);
        const copying = stage(card, false);

        const directly = activations(owned);
        const borrowed = activations(copying);

        // Move for move, the same offers — the copy only says where it came
        // from. Anything the Replicator could not reproduce shows up here.
        expect(
          borrowed.map((move) =>
            move.type === "activate" ? { ...move, cardId: "", borrowCardId: undefined } : move,
          ),
        ).toEqual(
          directly.map((move) => (move.type === "activate" ? { ...move, cardId: "" } : move)),
        );
        expect(borrowed.length).toBeGreaterThan(0);

        // And playing the first of them lands in the same place, bar the energy.
        const after = outcome(applyMove(owned, directly[0]));
        const copied = outcome(applyMove(copying, borrowed[0]));

        expect(copied).toEqual({
          ...after,
          resources: { ...after.resources, energy: after.resources.energy - 1 },
        });
      });
    }
  });

  it("copies a card already standing and already worked — it is a second use", () => {
    // The no-duplicates rule governs building, not copying: the market card is
    // never built, so a spent Power Plant in the compound does not stop the
    // Replicator working the one in the row.
    const plant = named("Power Plant");
    const state = withReplicator(["Power Plant"], [4], {
      resources: { metal: 0, energy: 1, goods: 0 },
    });
    const staged = patchPlayer(state, 0, {
      compound: [
        { card: plant, dice: [3], worked: true },
        { card: replicator, dice: [], worked: false },
      ],
    });

    const offered = activations(staged);
    expect(offered).toHaveLength(1);
    expect(offered[0].type === "activate" && offered[0].cardId).toBe(replicator.id);

    // 4 energy off the copied die, less the Replicator's 1.
    expect(applyMove(staged, offered[0]).players[0].resources.energy).toBe(4);
  });

  it("leaves every other perk alone — nothing else copies", () => {
    const battery = named("Battery Factory");
    const state = patchPlayer(withReplicator(["Foundry"]), 0, {
      compound: [{ card: battery, dice: [], worked: false }],
      resources: { metal: 0, energy: 4, goods: 0 },
    });

    expect(() =>
      applyMove(state, {
        type: "activate",
        cardId: battery.id,
        dieIds: [],
        borrowCardId: named("Foundry").id,
      }),
    ).toThrow(/does not copy a blueprint/);
  });
});

describe("the Robot", () => {
  const robot = cardNamed(createBlueprintDeck(), "Robot");

  function withRobot(metal = 1): GameState {
    const state = createInitialState({ seed: 3 });
    const { color } = state.players[0];
    return patchPlayer({ ...state, phase: "work" }, 0, {
      compound: [{ card: robot, dice: [], worked: false }],
      dice: [{ id: "d0", face: 2, color, extra: false, spent: false }],
      rolled: true,
      hand: [],
      resources: { metal, energy: 0, goods: 0 },
    });
  }

  const activations = (state: GameState) =>
    legalMoves(state).filter((move) => move.type === "activate");

  it("is a Special hammer costing 1 metal and 1 energy, and scores nothing", () => {
    expect(robot.type).toBe("special");
    expect(robot.tool).toBe("hammer");
    expect(robot.buildCost).toEqual({ metal: 1, energy: 1, goods: 0 });
    expect(robot.prestige).toBeUndefined();
    // No dice of its own, and no face to name — 1 metal is the whole price.
    expect(robot.perk?.dice).toBe(0);
    expect(robot.perk?.cost).toEqual({ metal: 1, energy: 0, goods: 0 });
    expect(robot.perk?.costByFace).toBeUndefined();
    expect(robot.perk?.effect).toEqual({ kind: "rollDie" });
  });

  it("spends a metal for a white die at whatever it rolls", () => {
    const state = withRobot();
    const next = applyMove(state, activations(state)[0]);
    const gained = next.players[0].dice.at(-1)!;

    expect(next.players[0].resources).toEqual({ metal: 0, energy: 0, goods: 0 });
    expect(next.players[0].dice).toHaveLength(2);
    expect(gained.color).toBe(EXTRA_DIE_COLOR);
    expect(gained.extra).toBe(true);
    expect(gained.spent).toBe(false);
    expect(DIE_FACES).toContain(gained.face);
    expect(logged(next, /rolled an extra white die: \d/)).toBe(true);
  });

  it("names no face, unlike the Golem — the die decides", () => {
    // The Golem is one move per face it could buy; this is one move, full stop.
    const offered = activations(withRobot());
    expect(offered).toHaveLength(1);
    expect(offered[0].type === "activate" && offered[0].face).toBeUndefined();
  });

  it("rolls from the game's own rng, so a seed still replays", () => {
    const state = withRobot();
    const once = applyMove(state, activations(state)[0]);
    const twice = applyMove(state, activations(state)[0]);

    expect(once.players[0].dice.at(-1)?.face).toBe(twice.players[0].dice.at(-1)?.face);
    // And the rng moved on, so a second roll is its own.
    expect(once.rng).not.toEqual(state.rng);
  });

  it("is not offered without the metal, or twice in a round", () => {
    expect(activations(withRobot(0))).toEqual([]);

    const state = withRobot(2);
    const next = applyMove(state, activations(state)[0]);
    expect(activations(next)).toEqual([]);
  });

  it("hands the die back at cleanup, like any other extra", () => {
    const state = withRobot();
    const worked = applyMove(state, activations(state)[0]);
    const cleaned = applyMove({ ...worked, phase: "cleanup" }, { type: "endPhase" });

    expect(cleaned.players[0].dice).toEqual([]);
  });
});

describe("the Scrap Yard and the Solar Array", () => {
  const deck = createBlueprintDeck();
  const scrapYard = cardNamed(deck, "Scrap Yard");
  const solarArray = cardNamed(deck, "Solar Array");

  /** A player able to build `hand`, with `standing` already up. */
  function ready(standing: readonly BlueprintCard[], hand: readonly BlueprintCard[]): GameState {
    const state = createInitialState({ seed: 3 });
    return patchPlayer({ ...state, phase: "work" }, 0, {
      compound: standing.map((card) => ({ card, dice: [], worked: false })),
      rolled: true,
      hand: [...hand],
      resources: { metal: 12, energy: 12, goods: 0 },
    });
  }

  /**
   * Builds `card` for `payment`. Named rather than found, so one build does
   * not eat the card the next one meant to stand up.
   */
  function build(state: GameState, card: BlueprintCard, payment: BlueprintCard): GameState {
    return applyMove(state, { type: "build", cardId: card.id, paymentCardId: payment.id });
  }

  it("are Special, score nothing, and have no perk to work", () => {
    for (const card of [scrapYard, solarArray]) {
      expect(card.type).toBe("special");
      expect(card.buildCost).toEqual({ metal: 1, energy: 2, goods: 0 });
      expect(card.prestige).toBeUndefined();
      // Nothing is placed on them and nothing paid.
      expect(card.perk).toBeUndefined();
    }
    expect(scrapYard.tool).toBe("wrench");
    expect(solarArray.tool).toBe("gear");
    expect(scrapYard.passive).toEqual({ kind: "gainOnBuild", resources: { metal: 1 } });
    expect(solarArray.passive).toEqual({ kind: "gainOnBuild", resources: { energy: 2 } });
  });

  it("does not set itself off when it is the card being built", () => {
    // Two wrenches in hand, so the Scrap Yard has something to pay with.
    const payment = cardNamed(deck, "Manufactory");
    const state = ready([], [scrapYard, payment]);

    const next = build(state, scrapYard, payment);

    // 1 metal and 2 energy out, and nothing back.
    expect(next.players[0].resources).toEqual({ metal: 11, energy: 10, goods: 0 });
    expect(logged(next, /from Scrap Yard/)).toBe(false);
  });

  it("pays for the next card built, and for every one after it", () => {
    const biolab = cardNamed(deck, "Biolab");
    const foundry = cardNamed(deck, "Foundry");
    const line = cardNamed(deck, "Assembly Line");
    const mega = cardNamed(deck, "Mega Factory");
    const state = ready([scrapYard], [biolab, foundry, line, mega]);

    // The Biolab costs 1 metal and 3 energy; the Scrap Yard hands one back.
    const first = build(state, biolab, line);
    expect(first.players[0].resources).toEqual({ metal: 12, energy: 9, goods: 0 });
    expect(logged(first, /gained 1 metal from Scrap Yard/)).toBe(true);

    // And again — it is not held to once a round the way the Laboratory is.
    const second = build(first, foundry, mega);
    expect(second.players[0].resources.metal).toBe(11);
    expect(second.players[0].compound.find((b) => b.card.id === scrapYard.id)?.worked).toBe(false);
  });

  it("stack, and neither pays for the other's arrival more than once", () => {
    const biolab = cardNamed(deck, "Biolab");
    const mega = cardNamed(deck, "Mega Factory");
    const nuclear = cardNamed(deck, "Nuclear Plant");
    const state = ready([scrapYard], [solarArray, biolab, mega, nuclear]);

    // Standing the Solar Array up: the Scrap Yard pays, the Array does not.
    const up = build(state, solarArray, mega);
    expect(up.players[0].resources).toEqual({ metal: 12, energy: 10, goods: 0 });

    // Now both pay for the Biolab: 1 metal and 3 energy out, 1 metal and 2 back.
    const next = build(up, biolab, nuclear);
    expect(next.players[0].resources).toEqual({ metal: 12, energy: 9, goods: 0 });
    expect(logged(next, /gained 1 metal from Scrap Yard/)).toBe(true);
    expect(logged(next, /gained 2 energy from Solar Array/)).toBe(true);
  });

  it("pays for a card the Engineer builds off the deck", () => {
    // The Engineer's card is free of dice and resources, but still a build.
    const engineer = cardNamed(createContractorDeck(), "Engineer");
    const payment = cardNamed(deck, "Biolab");
    const state = stageContractor(
      { ...ready([solarArray], [payment]), phase: "market" },
      engineer,
    );
    const before = state.players[0].resources.energy;

    const next = takeStaged(state);

    // 4 energy for the Engineer, 2 of them back from the Solar Array.
    expect(next.players[0].resources.energy).toBe(before - 4 + 2);
    expect(logged(next, /gained 2 energy from Solar Array/)).toBe(true);
  });

  it("is not collected by the automaton, which holds no metal at all", () => {
    // It is dealt its compound face up rather than building, so this never
    // arises in play — but a card it cannot spend is one it should not gain.
    const state = createInitialState({ seed: 3 });
    const automaton = state.players[1];

    expect(automaton.isAi).toBe(true);
    expect(automaton.resources).toEqual({ metal: 0, energy: 0, goods: 0 });
    expect(legalMoves(state).every((move) => move.type !== "build")).toBe(true);
  });
});

describe("the end-of-phase limits", () => {
  /** A rolled player in their Work Phase, holding whatever is passed in. */
  function holding(patch: Partial<Player>): GameState {
    const state = createInitialState({ seed: 3 });
    return patchPlayer({ ...state, phase: "work" }, 0, { rolled: true, hand: [], ...patch });
  }

  function discards(state: GameState) {
    return legalMoves(state).filter((move) => move.type === "discard");
  }

  function canEnd(state: GameState) {
    return legalMoves(state).some((move) => move.type === "endPhase");
  }

  /** `count` distinct blueprints, so a hand can be made any size. */
  function handOf(count: number): BlueprintCard[] {
    const deck = createBlueprintDeck();
    return deck.slice(0, count);
  }

  it("counts metal and energy together, and ignores goods", () => {
    expect(RESOURCE_LIMIT).toBe(12);
    expect(stockOf({ metal: 7, energy: 5, goods: 40 })).toBe(12);

    // Forty goods and twelve stock is inside the limit.
    const fine = holding({ resources: { metal: 7, energy: 5, goods: 40 } });
    expect(discards(fine)).toEqual([]);
    expect(canEnd(fine)).toBe(true);
  });

  it("will not end the Work Phase over the resource limit", () => {
    const over = holding({ resources: { metal: 8, energy: 6, goods: 0 } });

    expect(overLimits(over.players[0]).resources).toBe(2);
    expect(canEnd(over)).toBe(false);
    expect(() => applyMove(over, { type: "endPhase" })).toThrow(
      /must come down to 12 metal and energy/,
    );
  });

  it("offers each resource it could take, one at a time", () => {
    const over = holding({ resources: { metal: 8, energy: 6, goods: 0 } });

    expect(discards(over)).toEqual([
      { type: "discard", kind: "resource", resource: "metal" },
      { type: "discard", kind: "resource", resource: "energy" },
    ]);

    // Two off, and the phase can end — the player chose which two.
    const once = applyMove(over, { type: "discard", kind: "resource", resource: "energy" });
    expect(once.players[0].resources).toEqual({ metal: 8, energy: 5, goods: 0 });
    expect(canEnd(once)).toBe(false);

    const twice = applyMove(once, { type: "discard", kind: "resource", resource: "metal" });
    expect(twice.players[0].resources).toEqual({ metal: 7, energy: 5, goods: 0 });
    expect(canEnd(twice)).toBe(true);
    expect(logged(twice, /discarded 1 energy/)).toBe(true);
  });

  it("offers only a resource it actually holds", () => {
    // Thirteen metal and no energy: energy is not on the table to give up.
    const over = holding({ resources: { metal: 13, energy: 0, goods: 0 } });

    expect(discards(over)).toEqual([
      { type: "discard", kind: "resource", resource: "metal" },
    ]);
    expect(() =>
      applyMove(over, { type: "discard", kind: "resource", resource: "energy" }),
    ).toThrow(/has no energy to discard/);
  });

  it("will not end the Work Phase over the hand limit", () => {
    const over = holding({ hand: handOf(HAND_LIMIT + 1) });

    expect(HAND_LIMIT).toBe(10);
    expect(overLimits(over.players[0]).cards).toBe(1);
    expect(canEnd(over)).toBe(false);
    expect(() => applyMove(over, { type: "endPhase" })).toThrow(
      /must come down to 10 cards in hand/,
    );
  });

  it("offers every card in hand, and puts the one chosen in the discard", () => {
    const hand = handOf(HAND_LIMIT + 1);
    const over = holding({ hand });
    expect(discards(over)).toHaveLength(hand.length);

    const next = applyMove(over, { type: "discard", kind: "card", cardId: hand[3].id });

    expect(next.players[0].hand).toHaveLength(HAND_LIMIT);
    expect(next.players[0].hand.map((c) => c.id)).not.toContain(hand[3].id);
    expect(next.blueprints.discard.map((c) => c.id)).toContain(hand[3].id);
    expect(canEnd(next)).toBe(true);
  });

  it("refuses a discard from a player who is inside the limits", () => {
    const fine = holding({ resources: { metal: 1, energy: 1, goods: 0 }, hand: handOf(2) });

    expect(discards(fine)).toEqual([]);
    expect(() =>
      applyMove(fine, { type: "discard", kind: "resource", resource: "metal" }),
    ).toThrow(/inside the 12 resource limit/);
    expect(() =>
      applyMove(fine, { type: "discard", kind: "card", cardId: fine.players[0].hand[0].id }),
    ).toThrow(/inside the 10 card hand limit/);
  });

  it("leaves every other move on — spending is a way down too", () => {
    const factory = cardNamed(createBlueprintDeck(), "Aluminum Factory");
    const [, payment] = copiesOf("Aluminum Factory");
    const state = createInitialState({ seed: 3 });
    const { color } = state.players[0];
    const over = holding({
      hand: [factory, payment],
      resources: { metal: 8, energy: 6, goods: 0 },
      dice: [{ id: "d0", face: 5, color, extra: false, spent: false }],
    });

    const moves = legalMoves(over);
    // Building costs 2 metal and 2 energy, which is four of the two it is
    // over by — so the way down need not be waste.
    expect(moves.some((move) => move.type === "build")).toBe(true);
    expect(moves.some((move) => move.type === "placeDie")).toBe(true);
  });

  it("only bites at the end of the Work Phase, never the Market Phase", () => {
    const state = createInitialState({ seed: 3 });
    const rich = patchPlayer(state, 0, { resources: { metal: 20, energy: 20, goods: 0 } });

    // The Market Phase ends by taking a card, and no limit stands in the way.
    expect(legalMoves(rich).every((move) => move.type !== "discard")).toBe(true);
    expect(draftAnyBlueprint(rich).phase).toBe("work");
  });

  it("never catches the automaton, which holds neither", () => {
    const state = createInitialState({ seed: 3 });
    const automaton = state.players[1];

    expect(automaton.hand).toEqual([]);
    expect(stockOf(automaton.resources)).toBe(0);
    expect(overLimits(automaton)).toEqual({ resources: 0, cards: 0 });
  });
});

describe("the automaton", () => {
  const factory = cardNamed(createBlueprintDeck(), "Aluminum Factory"); // production
  const market = cardNamed(createBlueprintDeck(), "Black Market"); // utility
  const beacons = copiesOf("Beacon"); // monument — no die answers for it

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
    // Hunted for rather than pinned to a seed: which tools a hand holds
    // depends on the deck, and the deck keeps changing under this test.
    const unpayableSlots = (state: GameState) => {
      const tools = new Set(blueprintsIn(state.players[0].hand).map((card) => card.tool));
      return state.contractors.slots.filter((slot) => slot.card && !tools.has(slot.token));
    };
    let state = createInitialState({ seed: 3 });
    for (let seed = 3; seed < 60 && unpayableSlots(state).length === 0; seed++) {
      state = createInitialState({ seed });
    }
    const unpayable = unpayableSlots(state);
    // The scenario only means something if such a slot exists.
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
    // The Concrete Plant is a shovel costing 2 metal and 2 energy.
    const [card, payment] = copiesOf("Concrete Plant");
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
    expect(player.resources).toEqual({ metal: 1, energy: 1, goods: 0 });
    // Both cards leave hand: one is built, the other is discarded as payment.
    expect(player.hand).toEqual([]);
    expect(next.blueprints.discard.map((c) => c.id)).toContain(payment.id);
    // No die was spent — building takes none.
    expect(player.dice).toEqual([]);
  });

  it("will not build without a matching tool to discard", () => {
    const state = createInitialState({ seed: 3 });
    const plant = copiesOf("Concrete Plant")[0];
    const trainer = copiesOf("Fitness Center")[0];
    const staged: GameState = patchPlayer({ ...state, phase: "work" }, 0, {
      hand: [plant, trainer],
      resources: { metal: 5, energy: 5, goods: 0 },
      rolled: true,
    });

    // A shovel and a wrench cannot pay for each other.
    expect(legalMoves(staged).filter((move) => move.type === "build")).toEqual([]);
    expect(() =>
      applyMove(staged, { type: "build", cardId: plant.id, paymentCardId: trainer.id }),
    ).toThrow(/costs a shovel blueprint, but Fitness Center is wrench/);
    expect(() =>
      applyMove(staged, { type: "build", cardId: plant.id, paymentCardId: plant.id }),
    ).toThrow(/cannot pay for itself/);
  });

  it("refuses a second copy of a blueprint already in the compound", () => {
    const state = createInitialState({ seed: 3 });
    const [built, spare, alsoSpare] = copiesOf("Fitness Center");
    const [plant, otherPlant] = copiesOf("Concrete Plant");
    const staged: GameState = patchPlayer({ ...state, phase: "work" }, 0, {
      hand: [spare, alsoSpare, plant, otherPlant],
      compound: [{ card: built, dice: [], worked: false }],
      resources: { metal: 5, energy: 5, goods: 0 },
      rolled: true,
    });

    const builds = legalMoves(staged).filter((move) => move.type === "build");

    // Two wrenches in hand could pay for a Fitness Center, but one is up.
    expect(new Set(builds.map((move) => move.cardId))).toEqual(new Set([plant.id, otherPlant.id]));
    expect(() =>
      applyMove(staged, { type: "build", cardId: spare.id, paymentCardId: alsoSpare.id }),
    ).toThrow(/already built Fitness Center/);
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
    // And it was worth something: goods produced, or prestige standing.
    expect(scoreOf(player)).toBeGreaterThan(0);
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
