"use client";

import {
  HQ_SECTIONS,
  type DieColor,
  type DieFace,
  type HqPlacements,
  type HqSection,
  type HqSectionId,
  type Move,
} from "@/engine";
import { useGrowth } from "@/hooks/useGrowth";
import { DIE_SWATCHES } from "@/lib/colors";
import { SectionFormula } from "./Formula";
import { LandedDie } from "./LandedDie";
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
  /**
   * The `data-drop` the die in hand is aimed at, if any. The slot it names
   * reaches out for the die — which is most of what a player feels as
   * magnetism, and costs nothing but a scale.
   */
  aimed?: string | null;
};

/**
 * One section of the tile: what it pays, the dice standing on it, and the
 * slots still open.
 *
 * Its own component so that it can keep its own count. A die that has just
 * been struck into a slot and one that has been standing there since the
 * second round render identically, and only the section knows which is which —
 * see `useGrowth`.
 */
function Section({
  section,
  placed,
  color,
  move,
  reaching,
}: {
  section: HqSection;
  placed: readonly DieFace[];
  color: DieColor;
  /** The move a drop here would play, or undefined if it would take nothing. */
  move?: Move;
  /** Whether the die in hand is aimed at this section right now. */
  reaching: boolean;
}) {
  const stood = useGrowth(placed.length);
  const open = section.slots - placed.length;

  return (
    <div
      className={[styles.card, styles.hqSection, move && styles.cardDropTarget]
        .filter(Boolean)
        .join(" ")}
      /*
       * Only a section that would actually take the die being held carries
       * this, so a die let go anywhere else finds nothing and springs back.
       * The die reads these itself as it is picked up — it is dragged by
       * Motion, so there is no drop event to listen for.
       */
      data-drop={move ? `hq:${section.id}` : undefined}
    >
      <span className={styles.hqName}>{section.name}</span>
      {/* The same die → payout formula the cards are stamped with. */}
      <span className={styles.cardMeta}>
        <SectionFormula section={section} />
      </span>
      {/*
       * Where sparks come from when a die lands here. On the row of dice
       * rather than the section, because that is the point of contact — and
       * unprefixed by a player because only one Headquarters is ever on
       * screen: the automaton never places a die on its own, and its panel
       * shows a production summary in place of this whole component.
       */}
      <div className={styles.dice} data-hq-id={section.id}>
        {Array.from({ length: section.slots }, (_, index) => {
          const face = placed[index];
          if (face === undefined) {
            // The first open slot is the one a drop would fill, so it is the
            // one that lights up.
            const next = index === placed.length && move;
            return (
              <span
                key={index}
                /*
                 * The spot the die actually ends up in. The section takes the
                 * drop anywhere on it, but the line has to arrive here — see
                 * `measureTargets`.
                 */
                data-lands={next ? "true" : undefined}
                className={[
                  styles.die,
                  styles.hqSlot,
                  next && styles.hqSlotActive,
                  // Only the slot the drop would actually fill reaches out.
                  // The rest of the section stays where it is.
                  next && reaching && styles.hqSlotAimed,
                ]
                  .filter(Boolean)
                  .join(" ")}
              />
            );
          }
          return (
            <LandedDie
              key={index}
              face={face}
              // Anything past what was standing here a render ago has only
              // just been struck in.
              struck={index >= stood}
              className={styles.die}
              style={DIE_SWATCHES[color]}
            />
          );
        })}
      </div>
      <span className={styles.cardTag}>
        {open === 0 ? "full" : `${open} slot${open === 1 ? "" : "s"} open`}
      </span>
    </div>
  );
}

/**
 * The Headquarters tile: three sections, each showing the dice standing on it
 * and the slots still open. Not a card, so it does not go through `CardView`.
 */
export function HeadquartersView({ placements, color, targets, aimed }: Props) {
  return (
    <div>
      <div className={styles.sectionTitle}>Headquarters</div>
      <div className={styles.cardRow}>
        {HQ_SECTIONS.map((section) => (
          <Section
            key={section.id}
            section={section}
            placed={placements[section.id]}
            color={color}
            move={targets?.get(section.id)}
            reaching={aimed === `hq:${section.id}`}
          />
        ))}
      </div>
    </div>
  );
}
