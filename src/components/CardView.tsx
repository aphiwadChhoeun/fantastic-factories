import type { DragEvent } from "react";
import type { Card, DieFace, Resources } from "@/engine";
import {
  BLUEPRINT_CATEGORY_SWATCHES,
  BLUEPRINT_TOOL_GLYPHS,
  BLUEPRINT_TOOL_SWATCHES,
} from "@/lib/colors";
import {
  describeEffect,
  describePassive,
  describePerkCost,
  describeResources,
} from "@/lib/format";
import styles from "./game.module.css";

function costsResources(cost: Resources): boolean {
  return cost.metal > 0 || cost.energy > 0 || cost.goods > 0;
}

type Props = {
  card: Card;
  /**
   * What this card costs *this* player, when that is not what is printed on
   * it — a Megalith is discounted by the Monuments already standing.
   */
  buildCost?: Resources;
  /** A blueprint standing in a compound, rather than one held in hand. */
  built?: boolean;
  /** Why this card cannot be used right now, when that is not obvious. */
  note?: string;
  /** Faces standing on a built blueprint's perk. Full means used this round. */
  dice?: readonly DieFace[];
  /** A building whose perk has been used this round. */
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
  buildCost,
  built = false,
  note,
  dice = [],
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
        {/* Icon and colour only — the tool name is on hover. */}
        {card.kind === "blueprint" && (
          <span
            className={styles.typeBadge}
            style={BLUEPRINT_TOOL_SWATCHES[card.tool]}
            title={`${card.tool} blueprint`}
            aria-label={`${card.tool} blueprint`}
            role="img"
          >
            {BLUEPRINT_TOOL_GLYPHS[card.tool]}
          </span>
        )}
      </span>
      {/* What the card is, in its printed colour. */}
      {card.kind === "blueprint" && (
        <span className={styles.categoryBand} style={BLUEPRINT_CATEGORY_SWATCHES[card.type]}>
          {card.type}
        </span>
      )}
      {card.kind === "contractor" && card.extraCost && (
        <span className={styles.cardMeta}>Also costs: {describeResources(card.extraCost)}</span>
      )}
      {/* Built, the build cost is history; in hand, both matter. */}
      {card.kind === "blueprint" &&
        !built &&
        (() => {
          const price = buildCost ?? card.buildCost;
          const discounted = price.metal < card.buildCost.metal;
          return (
            <span className={styles.cardMeta}>
              Build: discard a {card.tool}
              {costsResources(price) ? `, ${describeResources(price)}` : ""}
              {discounted ? " (discounted)" : ""}
            </span>
          );
        })()}
      {card.kind === "blueprint" && card.perk && (
        <span className={styles.cardMeta}>Work: {describePerkCost(card.perk)}</span>
      )}
      {card.kind === "contractor" ? (
        <span className={styles.cardMeta}>{describeEffect(card.effect)}</span>
      ) : (
        card.perk && <span className={styles.cardMeta}>{describeEffect(card.perk.effect)}</span>
      )}
      {/* A passive is not worked, so it has no Work line — only what it does. */}
      {card.kind === "blueprint" && card.passive && (
        <span className={styles.cardMeta}>{describePassive(card.passive)}</span>
      )}
      {card.kind === "blueprint" && card.prestige ? (
        <span className={styles.cardMeta}>
          {card.prestige} prestige{card.prestigeBonus ? `, +${card.prestigeBonus} for the set` : ""}
        </span>
      ) : null}
      {card.kind === "blueprint" && built && card.perk && card.perk.dice > 0 && (
        <div className={styles.dice}>
          {Array.from({ length: card.perk.dice }, (_, index) => {
            const face = dice[index];
            return face === undefined ? (
              <span key={index} className={`${styles.die} ${styles.hqSlot}`} />
            ) : (
              <span key={index} className={`${styles.die} ${styles.dieSpent}`}>
                {face}
              </span>
            );
          })}
        </div>
      )}
      {card.kind === "contractor" && (
        <span className={styles.cardTag}>resolves on take, then discarded</span>
      )}
      {note && <span className={styles.cardTag}>{note}</span>}
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
