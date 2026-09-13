/**
 * What makes a die feel like brass, and how one gets thrown.
 *
 * Weight is not mass. Doubling a die's mass changes nothing about how it falls,
 * because gravity scales with it — every number here is about something else.
 * See docs/dice.md §1.1, which is where they come from and why.
 *
 * No `three` and no Rapier: this is the tuning, kept where a simulation can be
 * run against it without a canvas. `simulate.test.ts` does exactly that.
 */

import { between, either, seedOf, spread } from "@/lib/seed";

/** Half a die, in world units. One unit is about a centimetre at this scale. */
export const HALF = 0.8;

/**
 * The real lever, and the one to tune before touching anything else.
 *
 * At dice scale earth gravity looks like styrofoam in slow motion. Heavy
 * things fall *fast* and stop *now*, and this is most of what separates brass
 * from plastic.
 */
export const GRAVITY = { x: 0, y: -45, z: 0 };

export const BODY = {
  /** Brass on a wooden tray barely bounces. Plastic is ~0.6, and it shows. */
  restitution: 0.12,
  /** It bites and stops, rather than skating. */
  friction: 0.85,
  /** Kills the long lazy spin that light objects do. */
  angularDamping: 0.55,
  /** Slight air resistance; mostly it helps the die settle in time. */
  linearDamping: 0.15,
} as const;

/**
 * The bevel, as a fraction of half a die.
 *
 * Worth more than it sounds. Real dice are chamfered, and a hard-edged cube
 * catches an edge and stops dead where a chamfered one tumbles.
 */
export const BEVEL = 0.12;

/** Fixed, so that a frame hitch cannot put a die through a wall. */
export const TIME_STEP = 1 / 60;

/**
 * The tray, in world units: half its width in X, half its depth in Z, and a
 * floor at y = 0.
 *
 * Sized for six dice at rest with room to spare — the workforce plus white
 * extras. Dice with nowhere to settle keep nudging each other and never sleep.
 */
export const TRAY = { x: 9, z: 6, wall: 3, height: 8 } as const;

/**
 * Above this, in either speed or spin, the die is still being thrown: the
 * outcome is not in question yet and nothing touches it.
 */
export const MOVING = 6;

/**
 * How much of the turn it still owes to take each step once it is below that,
 * and how far that is ever allowed to turn it in one step.
 *
 * docs/dice.md §1.3 asks for a *torque impulse* here, and the simulation in
 * `simulate.test.ts` is why this steers instead. At this gravity a die resting
 * on a face needs about 8.7 of angular impulse to tip over one edge, where the
 * doc's nudge supplies 0.09 — four orders out. Swept across the range, torque
 * either did nothing at all (5 throws in 24 landed right, which is chance) or
 * was strong enough to visibly shove the die and stop it settling at all.
 * There is no window in between, because gravity is the one number §1.1 says
 * to tune before anything else and it is doing its job.
 *
 * So the correction steers the pose rather than pushing the body: a share of
 * the shortest turn that would bring the owed face up, taken every step while
 * the die is still rolling, and capped so that no one frame turns it further
 * than the tumble is turning it anyway.
 */
export const STEER = 0.25;

/** In degrees. Six a frame is 360 a second, against a die already tumbling. */
export const STEER_CAP = 7;

/**
 * How long the board is prepared to wait for a die that will not sleep.
 *
 * A die balanced on a corner can take a very long time, and the engine already
 * knows the answer, so there is a hard floor under all of this. Nothing in the
 * UI ever waits on physics converging.
 */
export const DEADLINE_MS = 2200;

/** How long the hard correction takes, once the deadline has passed. */
export const CORRECTION_MS = 140;

export type Vector = { readonly x: number; readonly y: number; readonly z: number };

export type Throw = {
  /** Where it comes in, on an arc above the tray. */
  readonly from: Vector;
  /** The pose it starts tumbling from. Most of "organic" is here. */
  readonly spin: Vector;
  /** Thrown inward and down, not dropped. */
  readonly impulse: Vector;
  /** Where the character is. Unequal per axis, or it spins like a coin. */
  readonly torque: Vector;
  /** How long after the roll this one leaves the hand. */
  readonly delay: number;
};

/**
 * Between one die being created and the next.
 *
 * Not decoration. Nearly all interpenetration comes from bodies created
 * overlapping on the same tick, and no solver recovers from that gracefully —
 * it explodes them apart, which is what "the dice bounced off the screen"
 * actually is. See docs/dice.md §4.1.
 */
export const SPAWN_STAGGER_MS = 70;

/**
 * How one die is thrown.
 *
 * Off its id, so the same die throws the same way twice and two dice never
 * throw alike: identical impulses produce synchronised dice, which looks
 * scripted even though every frame of it was simulated.
 */
export function throwFor(dieId: string, index: number, count: number): Throw {
  const next = spread(seedOf(dieId));

  /*
   * Spawned on an arc above the tray, one die to a station, with a little
   * jitter. Two bodies cannot start inside each other even if the stagger is
   * lost — which is the belt to §4.1's braces.
   */
  const station = count > 1 ? index / (count - 1) - 0.5 : 0;
  const from = {
    x: station * TRAY.x * 1.2 + between(next, -0.6, 0.6),
    y: TRAY.height + between(next, -0.8, 0.8),
    z: TRAY.z * 0.9 + between(next, -0.5, 0.5),
  };

  return {
    from,
    spin: {
      x: between(next, 0, Math.PI * 2),
      y: between(next, 0, Math.PI * 2),
      z: between(next, 0, Math.PI * 2),
    },
    impulse: {
      // Toward the middle of the tray rather than always the same way, so a
      // die thrown from the left does not sail out over the right-hand wall.
      x: -station * between(next, 2, 5) + between(next, -1, 1),
      y: -2 - next() * 2,
      z: -3 - next() * 3,
    },
    torque: {
      x: between(next, -0.175, 0.175),
      y: between(next, -0.1, 0.1),
      z: between(next, -0.175, 0.175),
    },
    delay: index * SPAWN_STAGGER_MS + between(next, 0, 12) * either(next),
  };
}

/** How long a whole handful takes at worst, for whatever has to outlast it. */
export function throwTotalMs(count: number): number {
  return Math.max(0, count - 1) * SPAWN_STAGGER_MS + DEADLINE_MS + CORRECTION_MS;
}
