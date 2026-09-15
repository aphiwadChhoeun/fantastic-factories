"use client";

import { useEffect, useId, useRef, type MouseEvent } from "react";
import { PlateButton } from "./PlateButton";
import styles from "./game.module.css";

/** Where a report or a suggestion actually reaches somebody. */
const CONTACT_URL = "https://boardgamegeek.com/profile/chair47";

type Props = {
  /** Escape, the backdrop and the Close plate all arrive here. */
  readonly onClose: () => void;
};

/**
 * Who this is by, what it is of, and who to tell when it breaks.
 *
 * Built like `Confirm` and `Settings`: a native `<dialog>`, so Escape closes
 * it, focus is trapped inside it, and the board below does not have to know it
 * is open.
 *
 * The one plate in the top bar that is not about the game in progress, and the
 * only thing on the board that is allowed to send a player somewhere else — so
 * the link says where it goes, and goes there in its own tab rather than
 * taking a game in progress with it.
 */
export function Credits({ onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  /**
   * A modal dialog fills the viewport with its backdrop, so a click outside
   * the panel still lands on the dialog itself. That is what tells the two
   * apart.
   */
  function onBackdropClick(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === ref.current) onClose();
  }

  return (
    <dialog
      ref={ref}
      className={styles.modal}
      aria-labelledby={titleId}
      // `cancel` is Escape and nothing else. `close` would also fire on the
      // way out, when there is nothing left to close.
      onCancel={onClose}
      onClick={onBackdropClick}
    >
      <h2 className={styles.modalTitle} id={titleId}>
        Credits
      </h2>

      <div className={styles.settingsBody}>
        <div className={styles.settingsGroup}>
          <div className={styles.sectionTitle}>The game</div>
          <p className={styles.settingsNote}>
            An unofficial fan implementation of the board game{" "}
            <strong>Fantastic Factories</strong>. All credit for the design belongs to
            its original creators and publisher; this is a digital version made for
            play, not a product of theirs.
          </p>
        </div>

        <div className={styles.settingsGroup}>
          <div className={styles.sectionTitle}>Feedback</div>
          <p className={styles.settingsNote}>
            For feedback and bug reports, send a message to{" "}
            <a
              className={styles.link}
              href={CONTACT_URL}
              /*
               * A new tab, because the board is one page holding a game in
               * progress — and `noopener` with it, which is what stops the
               * page being opened from reaching back through `window.opener`.
               */
              target="_blank"
              rel="noopener noreferrer"
            >
              chair47 on BoardGameGeek
            </a>
            .
          </p>
        </div>
      </div>

      <div className={styles.modalActions}>
        <PlateButton onClick={onClose}>Close</PlateButton>
      </div>
    </dialog>
  );
}
