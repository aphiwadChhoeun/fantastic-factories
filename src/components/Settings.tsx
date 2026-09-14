"use client";

import { useEffect, useId, useRef, type MouseEvent } from "react";
import type { GameState } from "@/engine";
import { DEV_TOOLS } from "@/dev/flag";
import { DevPanel } from "./DevPanel";
import { PlateButton } from "./PlateButton";
import styles from "./game.module.css";

type Props = {
  /** What this game was dealt from. The next deal is the one after it. */
  readonly seed: number;
  /** Writes state without a move. Handed straight to the dev panel. */
  readonly debug: (update: (current: GameState) => GameState) => void;
  readonly onClose: () => void;
};

/**
 * What is true about the software rather than about the game.
 *
 * A small dialog, and deliberately so: there is exactly one setting worth the
 * name — the seed, which is the whole of what makes a deal reproducible — plus
 * the dev tools, which used to sit in the sidebar where a player could see
 * them. Built like `Confirm` and `GameOver`: a native `<dialog>`, so Escape
 * closes it and the board below does not have to know it is open.
 */
export function Settings({ seed, debug, onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  function onBackdropClick(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === ref.current) onClose();
  }

  return (
    <dialog
      ref={ref}
      className={styles.modalWide}
      aria-labelledby={titleId}
      onCancel={onClose}
      onClick={onBackdropClick}
    >
      <h2 className={styles.modalTitle} id={titleId}>
        Settings
      </h2>

      <div className={styles.settingsBody}>
        <div className={styles.settingsGroup}>
          <div className={styles.sectionTitle}>Deal</div>
          <p className={styles.settingsNote}>
            This game was dealt from seed <strong>{seed}</strong>. Every shuffle, roll and
            decision the automaton makes follows from it, so the same seed deals the same
            game. New game takes seed <strong>{seed + 1}</strong>.
          </p>
        </div>

        {/* Folds to `false` in a production build, and the panel goes with it. */}
        {DEV_TOOLS && <DevPanel debug={debug} />}
      </div>

      <div className={styles.modalActions}>
        <PlateButton onClick={onClose}>Close</PlateButton>
      </div>
    </dialog>
  );
}
