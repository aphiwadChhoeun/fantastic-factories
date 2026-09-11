import { HQ_SECTIONS, type DieColor, type HqPlacements, type HqSectionId, type Move } from "@/engine";
import { DIE_SWATCHES } from "@/lib/colors";
import { SectionFormula } from "./Formula";
import styles from "./game.module.css";

type Props = {
  placements: HqPlacements;
  /** Placed dice are drawn in the player's colour. */
  color: DieColor;
  /**
   * Sections that will take the die being held, and the move that does it.
   * Used to light them and to mark them as somewhere the die may land — the
   * drop itself is resolved by PlayerPanel, which owns the gesture.
   */
  targets?: ReadonlyMap<HqSectionId, Move> | null;
};

/**
 * The Headquarters tile: three sections, each showing the dice standing on it
 * and the slots still open. Not a card, so it does not go through `CardView`.
 */
export function HeadquartersView({ placements, color, targets }: Props) {
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
              /*
               * Only a section that would actually take the die being held
               * carries this, so a die let go anywhere else finds nothing and
               * springs back. PlayerPanel hit-tests for it — the die is
               * dragged by Motion, so there is no drop event to listen for.
               */
              data-drop={move ? `hq:${section.id}` : undefined}
            >
              <span className={styles.hqName}>{section.name}</span>
              {/* The same die → payout formula the cards are stamped with. */}
              <span className={styles.cardMeta}>
                <SectionFormula section={section} />
              </span>
              {/*
               * Where sparks come from when a die lands here. On the row of
               * dice rather than the section, because that is the point of
               * contact — and unprefixed by a player because only one
               * Headquarters is ever on screen: the automaton never places a
               * die on its own, and its panel shows a production summary in
               * place of this whole component.
               */}
              <div className={styles.dice} data-hq-id={section.id}>
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
