import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyMove, createInitialState, legalMoves } from "@/engine";
import { clearGame, loadGame, SAVE_VERSION, saveGame } from "./storage";

const KEY = "fantastic-factories.game";

/** Just enough of `localStorage` to be one, plus a way to break it. */
function fakeStorage() {
  const entries = new Map<string, string>();
  let refuse = false;

  return {
    entries,
    break: () => {
      refuse = true;
    },
    api: {
      getItem: (key: string) => {
        if (refuse) throw new Error("denied");
        return entries.get(key) ?? null;
      },
      setItem: (key: string, value: string) => {
        if (refuse) throw new Error("quota exceeded");
        entries.set(key, value);
      },
      removeItem: (key: string) => {
        if (refuse) throw new Error("denied");
        entries.delete(key);
      },
    },
  };
}

let storage: ReturnType<typeof fakeStorage>;

beforeEach(() => {
  storage = fakeStorage();
  vi.stubGlobal("window", { localStorage: storage.api });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("saving the game", () => {
  it("brings back the same game, down to the deck and the rng", () => {
    const state = createInitialState({ seed: 7 });

    saveGame({ seed: 7, state });
    const restored = loadGame();

    expect(restored?.seed).toBe(7);
    // Deep equality, not a spot check: anything JSON drops would show here.
    expect(restored?.state).toEqual(state);
  });

  it("restores a game part-played, not just a fresh deal", () => {
    // Several moves in, so hands, dice, the rng and the log have all moved on.
    let state = createInitialState({ seed: 4 });
    for (let i = 0; i < 12; i++) {
      const [move] = legalMoves(state);
      if (!move) break;
      state = applyMove(state, move);
    }

    saveGame({ seed: 4, state });
    const restored = loadGame()!.state;

    expect(restored).toEqual(state);
    // And it plays on: the same moves are legal, and the next one lands alike.
    expect(legalMoves(restored)).toEqual(legalMoves(state));
    expect(applyMove(restored, legalMoves(restored)[0])).toEqual(
      applyMove(state, legalMoves(state)[0]),
    );
  });

  it("has nothing to give when nothing was saved", () => {
    expect(loadGame()).toBeNull();
  });

  it("forgets a game on request", () => {
    saveGame({ seed: 1, state: createInitialState({ seed: 1 }) });
    clearGame();

    expect(loadGame()).toBeNull();
    expect(storage.entries.has(KEY)).toBe(false);
  });

  it("drops a save from an older version rather than half-reading it", () => {
    const state = createInitialState({ seed: 1 });
    storage.entries.set(KEY, JSON.stringify({ version: SAVE_VERSION - 1, seed: 1, state }));

    expect(loadGame()).toBeNull();
    // And clears it, so the next load is not the same disappointment.
    expect(storage.entries.has(KEY)).toBe(false);
  });

  it("drops anything under the key that is not a game", () => {
    for (const junk of ["not json at all", "null", "42", '{"version":1,"seed":1}', '{"a":1}']) {
      storage.entries.set(KEY, junk);
      expect(loadGame()).toBeNull();
    }
  });

  it("drops a game with no players — half a write is not a save", () => {
    const state = createInitialState({ seed: 1 });
    storage.entries.set(
      KEY,
      JSON.stringify({ version: SAVE_VERSION, seed: 1, state: { ...state, players: [] } }),
    );

    expect(loadGame()).toBeNull();
  });

  it("plays on when storage refuses — a game that cannot be saved is still a game", () => {
    storage.break();

    expect(() => saveGame({ seed: 1, state: createInitialState({ seed: 1 }) })).not.toThrow();
    expect(() => clearGame()).not.toThrow();
    expect(loadGame()).toBeNull();
  });

  it("does nothing at all where there is no window, as at build time", () => {
    vi.stubGlobal("window", undefined);

    expect(loadGame()).toBeNull();
    expect(() => saveGame({ seed: 1, state: createInitialState({ seed: 1 }) })).not.toThrow();
  });
});
