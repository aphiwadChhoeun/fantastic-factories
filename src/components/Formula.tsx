import { Fragment, type ReactNode } from "react";
import type {
  ActivationRequirement,
  BlueprintPerk,
  Effect,
  HqReward as HqRewardKind,
  HqSection,
  Passive,
  Resources,
} from "@/engine";
import {
  describeEffect,
  describeHqReward,
  describePassive,
  describePerkCost,
  describeRequirement,
} from "@/lib/format";
import { BLUEPRINT_GLYPH } from "@/lib/colors";
import { ResourceChip, ResourceChips } from "./Resource";
import styles from "./game.module.css";

/**
 * What a card does, drawn rather than written.
 *
 * A card face is read a dozen times a round and at a glance, and a sentence is
 * the wrong shape for that: "Work: 2 matching dice + 5 energy — Gain 2 goods,
 * 1 metal" is nine words for something that is really a price, an arrow, and a
 * payout. So the price is drawn as the dice it wants, the arrow says which way
 * the trade runs, and the payout is the same resource chips the player already
 * counts everywhere else on the board.
 *
 * The sentences are not thrown away. Every formula carries one as its `title`
 * and again for a screen reader, so the words are always a hover away and the
 * symbols never have to carry someone who cannot read them. That is also why
 * `lib/format.ts` is untouched — the log and the move list still speak prose.
 *
 * A handful of effects resist a glyph entirely (which card's cost, whose face
 * is chosen). Those get a short uppercase note instead of a worse pictogram.
 */

/**
 * A die whose face is not pinned down: one the perk will take at any value,
 * or one it hands over before anything has been rolled. Drawn as a `?` rather
 * than left empty — an empty square is what an *unfilled socket* looks like in
 * the card footer and on the Headquarters, and a die that takes anything is
 * the opposite of one that has nothing on it yet.
 */
const ANY_FACE = "?";

/** What a single die must show, in the die's own shape. */
function requirementMark(accepts: ActivationRequirement): string {
  switch (accepts.kind) {
    case "any":
      return ANY_FACE;
    case "exact":
      return String(accepts.face);
    case "atLeast":
      return `${accepts.face}+`;
    case "atMost":
      return `≤${accepts.face}`;
  }
}

/**
 * One die: a slot the size and shape of the real thing, stamped with what it
 * will take. On the paying side it is a die the perk demands; on the other
 * side of the arrow it is one the perk hands over.
 */
function DieSlot({ accepts }: { accepts?: ActivationRequirement }) {
  const mark = accepts ? requirementMark(accepts) : ANY_FACE;
  return (
    <span className={`${styles.pip} ${mark === ANY_FACE ? styles.pipAny : ""}`}>{mark}</span>
  );
}

/** A die and how many of them — the chip layout, with a die for a glyph. */
function DiceToken({ amount }: { amount: number }) {
  return (
    <span className={styles.chip}>
      <DieSlot />
      <span className={styles.chipCount}>{amount}</span>
    </span>
  );
}

/** A blueprint, as the plate it is. The count sits beside it like a chip's. */
function CardToken({ amount }: { amount?: number }) {
  return (
    <span className={styles.chip} style={{ color: "var(--color-res-card)" }}>
      <span className={styles.blueprintGlyph} aria-hidden="true">
        {BLUEPRINT_GLYPH}
      </span>
      {amount !== undefined && <span className={styles.chipCount}>{amount}</span>}
    </span>
  );
}

/** The relation between two symbols: matching dice, a run, a choice. */
function Op({ children }: { children: ReactNode }) {
  return <span className={styles.op}>{children}</span>;
}

/** The last resort: a word, when no glyph says it honestly. */
function Note({ children }: { children: ReactNode }) {
  return <span className={styles.note}>{children}</span>;
}

/** Symbols side by side, with the same mark between each pair. */
function joined(parts: ReactNode[], separator: ReactNode): ReactNode {
  return parts.map((part, index) => (
    <Fragment key={index}>
      {index > 0 && separator}
      {part}
    </Fragment>
  ));
}

/** A partial gain, filled out so the chips can be counted off it. */
function whole(resources: Partial<Resources>): Resources {
  return {
    metal: resources.metal ?? 0,
    energy: resources.energy ?? 0,
    goods: resources.goods ?? 0,
  };
}

