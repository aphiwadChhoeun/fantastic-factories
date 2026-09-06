import { HQ_SECTIONS, type DieColor, type HqPlacements } from "@/engine";
import { DIE_SWATCHES } from "@/lib/colors";
import { describeHqReward, describeRequirement } from "@/lib/format";
import styles from "./game.module.css";

type Props = {
  placements: HqPlacements;
  /** Empty slots are drawn in the player's colour, faintly. */
  color: DieColor;
};

/**
 * The Headquarters tile: three sections, each showing the dice standing on it
 * and the slots still open. Not a card, so it does not go through `CardView`.
 */
export function HeadquartersView({ placements, color }: Props) {
  return (
    <div>
      <div className={styles.sectionTitle}>Headquarters</div>
      <div className={styles.cardRow}>
        {HQ_SECTIONS.map((section) => {
          const placed = placements[section.id];
          return (
            <div key={section.id} className={`${styles.card} ${styles.hqSection}`}>
              <span className={styles.cardHeader}>
                <span className={styles.cardName}>{section.name}</span>
              </span>
              <span className={styles.cardMeta}>
                Takes {describeRequirement(section.accepts)} — {describeHqReward(section.reward)}
              </span>
              <div className={styles.dice}>
                {Array.from({ length: section.slots }, (_, index) => {
                  const face = placed[index];
                  return face === undefined ? (
                    <span key={index} className={`${styles.die} ${styles.hqSlot}`} />
                  ) : (
                    <span key={index} className={styles.die} style={DIE_SWATCHES[color]}>
                      {face}
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
