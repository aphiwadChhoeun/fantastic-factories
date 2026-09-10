import { describe, expect, it } from "vitest";
import type { Die, DieFace, Move } from "@/engine";
import {
  borrowOf,
  borrowsFor,
  indexMoves,
  needsBorrow,
  paymentsFor,
  paymentsOf,
} from "./board";

function dice(faces: readonly DieFace[]): Die[] {
  return faces.map((face, i) => ({
    id: `d${i}`,
    face,
    color: "blue" as const,
    extra: false,
    spent: false,
  }));
}

describe("indexMoves", () => {
  it("points a two-dice perk at both of its dice", () => {
    const move: Move = { type: "activate", cardId: "factory", dieIds: ["d0", "d1"] };

    const board = indexMoves([move], dice([3, 3, 5, 1]));

    expect(board.dice.get("d0")?.activations.get("factory")).toEqual([move]);
    expect(board.dice.get("d1")?.activations.get("factory")).toEqual([move]);
    // The 5 and the 1 cannot work it, so they must not light it up.
    expect(board.dice.get("d2")).toBeUndefined();
    expect(board.dice.get("d3")).toBeUndefined();
  });

  it("points it at a third matching die the move itself left out", () => {
    // Enumeration keeps one move per face, so a third 3 is in no move at all.
    // Dragging it must still work: any 3 is as good as any other here.
    const move: Move = { type: "activate", cardId: "factory", dieIds: ["d0", "d1"] };

    const board = indexMoves([move], dice([3, 3, 3, 1]));

    expect(board.dice.get("d2")?.activations.get("factory")).toEqual([move]);
    expect(board.dice.get("d3")).toBeUndefined();
  });

  it("keeps a spent die out of it", () => {
    const move: Move = { type: "activate", cardId: "factory", dieIds: ["d0", "d1"] };
    const rolled = dice([3, 3, 3]);
    const withSpent = rolled.map((die) => (die.id === "d2" ? { ...die, spent: true } : die));

    const board = indexMoves([move], withSpent);

    expect(board.dice.get("d2")).toBeUndefined();
  });

  it("keeps every activation one die offers, not just the last", () => {
    // The Black Market takes one die and any blueprint in hand, so a single
    // die stands for several moves. Losing all but one would hide the choice.
    const moves: Move[] = [
      { type: "activate", cardId: "market", dieIds: ["d0"], paymentCardIds: ["a"] },
      { type: "activate", cardId: "market", dieIds: ["d0"], paymentCardIds: ["b"] },
    ];

    const board = indexMoves(moves, dice([5]));

    expect(board.dice.get("d0")?.activations.get("market")).toEqual(moves);
  });

  it("gathers the blueprints that could pay, whatever spends them", () => {
    const moves: Move[] = [
      { type: "build", cardId: "mine", paymentCardId: "a" },
      { type: "activate", cardId: "market", dieIds: ["d0"], paymentCardIds: ["a"] },
      { type: "activate", cardId: "market", dieIds: ["d0"], paymentCardIds: ["b"] },
      { type: "placeDie", section: "mine", dieId: "d0" },
    ];

    const payments = paymentsFor(moves);

    // Two ways to spend "a" — one perk still has to be told which resources
    // to take for it, so a payment cannot be one move.
    expect(payments.get("a")).toHaveLength(2);
    expect(payments.get("b")).toHaveLength(1);
    expect(payments.has("d0")).toBe(false);
  });

  it("indexes a perk that eats two under both cards, then under the second", () => {
    // The Recycling Plant swallows a pair, so a move is filed under each card
    // it would spend — the player names them one at a time.
    const moves: Move[] = [
      { type: "activate", cardId: "recycler", dieIds: [], paymentCardIds: ["a", "b"] },
      { type: "activate", cardId: "recycler", dieIds: [], paymentCardIds: ["a", "c"] },
      { type: "activate", cardId: "recycler", dieIds: [], paymentCardIds: ["b", "c"] },
    ];

    expect([...paymentsFor(moves).keys()]).toEqual(["a", "b", "c"]);
    // Once "a" is picked, it drops out and only its partners are still asked.
    const after = paymentsFor(
      moves.filter((move) => paymentsOf(move).includes("a")),
      ["a"],
    );
    expect([...after.keys()]).toEqual(["b", "c"]);
  });

  it("files a copy under the card that copies, dice or no dice", () => {
    // The Replicator is clicked first whatever it copies: the row has to be
    // asked before the dice mean anything. A copy that wants dice is still a
    // drop target under each of them.
    const free: Move = {
      type: "activate",
      cardId: "replicator",
      dieIds: [],
      borrowCardId: "incinerator",
    };
    const withDice: Move = {
      type: "activate",
      cardId: "replicator",
      dieIds: ["d0"],
      borrowCardId: "foundry",
    };

    const board = indexMoves([free, withDice], dice([5]));

    expect(board.copies.get("replicator")).toEqual([free, withDice]);
    // Never in both, or clicking the card would offer the same move twice.
    expect(board.freeActivations.has("replicator")).toBe(false);
    expect(board.dice.get("d0")?.activations.get("replicator")).toEqual([withDice]);
  });

  it("gathers the face-up blueprints a copy could work", () => {
    const moves: Move[] = [
      { type: "activate", cardId: "replicator", dieIds: [], borrowCardId: "a" },
      { type: "activate", cardId: "replicator", dieIds: [], borrowCardId: "b" },
      { type: "activate", cardId: "replicator", dieIds: [], borrowCardId: "b", option: 1 },
      { type: "activate", cardId: "factory", dieIds: ["d0"] },
    ];

    const borrows = borrowsFor(moves);

    expect([...borrows.keys()]).toEqual(["a", "b"]);
    // Two ways to work "b" — it still has to be told which payout to take.
    expect(borrows.get("b")).toHaveLength(2);
    expect(borrowOf(moves[3])).toBeUndefined();
  });

  it("asks the row for a copy even when one card is the only answer", () => {
    // The board settles a lone option without asking, everywhere but here: a
    // Replicator that fired off a single click would leave the player with no
    // idea which card had just been worked.
    const lone: Move[] = [
      { type: "activate", cardId: "replicator", dieIds: [], borrowCardId: "incinerator" },
    ];

    expect(needsBorrow(lone)).toBe(true);
    expect([...borrowsFor(lone).keys()]).toEqual(["incinerator"]);
    // Nothing else asks it.
    expect(needsBorrow([{ type: "activate", cardId: "factory", dieIds: ["d0"] }])).toBe(false);
    expect(needsBorrow([])).toBe(false);
  });

  it("points a perk that turns a die over at the die it names", () => {
    // The Dojo spends no dice, but the one it acts on is what gets dropped on
    // it — so it is a drag target, not a click-only card.
    const move: Move = { type: "activate", cardId: "dojo", dieIds: [], targetDieIds: ["d1"] };

    const board = indexMoves([move], dice([3, 5, 2]));

    expect(board.dice.get("d1")?.activations.get("dojo")).toEqual([move]);
    expect(board.freeActivations.has("dojo")).toBe(false);
    expect(board.dice.get("d0")).toBeUndefined();
  });

  it("groups takes and builds by the card they act on", () => {
    const moves: Move[] = [
      { type: "draft", kind: "contractor", cardId: "hired", paymentCardId: "a" },
      { type: "draft", kind: "contractor", cardId: "hired", paymentCardId: "b" },
      { type: "build", cardId: "mine", paymentCardId: "a" },
    ];

    const board = indexMoves(moves, []);

    expect(board.takes.get("hired")).toHaveLength(2);
    expect(board.builds.get("mine")).toHaveLength(1);
  });
});
