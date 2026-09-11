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
import { ResourceChip, ResourceChips, ResourceText } from "./Resource";
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

  /**
   * What the card is, said in colour alone. The word used to be printed under
   * the name; the band carries it now, and the name sits in it — one band
   * instead of two, and the type still reads before the name does.
   */
  const band =
    card.kind === "blueprint"
      ? BLUEPRINT_CATEGORY_SWATCHES[card.type]
      : { background: "var(--color-surface-3)", color: "var(--color-parchment-dim)" };

  // Built, the build cost is history; in hand, it is the first thing asked.
  const printed = card.kind === "blueprint" ? card.buildCost : undefined;
  const price = printed && !built ? (buildCost ?? printed) : undefined;
  const discounted = price !== undefined && printed !== undefined && price.metal < printed.metal;

  /**
   * The mark and the price, on one line. For a blueprint the mark *is* half
   * the price — it says which card comes out of hand to pay for this one — so
   * the two belong together rather than in a header and a sentence.
   */
  const stats =
    card.kind === "blueprint" ? (
      <div className={styles.cardStats}>
        <span
          className={styles.typeBadge}
          style={BLUEPRINT_TOOL_SWATCHES[card.tool]}
          title={built ? `${card.tool} blueprint` : `Build: discard a ${card.tool} blueprint`}
          aria-label={built ? `${card.tool} blueprint` : `Build: discard a ${card.tool} blueprint`}
          role="img"
        >
          {BLUEPRINT_TOOL_GLYPHS[card.tool]}
        </span>
        {price && costsResources(price) && <ResourceChips resources={price} />}
        {discounted && <span className={styles.discount}>discounted</span>}
      </div>
    ) : card.extraCost && costsResources(card.extraCost) ? (
      <div className={styles.cardStats}>
        <span className={styles.chipFree}>also</span>
        <ResourceChips resources={card.extraCost} />
      </div>
    ) : null;

  const body = (
    <>
      <span className={styles.cardName} style={band} title={cardTitle(card)}>
        {card.name}
      </span>
      {stats}

      <div className={styles.cardBody}>
        {card.kind === "blueprint" && card.perk && (
          <span className={styles.cardMeta}>
            Work: <ResourceText>{describePerkCost(card.perk)}</ResourceText>
          </span>
        )}
        {card.kind === "contractor" ? (
          <span className={styles.cardMeta}>
            <ResourceText>{describeEffect(card.effect)}</ResourceText>
          </span>
        ) : (
          card.perk && (
            <span className={styles.cardMeta}>
              <ResourceText>{describeEffect(card.perk.effect)}</ResourceText>
            </span>
          )
        )}
        {/* A passive is not worked, so it has no Work line — only what it does. */}
        {card.kind === "blueprint" && card.passive && (
          <span className={styles.cardMeta}>
            <ResourceText>{describePassive(card.passive)}</ResourceText>
          </span>
        )}
        {note && (
          <span className={styles.cardTag}>
            <ResourceText>{note}</ResourceText>
          </span>
        )}
      </div>

      <div className={styles.cardFoot}>
        {card.kind === "blueprint" && card.prestige ? (
          <span className={styles.prestige}>
            <ResourceChip
              kind="prestige"
              amount={card.prestige}
              title={`${card.prestige} prestige`}
            />
            {card.prestigeBonus ? (
              <span className={styles.chipFree}>+{card.prestigeBonus} set</span>
            ) : null}
          </span>
        ) : null}
        {/*
          * How many slots the perk has, except for a card that borrows one: the
          * Replicator prints no dice of its own and holds however many the perk
          * it copied asked for.
          */}
        {card.kind === "blueprint" &&
          built &&
          card.perk &&
          (card.perk.dice > 0 || dice.length > 0) && (
            <div className={styles.dice}>
              {Array.from({ length: Math.max(card.perk.dice, dice.length) }, (_, index) => {
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
          <span className={styles.cardTag}>one engagement, then gone</span>
        )}
      </div>
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

/**
 * The type, and what a blueprint costs, kept somewhere it can still be read.
 * Neither is printed on the face any more — the band says the type in colour
 * and the stats row says the price in glyphs — so this is the way back to the
 * words for anyone who wants them.
 */
function cardTitle(card: Card): string {
  if (card.kind === "contractor") return "Contractor";
  return `${card.type} · build: discard a ${card.tool}, ${describeResources(card.buildCost)}`;
}
