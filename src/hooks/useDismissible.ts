"use client";

import { useEffect, useRef, type RefObject } from "react";

/**
 * The two ways out of a panel that floats over the board: Escape, and a click
 * somewhere that is not it.
 *
 * Not a `<dialog>`, because none of these are modal — the log is read *while*
 * deciding a move, and the move list under the bar is opened to play from, so
 * either one taking the board hostage would be taking away the thing it was
 * opened to help with. That leaves the dismissing to be done by hand, and it
 * is the same by-hand every time, so it lives here.
 *
 * The returned ref goes on the wrapper around *both* the plate and the panel.
 * On the panel alone, the click that opened it would land outside and close it
 * again before the browser had drawn it once.
 *
 * `pointerdown` rather than `click`: a drag that starts on the board should
 * put the panel away as it begins, not once it is let go somewhere else.
 */
export function useDismissible(
  open: boolean,
  onClose: () => void,
): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);
  /*
   * So the listeners below are bound to the panel being open and not to the
   * identity of the callback, which every parent re-render replaces. Kept up
   * to date in its own effect rather than on the way past during the render:
   * a ref written mid-render is one the next render can disagree with.
   */
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      const node = ref.current;
      if (node && !node.contains(event.target as Node)) close.current();
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close.current();
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return ref;
}
