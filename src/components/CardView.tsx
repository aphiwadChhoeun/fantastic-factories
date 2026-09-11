import { useRef, type PointerEvent } from "react";
import {
  AnimatePresence,
  m,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "motion/react";
import type { Card, DieFace, Resources } from "@/engine";
import {
  BLUEPRINT_CATEGORY_SWATCHES,
  BLUEPRINT_TOOL_GLYPHS,
  BLUEPRINT_TOOL_SWATCHES,
} from "@/lib/colors";
import { describeResources } from "@/lib/format";
import { EffectFormula, PassiveFormula, PerkFormula } from "./Formula";
import { ResourceChip, ResourceChips, ResourceText } from "./Resource";
import styles from "./game.module.css";

function costsResources(cost: Resources): boolean {
  return cost.metal > 0 || cost.energy > 0 || cost.goods > 0;
}

/**
 * How a card crosses the board when it changes hands.
 *
 * A spring rather than a curve, because the overshoot is the point: a card
 * that arrives and settles reads as having mass, and one that eases to a stop
 * reads as a div. Damping below about 28 and it wobbles like rubber.
 */
const TRAVEL = { type: "spring", stiffness: 420, damping: 32, mass: 0.9 } as const;

/**
 * How far a card leans into its own travel.
 *
 * Which cards lean is decided by the board, not here, and that took three
 * goes to get right. `onLayoutAnimationStart` is useless for it: a layout
 * animation fires for *any* change of screen position, and almost none of
 * them are a card going anywhere — drafting re-wraps the market row, a taller
 * hand pushes the opponent's panel down, a scrollbar arrives and the whole
 * board steps sideways. Keyed off that, every card leans whenever anything
 * happens anywhere. Nor can the distance be measured inside the callback: the
 * projection transform has not been written by the time it runs.
 *
 * A prop on the way in does not work either, because a card that crosses
 * lists *unmounts and remounts* — the arriving component has no memory of
 * having been in the market.
 *
 * So the answer comes from the one place that outlives the move: the engine.
 * `lib/events.ts` already says which card was drafted or built, and Game
 * holds that for as long as the travel lasts.
 */
const LEAN_DEGREES = -4;

type Props = {
  card: Card;
  /**
   * This card has just arrived here out of somewhere else — drafted into a
   * hand, or stood up in a compound. The one card that leans into its travel.
   */
  arriving?: boolean;
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
  /** This card just did something — it was built, or its perk fired. */
  flash?: boolean;
};

export function CardView({
  card,
  arriving = false,
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
  flash = false,
}: Props) {
  const faceEl = useRef<HTMLElement | null>(null);
  const reduced = useReducedMotion();
  /** How hard this card is leaning into its travel. Zero unless it is moving. */
  const lean = arriving && !reduced ? LEAN_DEGREES : 0;

  // Where the pointer is over the plate, as -0.5 … 0.5 on each axis.
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  // Sprung, so the plate goes on tilting for a beat after the pointer stops.
  // That lag is the whole difference between a card with mass and a card glued
  // to the cursor.
  const sx = useSpring(px, { stiffness: 300, damping: 22, mass: 0.4 });
  const sy = useSpring(py, { stiffness: 300, damping: 22, mass: 0.4 });

  const rotateY = useTransform(sx, [-0.5, 0.5], [-9, 9]);
  const rotateX = useTransform(sy, [-0.5, 0.5], [7, -7]);
  // The highlight travels against the tilt, the way light does.
  const glareX = useTransform(sx, [-0.5, 0.5], [18, 82]);
  const glareY = useTransform(sy, [-0.5, 0.5], [12, 88]);
  const sheen = useMotionTemplate`radial-gradient(150px 150px at ${glareX}% ${glareY}%, rgb(255 233 200 / 18%), transparent 72%)`;

  function track(event: PointerEvent) {
    if (reduced) return;
    const rect = faceEl.current?.getBoundingClientRect();
    if (!rect) return;
    px.set((event.clientX - rect.left) / rect.width - 0.5);
    py.set((event.clientY - rect.top) / rect.height - 0.5);
  }

  function level() {
    px.set(0);
    py.set(0);
  }

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
        {/*
          * What the card does, as one formula: what it takes, an arrow, what it
          * pays. The price and the payout used to be two sentences on two
          * lines, which read as two separate facts rather than as the one trade
          * they are. The words are still there — on hover, and for a reader.
          */}
        {card.kind === "contractor" ? (
          <EffectFormula effect={card.effect} />
        ) : (
          card.perk && <PerkFormula perk={card.perk} />
        )}
        {/* A passive is not worked: what is left of the arrow is a trigger. */}
        {card.kind === "blueprint" && card.passive && (
          <PassiveFormula passive={card.passive} />
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

  /**
   * Which light the card is wearing. One at a time and in this order, because
   * a card can be several of these at once and the most specific thing the
   * player is being asked is always the one worth saying.
   */
  const glow = selected
    ? styles.glowChosen
    : dropTarget
      ? styles.glowAether
      : highlight
        ? styles.glowSpice
        : null;

  const plate = {
    // A callback ref, so the same one serves a button and a div without
    // either of them having to know which it is.
    ref: (node: HTMLElement | null) => {
      faceEl.current = node;
    },
    className,
    onPointerMove: track,
    onPointerLeave: level,
    // Perspective on the plate itself rather than on the row: a shared
    // vanishing point would make a hand of cards fan like a pop-up book.
    style: { rotateX, rotateY, transformPerspective: 900 },
    /*
     * The smear: the card tips while in flight and unwinds as it settles, on
     * the same spring that is carrying it. Real velocity is not available —
     * Motion writes the layout transform to the slot directly rather than
     * through a MotionValue this could read — so the lean is a flag rather
     * than a measurement. It rides the plate rather than the slot, so it
     * cannot disturb the travel itself.
     *
     * One value, not a keyframe list: a spring only interpolates between a
     * pair, and asking for three throws at animation time — where no
     * typecheck or test will see it.
     *
     * `rotate` is the Z axis and free; the tilt only ever uses X and Y, and
     * `scale` is left alone because hover and tap already own it.
     */
    animate: { rotate: lean },
    whileHover: reduced ? undefined : { scale: 1.03 },
    whileTap: onSelect && !reduced ? { scale: 0.985 } : undefined,
    transition: arriving ? TRAVEL : { duration: 0.08, ease: "easeOut" as const },
  };

  const contents = (
    <>
      {body}
      {!reduced && <m.div className={styles.sheen} style={{ background: sheen }} aria-hidden />}
    </>
  );

  return (
    /*
     * The slot owns the travel, and only the travel. When a card is drafted
     * the engine moves it in one `applyMove` — out of the row, into a hand —
     * which in the DOM is an unmount from one list and a mount in another. A
     * shared `layoutId` is what turns those two events back into one object
     * moving, and the ids the engine deals are unique per copy and stable for
     * the whole game, so there is something honest to key on.
     *
     * Deliberately no `AnimatePresence` around the lists. An exiting copy left
     * behind in the row would share a `layoutId` with the arriving one, and
     * two elements claiming to be the same card is exactly how a shared-layout
     * transition tears.
     *
     * Transform belongs to Motion on this element; the plate inside does its
     * own tilting. That separation is the whole reason there are two.
     */
    <m.div
      className={styles.cardSlot}
      /*
       * Where this card is on screen, for anything that has to point at it
       * without holding a reference to it — sparks off a firing perk, a
       * trajectory line. Fire-and-forget, so it must not keep a card alive or
       * care that one has unmounted.
       */
      data-card-id={card.id}
      /*
       * Whether this card could answer the question currently being asked.
       * Read by the focus pull, which dims everything that could not — the
       * board stops being a dozen cards and becomes the two you are choosing
       * between.
       */
      data-live={highlight || selected || dropTarget ? "true" : undefined}
      /*
       * Somewhere the die being held may land. Only on a card that would
       * actually take it, so a die let go over anything else finds nothing
       * and springs home. PlayerPanel hit-tests for this: the die is dragged
       * by Motion, so there is no drop event for the card to listen for.
       */
      data-drop={dropTarget ? `card:${card.id}` : undefined}
      layoutId={`card:${card.kind}:${card.id}`}
      layout="position"
      transition={TRAVEL}
      // A card in flight has to clear the panels it passes over.
      style={{ zIndex: arriving ? 40 : undefined }}
    >
      {onSelect ? (
        <m.button type="button" onClick={onSelect} aria-label={selectLabel} {...plate}>
          {contents}
        </m.button>
      ) : (
        <m.div {...plate}>{contents}</m.div>
      )}

      {/* Keyed on the light itself, so going from spice to gilt cross-fades. */}
      <AnimatePresence initial={false}>
        {glow && (
          <m.div
            key={glow}
            className={`${styles.glow} ${glow}`}
            aria-hidden
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          />
        )}
      </AnimatePresence>

      {/* Thrown off once by a card that has just been built or just fired. */}
      <AnimatePresence>
        {flash && !reduced && (
          <m.div
            key="flash"
            className={styles.flashRing}
            aria-hidden
            initial={{ opacity: 0.9, scale: 1 }}
            animate={{ opacity: 0, scale: 1.14 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.45, ease: "easeOut" }}
          />
        )}
      </AnimatePresence>
    </m.div>
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