/**
 * The dice a perk asks for. The pattern is a rule *between* them, so it is
 * drawn between them: `=` for a set that must match, `+1` for a run with no
 * gaps. A floor on the total rides along as a sum.
 */
function Dice({ perk }: { perk: BlueprintPerk }) {
  const slots = Array.from({ length: perk.dice }, (_, index) => (
    <DieSlot key={index} accepts={perk.accepts} />
  ));
  const between =
    perk.pattern === "matching" ? <Op>=</Op> : perk.pattern === "consecutive" ? <Op>+1</Op> : null;

  return (
    <span className={styles.group}>
      {between ? joined(slots, between) : slots}
      {perk.minTotal !== undefined && <Op>Σ{perk.minTotal}+</Op>}
    </span>
  );
}

/** Everything a perk charges: dice, cards out of hand, then stock. */
function PerkCost({ perk }: { perk: BlueprintPerk }) {
  const parts: ReactNode[] = [];

  if (perk.dice > 0) parts.push(<Dice perk={perk} />);
  if (perk.discardsCards) parts.push(<CardToken amount={perk.discardsCards} />);
  if (perk.cost.metal > 0 || perk.cost.energy > 0 || perk.cost.goods > 0) {
    parts.push(
      <span className={styles.group}>
        <ResourceChips resources={perk.cost} />
      </span>,
    );
  }
  // A price read off a face cannot be a number yet, so it is written as the
  // equation it is: this resource, equal to that die.
  if (perk.costByFace) {
    parts.push(
      <span className={styles.group}>
        <ResourceChip kind={perk.costByFace} />
        <Op>=</Op>
        <DieSlot />
      </span>,
    );
  }

  if (parts.length === 0) return <Note>free</Note>;
  return <>{joined(parts, <Op>+</Op>)}</>;
}

/** What comes back out. Returns bare symbols, so it can nest inside itself. */
function EffectSymbols({ effect }: { effect: Effect }): ReactNode {
  switch (effect.kind) {
    case "gain":
      return <ResourceChips resources={whole(effect.resources)} />;
    case "draw":
      return <CardToken amount={effect.count} />;
    case "buildFromDeck":
      return (
        <>
          <CardToken />
          <Note>built free</Note>
        </>
      );
    case "revealForResources":
      return (
        <>
          <ResourceChip kind="metal" />
          <ResourceChip kind="energy" />
          <Note>top card&rsquo;s cost</Note>
        </>
      );
    case "gainCardCost":
      return (
        <>
          <ResourceChip kind="metal" />
          <ResourceChip kind="energy" />
          <Note>burnt cost, max {effect.max}</Note>
        </>
      );
    case "chooseOwnFaces":
      return (
        <>
          <DiceToken amount={effect.count} />
          <Note>set, not rolled</Note>
        </>
      );
    case "extraDice":
      return (
        <>
          <DiceToken amount={effect.count} />
          <Note>{effect.chosen ? "any face" : "rolled"}</Note>
        </>
      );
    case "gainDie":
      return (
        <>
          <DiceToken amount={1} />
          <Note>any face</Note>
        </>
      );
    case "rollDie":
      return (
        <>
          <DiceToken amount={1} />
          <Note>rolled</Note>
        </>
      );
    // The three that hand a die back to the table rather than spending it. The
    // glyph is the change; the note says how far it reaches.
    case "flipDie":
      return (
        <>
          <DieSlot />
          <Op>⇅</Op>
          <Note>opposite face</Note>
        </>
      );
    case "stepDie":
      return (
        <>
          <DieSlot />
          <Op>
            {effect.by < 0 ? "−" : "+"}
            {Math.abs(effect.by)}
          </Op>
        </>
      );
    case "rerollDice":
      return (
        <>
          <DieSlot />
          <Op>⟳</Op>
          <Note>any number</Note>
        </>
      );
    case "gainByFace":
      return (
        <>
          <ResourceChip kind={effect.resource} />
          <Op>=</Op>
          <DieSlot />
        </>
      );
    case "borrowFromMarket":
      return (
        <>
          <CardToken />
          <Note>copy a market perk</Note>
        </>
      );
    // Everything in turn, versus one of several. Two different marks, because
    // mistaking one for the other is the difference between four metal and
    // four metal *and* seven energy.
    case "all":
      return joined(
        effect.effects.map((part, index) => (
          <span key={index} className={styles.group}>
            <EffectSymbols effect={part} />
          </span>
        )),
        <Op>+</Op>,
      );
    case "oneOf":
      return joined(
        effect.options.map((option, index) => (
          <span key={index} className={styles.group}>
            <EffectSymbols effect={option} />
          </span>
        )),
        <Op>/</Op>,
      );
    // Which band pays is decided by the die already placed, so each band is
    // drawn as the face that triggers it followed by what it is worth.
    case "byFace":
      return joined(
        effect.bands.map((band, index) => (
          <span key={index} className={styles.group}>
            <DieSlot accepts={band.accepts} />
            <EffectSymbols effect={band.effect} />
          </span>
        )),
        <Op>/</Op>,
      );
  }
}

