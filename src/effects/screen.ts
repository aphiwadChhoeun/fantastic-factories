/**
 * The one conversion between the two coordinate systems on screen.
 *
 * The board is laid out in CSS pixels with y growing downwards; the canvas is
 * a scene with y growing upwards and the origin in the middle. Keeping that
 * translation in one pure function — rather than inline at each emit site — is
 * what stops it from being got subtly wrong in one place only.
 */

export type Point = { readonly x: number; readonly y: number };

/** Just the part of a `DOMRect` an anchor needs, so this can be tested. */
export type Box = {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
};

/** Which edge of a thing the sparks come off. */
export type Edge = "center" | "top" | "bottom";

/** The point on a box to emit from, horizontally centred. */
export function anchorIn(box: Box, edge: Edge = "center"): Point {
  const y =
    edge === "top"
      ? box.top
      : edge === "bottom"
        ? box.top + box.height
        : box.top + box.height / 2;
  return { x: box.left + box.width / 2, y };
}

/**
 * The same, for something on the page. Viewport coordinates, not page ones:
 * the canvas is `position: fixed`, so it shares the viewport's origin and
 * scrolling needs no correction.
 */
export function anchorOf(element: Element, edge?: Edge): Point {
  return anchorIn(element.getBoundingClientRect(), edge);
}

/**
 * Viewport pixels to world units.
 *
 * This is an identity on scale, not just on origin, and that is a deliberate
 * choice made by the camera: an orthographic camera at `zoom: 1` makes one
 * world unit exactly one CSS pixel. It costs nothing and it buys everything —
 * a speed of 190 in the emitter means 190 px/s on screen, a point size of 8
 * means 8 px, and the numbers in the shader can be reasoned about by looking
 * at the board instead of by trial and error.
 */
export function toWorld(
  x: number,
  y: number,
  width: number,
  height: number,
): readonly [number, number] {
  return [x - width / 2, height / 2 - y];
}
