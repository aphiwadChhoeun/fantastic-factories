/**
 * Debug tools. Not part of the game.
 *
 * Everything here writes to `GameState` directly instead of going through
 * `Move` and `applyMove`, which is exactly what the engine's one contract says
 * not to do. That is the point: a granted card is not something a player could
 * have done, so it must not be a move — the AI would be offered it and the
 * rules would have to make sense of it.
 *
 * The cost is that a granted game no longer replays from its seed and move
 * list. Fine for poking at a card; never ship it.
 */

import { createBlueprintDeck, type BlueprintCard, type GameState } from "@/engine";

/** Where a granted card lands. */
export type GrantTarget = "hand" | "compound";

/** One of each blueprint, by name, for the picker. */
export function grantableBlueprints(): BlueprintCard[] {
  const seen = new Set<string>();
  return createBlueprintDeck().filter((card) => {
    if (seen.has(card.name)) return false;
    seen.add(card.name);
    return true;
  });
}

/**
 * A fresh id for a conjured card. Real ids are stable and unique per printed
 * copy, so a grant mints its own rather than handing out a second card with
 * an id already on the table.
 */
function grantedId(state: GameState, card: BlueprintCard): string {
  const slug = card.name.toLowerCase().replace(/\s+/g, "-");
  const conjured = state.players.flatMap((player) => [
    ...player.hand,
    ...player.compound.map((building) => building.card),
  ]);
  const taken = conjured.filter((held) => held.id.startsWith("dev-")).length;
  return `dev-${slug}-${taken}`;
}

/**
 * Puts a blueprint into a player's hand, or stands it up in their compound.
 *
 * Nothing is paid and nothing is checked: a card can be stood up that the
 * player could never have built, and a second copy of something already up.
 * That is what makes it useful for testing, and unfit for anything else.
 *
 * The deck is left alone — this conjures a card rather than drawing one, so
 * the counts on the market rows stay honest.
 */
export function grantBlueprint(
  state: GameState,
  playerIndex: number,
  card: BlueprintCard,
  target: GrantTarget,
): GameState {
  const granted: BlueprintCard = { ...card, id: grantedId(state, card) };

  const players = state.players.map((player, index) => {
    if (index !== playerIndex) return player;
    return target === "hand"
      ? { ...player, hand: [...player.hand, granted] }
      : {
          ...player,
          compound: [...player.compound, { card: granted, dice: [], worked: false }],
        };
  });

  const where = target === "hand" ? "into hand" : "into the compound";
  return {
    ...state,
    players,
    log: [...state.log, `[dev] granted ${card.name} ${where}`],
  };
}
