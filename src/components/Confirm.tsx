"use client";

import { useEffect, useId, useRef, type MouseEvent } from "react";
import { PlateButton } from "./PlateButton";
import styles from "./game.module.css";

type Props = {
  readonly title: string;
  /** What is at stake, in a line. Left out when the title says all of it. */
  readonly body?: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  readonly onConfirm: () => void;
  /** Escape, the backdrop and the cancel plate all arrive here. */
  readonly onCancel: () => void;
};

/**
 * Are you sure — for the one or two things on the board that cannot be undone.
 *
 * Built the same way as `GameOver`: a native `<dialog>` rather than a div with
 * a high z-index, so Escape closes it, focus is trapped inside it, and it sits
 * above everything without the rest of the board having to know it exists.
 *
 * The cancel plate takes focus rather than the confirm one, which is the whole
 * point of the dialog: a player who hits Return to get rid of it should keep
 * the game, not lose it. Escape and the backdrop land in the same place.
 */
export function Confirm({
  title,
  body,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const safeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  // Mounted only while the question is open, so opening on mount is the whole
  // of it. Closing on the way out keeps the browser's top layer tidy.
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    /*
     * Focus is moved *after* opening, and by hand. React's `autoFocus` is not
     * the HTML attribute — it calls `focus()` while the dialog is still shut,
     * and `showModal` then hands focus to the first focusable descendant
     * regardless, which is the destructive plate. Return would have thrown the
     * game away.
     */
    safeRef.current?.focus();
    return () => dialog?.close();
  }, []);

  /**
   * A modal dialog fills the viewport with its backdrop, so a click outside
   * the panel still lands on the dialog itself. That is what tells the two
   * apart.
   */
  function onBackdropClick(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === ref.current) onCancel();
  }

  return (
    <dialog
      ref={ref}
      className={styles.modal}
      aria-labelledby={titleId}
      // `cancel` is Escape and nothing else. `close` would also fire when the
      // dialog is closed on the way out, which would answer a question that is
      // no longer being asked.
      onCancel={onCancel}
      onClick={onBackdropClick}
    >
      <h2 className={styles.modalTitle} id={titleId}>
        {title}
      </h2>
      {body && <p className={styles.modalReason}>{body}</p>}

      <div className={styles.modalActions}>
        <PlateButton onClick={onConfirm}>{confirmLabel}</PlateButton>
        <PlateButton ref={safeRef} onClick={onCancel}>
          {cancelLabel}
        </PlateButton>
      </div>
    </dialog>
  );
}
