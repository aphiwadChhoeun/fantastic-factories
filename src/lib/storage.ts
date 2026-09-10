/**
 * The game in progress, kept in `localStorage` so a refresh does not throw it
 * away.
 *
 * `GameState` is plain data all the way down — cards, numbers, arrays, and an
 * rng that is a single number — so JSON round-trips it exactly. Optional
 * fields drop out of the JSON when they are undefined and come back absent,
 * which every reader in the engine already treats the same way.
 *
 * Nothing here knows the rules. A save is opaque beyond a look at its shape.
 */

import type { GameState } from "@/engine";

/** A game and the seed it was dealt from — both, or restoring is half a game. */
export type SavedGame = {
  readonly seed: number;
  readonly state: GameState;
};

const KEY = "fantastic-factories.game";

/**
 * Bump this whenever the shape of `GameState` changes in a way an older save
 * would not survive — a new required field, a renamed one, a moved one. A save
 * that does not match is dropped rather than half-read, which is the
 * difference between losing a game and playing a broken one.
 *
 * 2: `finalRound`, which a version 1 save has no answer for.
 */
export const SAVE_VERSION = 2;

type Envelope = {
  readonly version: number;
  readonly seed: number;
  readonly state: GameState;
};

/**
 * `localStorage` is not always there to be had: it is absent while the page is
 * prerendered at build time, and reaching for it throws outright in some
 * private-browsing modes rather than merely coming back empty.
 */
function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function saveGame(game: SavedGame): void {
  const store = storage();
  if (!store) return;

  const envelope: Envelope = { version: SAVE_VERSION, seed: game.seed, state: game.state };
  try {
    store.setItem(KEY, JSON.stringify(envelope));
  } catch {
    // Out of quota, or a window that allows reads and refuses writes. A game
    // that cannot be saved is still a game worth playing, so this is silent.
  }
}

/** The saved game, or null when there is none, it is stale, or it is not one. */
export function loadGame(): SavedGame | null {
  const store = storage();
  if (!store) return null;

  let raw: string | null;
  try {
    raw = store.getItem(KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    clearGame();
    return null;
  }

  if (!isEnvelope(parsed) || parsed.version !== SAVE_VERSION) {
    clearGame();
    return null;
  }
  return { seed: parsed.seed, state: parsed.state };
}

export function clearGame(): void {
  try {
    storage()?.removeItem(KEY);
  } catch {
    // Nothing to be done, and nothing worth saying.
  }
}

function isEnvelope(value: unknown): value is Envelope {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.version === "number" &&
    typeof candidate.seed === "number" &&
    looksLikeGame(candidate.state)
  );
}

/**
 * Enough of a look to be sure this is a game and not something else living
 * under the same key — another tab's experiment, a hand-edited value, half a
 * write. Not a full validation: `SAVE_VERSION` is what guards against a save
 * written by an older shape of the code.
 */
function looksLikeGame(value: unknown): value is GameState {
  if (typeof value !== "object" || value === null) return false;
  const state = value as Record<string, unknown>;
  return (
    Array.isArray(state.players) &&
    state.players.length > 0 &&
    typeof state.round === "number" &&
    typeof state.phase === "string" &&
    typeof state.currentPlayerIndex === "number" &&
    typeof state.rng === "object" &&
    state.rng !== null &&
    Array.isArray(state.log)
  );
}
