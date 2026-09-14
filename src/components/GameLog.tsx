"use client";

import { useState } from "react";
import { useDismissible } from "@/hooks/useDismissible";
import { PlateButton } from "./PlateButton";
import styles from "./game.module.css";

/**
 * What has happened so far, folded up behind a plate in the top bar.
 *
 * Floating rather than in a column of its own: the log is the one thing on
 * screen that is never the next move, and it was holding a sidebar open for
 * the whole game to say so. Opened, it hangs over the table and closes on
 * Escape or on the next click anywhere else — see `useDismissible`.
 *
 * The count on the plate is the whole reason it can be shut: without it,
 * folding the log away would be folding away the fact that anything happened.
 */
export function GameLog({ entries }: { entries: readonly string[] }) {
  const [open, setOpen] = useState(false);
  const ref = useDismissible(open, () => setOpen(false));

  return (
    <div className={styles.popover} ref={ref}>
      <PlateButton onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="game-log">
        Log {entries.length}
      </PlateButton>

      {open && (
        <section
          id="game-log"
          className={`${styles.section} ${styles.popoverPanel} ${styles.popoverBelow}`}
        >
          <div className={styles.sectionTitle}>Log</div>
          {/* Reversed by CSS so the newest line sits on top without copying the array. */}
          <ul className={styles.log}>
            {entries.map((entry, index) => (
              <li key={`${index}-${entry}`}>{entry}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
