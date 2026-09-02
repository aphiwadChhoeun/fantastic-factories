import type { Card } from "@/engine";
import { describeEffect, describeRequirement, describeResources } from "@/lib/format";
import styles from "./game.module.css";

type Props = {
  card: Card;
  /** Built cards read differently from blueprints in hand. */
  built?: boolean;
  /** A built card that has already been used this round. */
  spent?: boolean;
};

export function CardView({ card, built = false, spent = false }: Props) {
  const className = [styles.card, built && styles.cardBuilt, spent && styles.cardSpent]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={className}>
      <span className={styles.cardName}>{card.name}</span>
      {built ? (
        <span className={styles.cardMeta}>Activate: {describeRequirement(card.activation)}</span>
      ) : (
        <span className={styles.cardMeta}>
          Build: {describeResources(card.buildCost)}, die {card.buildRequirement}+
        </span>
      )}
      <span className={styles.cardMeta}>{describeEffect(card.effect)}</span>
    </div>
  );
}
