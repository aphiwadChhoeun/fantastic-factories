/**
 * How a die gets from one face to another.
 *
 * A face can change six ways — rolled, re-rolled, handed over, chosen, flipped
 * or stepped — and only two of them are throws. The rest happen to a die lying
 * on the table, and the animation for those is not a throw at all: it is the
 * die turning over where it lies. See docs/dice.md §0.
 *
 * Nothing here asks which perk did it. The engine has already decided the new
 * face, and the turn that brings it up is a fact about a cube rather than about
 * a card — which is what keeps this a lookup rather than a guess.
 */

import { oppositeFace, type DieFace } from "@/engine";

/** A die turning over. ~260ms — long enough to read as weight, not as a wipe. */
export const HALF_TURN_MS = 260;

/** A die tipping over one edge. Less far to go, so less time to get there. */
export const QUARTER_TURN_MS = 200;

/**
 * The fuse between a die landing on a building and the building firing.
 *
 * The engine does both in one move, and played at the same instant they are
 * two animations that happen to be adjacent. Held apart by this much, they are
 * one gesture: the die strikes, the charge runs up the card, the factory goes
 * off. Long enough to read as travel, short enough that nobody is waiting for
 * their turn to continue. See docs/dice.md §3.2.
 */
export const CHARGE_MS = 340;

/**
 * The turn that brings `to` up while `from` is showing, in degrees.
 *
 * On a d6 any two different faces are either opposite — they sum to seven —
 * or they are neighbours, and neighbours are exactly a quarter turn apart.
 * So a Dojo flip is a half turn and a Fitness Center step is a quarter turn
 * because that is the shape of the die, not because the move was named: the
 * same rule answers a re-roll, which is named nothing at all.
 *
 * Signed, so that a face going up turns one way and a face coming down turns
 * the other. A step taken back visibly undoes itself, which is the only clue
 * on the table that the two moves are opposites.
 */
export function turnTo(from: DieFace, to: DieFace): number {
  if (from === to) return 0;
  const degrees = to === oppositeFace(from) ? 180 : 90;
  return to > from ? degrees : -degrees;
}

/** How long that turn should take. Further to go, longer to take. */
export function turnMs(degrees: number): number {
  if (degrees === 0) return 0;
  return Math.abs(degrees) === 180 ? HALF_TURN_MS : QUARTER_TURN_MS;
}