/** The symbols, plus the sentence they stand for — on hover and for a reader. */
function Formula({ sentence, children }: { sentence: string; children: ReactNode }) {
  return (
    <span className={styles.formula} title={sentence}>
      <span className={styles.formulaGlyphs} aria-hidden="true">
        {children}
      </span>
      <span className={styles.srOnly}>{sentence}</span>
    </span>
  );
}

/** A built blueprint's perk: what it takes, an arrow, what it pays. */
export function PerkFormula({ perk }: { perk: BlueprintPerk }) {
  return (
    <Formula sentence={`Work: ${describePerkCost(perk)} — ${describeEffect(perk.effect)}`}>
      <PerkCost perk={perk} />
      <span className={styles.arrow}>→</span>
      <EffectSymbols effect={perk.effect} />
    </Formula>
  );
}

/**
 * A contractor's effect. Nothing on the left of the arrow: what a contractor
 * costs is its slot's token, which is stamped above the card rather than on
 * it, so the arrow is left dangling on purpose — it says "this is what you
 * get" in the same mark the rest of the board uses for it.
 */
export function EffectFormula({ effect }: { effect: Effect }) {
  return (
    <Formula sentence={describeEffect(effect)}>
      <span className={styles.arrow}>→</span>
      <EffectSymbols effect={effect} />
    </Formula>
  );
}

/**
 * An ability that fires by itself. The arrow still runs the same way, but what
 * is on the left is a trigger rather than a price — and a trigger is a moment,
 * which no glyph says, so it is named.
 */
export function PassiveFormula({ passive }: { passive: Passive }) {
  return (
    <Formula sentence={describePassive(passive)}>
      {passive.kind === "cheaperPerCard" ? (
        <>
          <Note>to build</Note>
          <span className={styles.arrow}>→</span>
          {/* The minus belongs to the chip: a discount, not a subtraction. */}
          <span className={styles.group}>
            <Op>−</Op>
            <ResourceChip kind="metal" amount={1} />
          </span>
          <Note>per {passive.per} standing</Note>
        </>
      ) : (
        <>
          {passive.kind === "drawOnGoods" ? (
            <span className={styles.group}>
              <ResourceChip kind="goods" />
              <Note>first each round</Note>
            </span>
          ) : (
            <span className={styles.group}>
              <CardToken />
              <Note>each other build</Note>
            </span>
          )}
          <span className={styles.arrow}>→</span>
          {passive.kind === "drawOnGoods" ? (
            <CardToken amount={1} />
          ) : (
            <ResourceChips resources={whole(passive.resources)} />
          )}
        </>
      )}
    </Formula>
  );
}

/**
 * A Headquarters section's rule, in the same language as a card's. The tile is
 * not a card and never goes through `CardView`, but it is read off the same
 * board in the same glance, so it is stamped the same way: one die, an arrow,
 * what that die is worth.
 */
export function SectionFormula({ section }: { section: HqSection }) {
  return (
    <Formula
      sentence={`Takes ${describeRequirement(section.accepts)} — ${describeHqReward(
        section.reward,
      )}`}
    >
      <DieSlot accepts={section.accepts} />
      <span className={styles.arrow}>→</span>
      <HqReward reward={section.reward} />
    </Formula>
  );
}

/** What one die on a section pays, before any matching bonus. */
function HqReward({ reward }: { reward: HqRewardKind }) {
  switch (reward.kind) {
    case "drawBlueprint":
      return <CardToken amount={1} />;
    case "energyByFace":
      return (
        <>
          <ResourceChip kind="energy" />
          <Op>=</Op>
          <DieSlot />
        </>
      );
    case "gain":
      return <ResourceChips resources={whole(reward.resources)} />;
  }
}
