import { describe, expect, it } from "vitest";
import type { Die, DieFace, Move } from "@/engine";
import { indexMoves } from "./board";

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

    expect(board.dice.get("d0")?.activations.get("factory")).toBe(move);
    expect(board.dice.get("d1")?.activations.get("factory")).toBe(move);
    // The 5 and the 1 cannot work it, so they must not light it up.
    expect(board.dice.get("d2")).toBeUndefined();
    expect(board.dice.get("d3")).toBeUndefined();
  });

  it("points it at a third matching die the move itself left out", () => {
    // Enumeration keeps one move per face, so a third 3 is in no move at all.
    // Dragging it must still work: any 3 is as good as any other here.
    const move: Move = { type: "activate", cardId: "factory", dieIds: ["d0", "d1"] };

    const board = indexMoves([move], dice([3, 3, 3, 1]));

    expect(board.dice.get("d2")?.activations.get("factory")).toBe(move);
    expect(board.dice.get("d3")).toBeUndefined();
  });

  it("keeps a spent die out of it", () => {
    const move: Move = { type: "activate", cardId: "factory", dieIds: ["d0", "d1"] };
    const rolled = dice([3, 3, 3]);
    const withSpent = rolled.map((die) => (die.id === "d2" ? { ...die, spent: true } : die));

    const board = indexMoves([move], withSpent);

    expect(board.dice.get("d2")).toBeUndefined();
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
