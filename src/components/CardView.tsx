import type { Card } from "@/engine";
import { BLUEPRINT_TYPE_GLYPHS, BLUEPRINT_TYPE_SWATCHES } from "@/lib/colors";
import { describeEffect, describeRequirement, describeResources } from "@/lib/format";
import styles from "./game.module.css";

type Props = {
  card: Card;
  /** A blueprint standing in a compound, rather than one held in hand. */
  built?: boolean;
  /** A building that has already been activated this round. */
  spent?: boolean;
};

export function CardView({ card, built = false, spent = false }: Props) {
  const className = [
    styles.card,
    card.kind === "contractor" && styles.cardContractor,
    built && styles.cardBuilt,
    spent && styles.cardSpent,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={className}>
      <span className={styles.cardHeader}>
        <span className={styles.cardName}>{card.name}</span>
        {/* Icon and colour only — the type name is on hover. */}
        {card.kind === "blueprint" && (
          <span
            className={styles.typeBadge}
            style={BLUEPRINT_TYPE_SWATCHES[card.type]}
            title={`${card.type} blueprint`}
            aria-label={`${card.type} blueprint`}
            role="img"
          >
            {BLUEPRINT_TYPE_GLYPHS[card.type]}
          </span>
        )}
      </span>
      {card.kind === "contractor" && card.extraCost && (
        <span className={styles.cardMeta}>
          Also costs: {describeResources(card.extraCost)}
        </span>
      )}
      {card.kind === "contractor" ? null : built ? (
        <span className={styles.cardMeta}>Activate: {describeRequirement(card.activation)}</span>
      ) : (
        <span className={styles.cardMeta}>
          Build: {describeResources(card.buildCost)}, die {card.buildRequirement}+
        </span>
      )}
      <span className={styles.cardMeta}>{describeEffect(card.effect)}</span>
      {card.kind === "contractor" && (
        <span className={styles.cardTag}>resolves on take, then discarded</span>
      )}
    </div>
  );
}
