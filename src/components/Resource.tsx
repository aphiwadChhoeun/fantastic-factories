import { useEffect, useRef, useState, type ReactNode } from "react";
import { animate, AnimatePresence, m, useMotionValue, useTransform } from "motion/react";
import type { Resources } from "@/engine";
import { RESOURCE_COLORS, RESOURCE_GLYPHS, type ResourceKind } from "@/lib/colors";
import styles from "./game.module.css";

/**
 * Resources, shown rather than spelled.
 *
 * Everything in `lib/format.ts` stays a string on purpose — the log, the move
 * buttons and every `aria-label` read the same sentences, and a React node
 * cannot be any of those. So the highlighting happens here, on the way to the
 * screen, and the sentence underneath is never touched.
 */

/**
 * A number that counts to its new value instead of jumping to it.
 *
 * Cheap, and it does more for how finished the game feels than anything else
 * this size. Every count on the board is already `tabular-nums`, so nothing
 * reflows on the way past 9.
 */
export function Rolling({ value }: { value: number }) {
  const shown = useMotionValue(value);
  const text = useTransform(shown, (v) => Math.round(v).toString());
  // What the number was last asked to be, so a re-render for some other
  // reason does not re-roll a number that has not moved.
  const known = useRef(value);

  useEffect(() => {
    if (known.current === value) return;
    known.current = value;
    animate(shown, value, { duration: 0.42, ease: [0.16, 1, 0.3, 1] });
  }, [shown, value]);

  return <m.span>{text}</m.span>;
}

/** One count, in its own colour: the glyph, then the number. */
export function ResourceChip({
  kind,
  amount,
  title,
  track = false,
}: {
  kind: ResourceKind;
  /** Omitted when the card says "energy equal to the die" and means it. */
  amount?: number;
  title?: string;
  /**
   * Whether this count is a running total rather than a printed price. Only a
   * total rolls and only a total announces its change: a build cost that
   * "gained 1 metal" because a Monument went up would be nonsense.
   */
  track?: boolean;
}) {
  /** The last change, while it is still worth showing. Keyed, so two in a row both land. */
  const [pop, setPop] = useState<{ by: number; id: number } | null>(null);
  const known = useRef(amount);
  const nextId = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    if (!track || amount === undefined) return;
    const by = amount - (known.current ?? 0);
    known.current = amount;
    if (by === 0) return;

    setPop({ by, id: nextId.current++ });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setPop(null), 620);
  }, [amount, track]);

  return (
    <span
      className={styles.chip}
      style={{ color: RESOURCE_COLORS[kind] }}
      title={title ?? (amount === undefined ? kind : `${amount} ${kind}`)}
    >
      {/*
        * The glyph swells as the count changes. Keyframes, so this has to be a
        * tween — a spring only interpolates between a pair of values.
        */}
      <m.span
        className={styles.chipGlyph}
        aria-hidden="true"
        animate={pop ? { scale: [1, 1.35, 1] } : { scale: 1 }}
        transition={{ duration: 0.42, ease: "easeOut" }}
      >
        {RESOURCE_GLYPHS[kind]}
      </m.span>
      {amount !== undefined && (
        <span className={styles.chipCount}>{track ? <Rolling value={amount} /> : amount}</span>
      )}

      {/*
        * What just changed, rising out of the chip. Green for coming in and
        * ember for going out — the only two colours in the theme that are not
        * already spoken for, and the chip itself keeps its resource colour so
        * nothing about the coding is muddied.
        */}
      <AnimatePresence>
        {pop && (
          <m.span
            key={pop.id}
            className={`${styles.delta} ${pop.by > 0 ? styles.deltaUp : styles.deltaDown}`}
            aria-hidden="true"
            // Centring lives in the transform Motion owns, not in CSS, or the
            // two would fight and the label would drift off to the left.
            style={{ x: "-50%" }}
            initial={{ opacity: 0, y: 2 }}
            animate={{ opacity: 1, y: -13 }}
            exit={{ opacity: 0, y: -19 }}
            transition={{ duration: 0.42, ease: "easeOut" }}
          >
            {pop.by > 0 ? `+${pop.by}` : pop.by}
          </m.span>
        )}
      </AnimatePresence>

      <span className={styles.srOnly}>{amount === undefined ? kind : `${amount} ${kind}`}</span>
    </span>
  );
}

/**
 * A price, as chips. Nothing is shown for a resource the card does not ask
 * for — a row of zeroes is three things to read that say nothing.
 */
export function ResourceChips({
  resources,
  free,
}: {
  resources: Resources;
  /** What to say when the price is nothing at all. Usually there is nothing to say. */
  free?: string;
}) {
  // Prestige is scored, not spent, so it is never part of a price.
  const parts: Exclude<ResourceKind, "prestige">[] = [];
  if (resources.metal > 0) parts.push("metal");
  if (resources.energy > 0) parts.push("energy");
  if (resources.goods > 0) parts.push("goods");

  if (parts.length === 0) {
    return free ? <span className={styles.chipFree}>{free}</span> : null;
  }

  return (
    <>
      {parts.map((kind) => (
        <ResourceChip key={kind} kind={kind} amount={resources[kind]} />
      ))}
    </>
  );
}

/**
 * Every resource named in a sentence, lit up where it stands. The count comes
 * with it when there is one, so "Gain 2 metal, 1 energy" keeps its grammar and
 * still reads as two prices.
 */
const MENTION = /(\d+\s+)?(metal|energy|goods|prestige)\b/gi;

export function ResourceText({ children }: { children: string }) {
  const parts: ReactNode[] = [];
  let cursor = 0;

  for (const match of children.matchAll(MENTION)) {
    const at = match.index;
    if (at > cursor) parts.push(children.slice(cursor, at));

    const [whole, count, word] = match;
    parts.push(
      <span
        key={at}
        className={styles.mention}
        style={{ color: RESOURCE_COLORS[word.toLowerCase() as ResourceKind] }}
      >
        <span className={styles.chipGlyph} aria-hidden="true">
          {RESOURCE_GLYPHS[word.toLowerCase() as ResourceKind]}
        </span>
        {count?.trim()}
        {count ? " " : ""}
        {word}
      </span>,
    );
    cursor = at + whole.length;
  }

  if (cursor === 0) return <>{children}</>;
  if (cursor < children.length) parts.push(children.slice(cursor));
  return <>{parts}</>;
}
