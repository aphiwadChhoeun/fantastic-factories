import type { Player } from "@/engine";
import { colorSwatch, DIE_SWATCHES } from "@/lib/colors";
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
          <span
            className={styles.swatch}
            style={colorSwatch(player.color)}
            title={`${player.color} dice`}
          />
          {player.name}
          {active ? " — to act" : ""}
        </span>
        <span className={styles.cardMeta}>
          {player.resources.metal} metal · {player.resources.energy} energy ·{" "}
          {player.resources.goods} goods · {player.compound.length} in compound
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
                style={DIE_SWATCHES[die.color]}
                title={`${die.color} ${die.face} — ${die.spent ? "spent" : "available"}`}
              >
                {die.face}
              </span>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className={styles.sectionTitle}>Compound</div>
        {player.compound.length === 0 ? (
          <p className={styles.empty}>Nothing built yet.</p>
        ) : (
          <div className={styles.cardRow}>
            {player.compound.map((building) => (
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
          <p className={styles.empty}>{player.hand.length} card(s), hidden.</p>
        ) : player.hand.length === 0 ? (
          <p className={styles.empty}>No cards.</p>
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
