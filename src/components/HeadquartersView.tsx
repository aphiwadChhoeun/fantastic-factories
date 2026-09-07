import type { DragEvent } from "react";
import { HQ_SECTIONS, type DieColor, type HqPlacements, type HqSectionId, type Move } from "@/engine";
import { DIE_SWATCHES } from "@/lib/colors";
import { describeHqReward, describeRequirement } from "@/lib/format";
import styles from "./game.module.css";

type Props = {
  placements: HqPlacements;
  /** Placed dice are drawn in the player's colour. */
  color: DieColor;
  /** Sections that will take the die being dragged, and the move that does it. */
  targets?: ReadonlyMap<HqSectionId, Move> | null;
  onPlay?: (move: Move) => void;
};

/**
 * The Headquarters tile: three sections, each showing the dice standing on it
 * and the slots still open. Not a card, so it does not go through `CardView`.
 */
export function HeadquartersView({ placements, color, targets, onPlay }: Props) {
  return (
    <div>
      <div className={styles.sectionTitle}>Headquarters</div>
      <div className={styles.cardRow}>
        {HQ_SECTIONS.map((section) => {
          const placed = placements[section.id];
          const move = targets?.get(section.id);
          const open = section.slots - placed.length;

          return (
            <div
              key={section.id}
              className={[styles.card, styles.hqSection, move && styles.cardDropTarget]
                .filter(Boolean)
                .join(" ")}
              onDragOver={move ? (event: DragEvent) => event.preventDefault() : undefined}
              onDrop={
                move
                  ? (event: DragEvent) => {
                      event.preventDefault();
                      onPlay?.(move);
                    }
                  : undefined
              }
            >
              <span className={styles.cardHeader}>
                <span className={styles.cardName}>{section.name}</span>
              </span>
              <span className={styles.cardMeta}>
                Takes {describeRequirement(section.accepts)} — {describeHqReward(section.reward)}
              </span>
              <div className={styles.dice}>
                {Array.from({ length: section.slots }, (_, index) => {
                  const face = placed[index];
                  if (face === undefined) {
                    // The first open slot is the one a drop would fill, so it
                    // is the one that lights up.
                    const next = index === placed.length && move;
                    return (
                      <span
                        key={index}
                        className={[styles.die, styles.hqSlot, next && styles.hqSlotActive]
                          .filter(Boolean)
                          .join(" ")}
                      />
                    );
                  }
                  return (
                    <span key={index} className={styles.die} style={DIE_SWATCHES[color]}>
                      {face}
                    </span>
                  );
                })}
              </div>
              <span className={styles.cardTag}>
                {open === 0 ? "full" : `${open} slot${open === 1 ? "" : "s"} open`}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
