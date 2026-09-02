import type { Player } from "@/engine";
import { CardView } from "./CardView";
import styles from "./game.module.css";

type Props = {
  player: Player;
  active: boolean;
  /** Hide an AI opponent's hand; blueprints are private information. */
  hideHand?: boolean;
};

export function PlayerPanel({ player, active, hideHand = false }: Props) {
  return (
    <section className={`${styles.section} ${active ? styles.playerActive : ""}`}>
      <header className={styles.playerHeader}>
        <span className={styles.playerName}>
          {player.name}
          {active ? " — to act" : ""}
        </span>
        <span className={styles.cardMeta}>
          {player.resources.goods} goods · {player.resources.energy} energy ·{" "}
          {player.buildings.length} built
        </span>
      </header>

      <div>
        <div className={styles.sectionTitle}>Dice</div>
        {player.dice.length === 0 ? (
          <p className={styles.empty}>Not rolled yet.</p>
        ) : (
          <div className={styles.dice}>
            {player.dice.map((die) => (
              <span
                key={die.id}
                className={`${styles.die} ${die.spent ? styles.dieSpent : ""}`}
                title={die.spent ? "Spent" : "Available"}
              >
                {die.face}
              </span>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className={styles.sectionTitle}>Buildings</div>
        {player.buildings.length === 0 ? (
          <p className={styles.empty}>Nothing built yet.</p>
        ) : (
          <div className={styles.cardRow}>
            {player.buildings.map((building) => (
              <CardView
                key={building.card.id}
                card={building.card}
                built
                spent={building.activated}
              />
            ))}
          </div>
        )}
      </div>

      <div>
        <div className={styles.sectionTitle}>Hand</div>
        {hideHand ? (
          <p className={styles.empty}>{player.hand.length} blueprint(s), hidden.</p>
        ) : player.hand.length === 0 ? (
          <p className={styles.empty}>No blueprints.</p>
        ) : (
          <div className={styles.cardRow}>
            {player.hand.map((card) => (
              <CardView key={card.id} card={card} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
