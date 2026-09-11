import type { ReactNode } from "react";
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

/** One count, in its own colour: the glyph, then the number. */
export function ResourceChip({
  kind,
  amount,
  title,
}: {
  kind: ResourceKind;
  /** Omitted when the card says "energy equal to the die" and means it. */
  amount?: number;
  title?: string;
}) {
  return (
    <span
      className={styles.chip}
      style={{ color: RESOURCE_COLORS[kind] }}
      title={title ?? (amount === undefined ? kind : `${amount} ${kind}`)}
    >
      <span className={styles.chipGlyph} aria-hidden="true">
        {RESOURCE_GLYPHS[kind]}
      </span>
      {amount !== undefined && <span className={styles.chipCount}>{amount}</span>}
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
