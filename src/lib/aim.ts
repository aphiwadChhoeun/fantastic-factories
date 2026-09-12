/**
 * What a die being carried is aimed at.
 *
 * One answer, used three ways: the target lights up, the die leans toward it,
 * and the trajectory line points at it — and then the drop plays the move that
 * target stands for. That is the whole reason this is one function rather than
 * three. A die that leans at a slot it will not land in, or a line that points
 * somewhere the drop will not go, is a promise the board then breaks.
 *
 * Legality never enters into it, because it cannot: the only targets handed in
 * are the ones carrying a `data-drop`, and a target only carries one while it
 * would take the die being held. See docs/dice.md §2.3.
 */

/** As much of a `DOMRect` as finding a middle needs. */
export type Box = {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
};

/** Somewhere the die may land, and where on the screen that is. */
export type Target = {
  readonly id: string;
  /** Everything that counts as this target for a die let go over it. */
  readonly box: Box;
  /**
   * Where the die actually comes to rest, when that is not the middle of the
   * box: a Headquarters section takes a drop anywhere on it, but the die ends
   * up in one particular slot, and that is where the line should arrive and
   * what the die should lean at. Left out when the two are the same.
   */
  readonly at?: Point;
};

export type Point = { readonly x: number; readonly y: number };

export type Aim = {
  /** The `data-drop` of the target, which is also the move it stands for. */
  readonly id: string;
  /** The middle of it, for the far end of the trajectory line. */
  readonly at: Point;
  /** From the pointer to that middle. */
  readonly dx: number;
  readonly dy: number;
  readonly distance: number;
};

/**
 * How near the pointer has to be to a target's middle before the die is
 * considered to be aimed at it. Roughly two dice wide: near enough that the
 * player is clearly reaching for it, far enough that they do not have to be
 * accurate.
 */
export const SNAP_RADIUS = 72;

/** How much of the way to the target the die is drawn, at its very nearest. */
const PULL = 0.35;

/** The middle of a box, which is where a die is taken to be aimed. */
export function middleOf(box: Box): Point {
  return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

/**
 * The target a die let go at `point` would land on, if any.
 *
 * A target the pointer is actually inside wins outright, however far its middle
 * happens to be — a compound card is two hundred pixels tall, and a die dropped
 * squarely on one must go there rather than to whatever small slot is nearer to
 * the card's centre. Failing that, the nearest middle within the radius.
 */
export function aimAt(
  point: Point,
  targets: readonly Target[],
  radius: number = SNAP_RADIUS,
): Aim | null {
  let best: Aim | null = null;
  let bestInside = false;

  for (const target of targets) {
    const { id, box } = target;
    const at = target.at ?? middleOf(box);
    const dx = at.x - point.x;
    const dy = at.y - point.y;
    const distance = Math.hypot(dx, dy);
    const inside =
      point.x >= box.left &&
      point.x <= box.left + box.width &&
      point.y >= box.top &&
      point.y <= box.top + box.height;

    if (!inside && (bestInside || distance > radius)) continue;
    // Among equals — both inside, or both merely near — the nearer middle wins.
    if (best && bestInside === inside && distance >= best.distance) continue;

    best = { id, at, dx, dy, distance };
    bestInside = inside;
  }

  return best;
}

/**
 * How far the die leans toward what it is aimed at, in pixels.
 *
 * Eased over the radius so the die drifts rather than jumps, and never the
 * whole way: the die stays under the pointer, because the pointer is where the
 * player put it. Zero for a target the pointer is already inside — there is
 * nothing left to promise, and dragging the die off toward the middle of a tall
 * card would be taking it away from the hand carrying it.
 */
export function pullOf(aim: Aim | null, radius: number = SNAP_RADIUS): Point {
  if (!aim) return { x: 0, y: 0 };
  const eased = PULL * Math.max(0, 1 - aim.distance / radius);
  return { x: aim.dx * eased, y: aim.dy * eased };
}
