"use client";

import { useMemo, useState } from "react";
import type { GameState } from "@/engine";
import { grantableBlueprints, grantBlueprint, type GrantTarget } from "@/dev/grant";
import { PlateButton } from "./PlateButton";
import styles from "./game.module.css";

type Props = {
  /** Writes state without a move. Only this panel may. */
  debug: (update: (current: GameState) => GameState) => void;
};

/**
 * Conjures a blueprint so a card can be tried without playing towards it.
 *
 * Rendered only behind `DEV_TOOLS`, so it is not in a production build at all.
 * It grants to the human, never the automaton: the automaton keeps its
 * compound grouped by type and holds no cards, so a grant would leave it in a
 * state its own rules never produce.
 */
export function DevPanel({ debug }: Props) {
  const cards = useMemo(() => grantableBlueprints(), []);
  const [name, setName] = useState(cards[0].name);

  function grant(target: GrantTarget) {
    const card = cards.find((candidate) => candidate.name === name);
    if (!card) return;
    debug((current) => grantBlueprint(current, 0, card, target));
  }

  return (
    <section className={`${styles.section} ${styles.devPanel}`}>
      <div className={styles.sectionTitle}>Dev tools · not in production</div>

      <label className={styles.devRow}>
        <span className={styles.cardMeta}>Blueprint</span>
        <select
          className={styles.devSelect}
          value={name}
          onChange={(event) => setName(event.target.value)}
        >
          {cards.map((card) => (
            <option key={card.id} value={card.name}>
              {card.name} — {card.type}, {card.tool}
            </option>
          ))}
        </select>
      </label>

      <div className={styles.choices}>
        <PlateButton onClick={() => grant("hand")}>Give to hand</PlateButton>
        <PlateButton onClick={() => grant("compound")}>Stand it up built</PlateButton>
      </div>

      <p className={styles.prompt}>
        Nothing is paid and nothing is checked, so a granted game no longer
        replays from its seed.
      </p>
    </section>
  );
}
