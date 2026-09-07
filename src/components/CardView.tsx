import type { DragEvent } from "react";
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
  /** Clicking the card plays a move — taking it, or paying with it. */
  onSelect?: () => void;
  /** What clicking does, for anyone who cannot see the card. */
  selectLabel?: string;
  /** Draws the eye: there is something you can do with this card right now. */
  highlight?: boolean;
  /** Mid-selection: this card is the one being paid for. */
  selected?: boolean;
  /** The die being dragged can be dropped here. */
  dropTarget?: boolean;
  onDropDie?: () => void;
};

export function CardView({
  card,
  built = false,
  spent = false,
  onSelect,
  selectLabel,
  highlight = false,
  selected = false,
  dropTarget = false,
  onDropDie,
}: Props) {
  const className = [
    styles.card,
    card.kind === "contractor" && styles.cardContractor,
    built && styles.cardBuilt,
    spent && styles.cardSpent,
    highlight && styles.cardHighlight,
    selected && styles.cardSelected,
    dropTarget && styles.cardDropTarget,
  ]
    .filter(Boolean)
    .join(" ");

  const body = (
    <>
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
        <span className={styles.cardMeta}>Also costs: {describeResources(card.extraCost)}</span>
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
    </>
  );

  // Only a target for the die being dragged; anything else keeps the default
  // "not allowed" cursor, which is the honest answer.
  const dropProps = dropTarget
    ? {
        onDragOver: (event: DragEvent) => event.preventDefault(),
        onDrop: (event: DragEvent) => {
          event.preventDefault();
          onDropDie?.();
        },
      }
    : {};

  if (onSelect) {
    return (
      <button
        type="button"
        className={className}
        onClick={onSelect}
        aria-label={selectLabel}
        {...dropProps}
      >
        {body}
      </button>
    );
  }

  return (
    <div className={className} {...dropProps}>
      {body}
    </div>
  );
}
