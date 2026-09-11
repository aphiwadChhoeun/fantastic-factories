import type { HqSectionId } from "@/engine";
import { emitBurst, type Burst } from "./bus";
import { anchorOf, type Edge } from "./screen";

/** A burst, less the position, which comes from whatever it is thrown off. */
type Shape = Omit<Burst, "x" | "y" | "color"> & {
  /** Which edge of the element to throw from. */
  readonly edge: Edge;
  /** A custom property to read the colour out of, so the theme still owns it. */
  readonly token: string;
};

/**
 * Sparks off something on the page, found in the DOM.
 *
 * Found rather than passed in, because the emitter is fire-and-forget: it must
 * not keep an element alive, must not care whether one has since unmounted,
 * and must not require everything that might ever spark to register itself on
 * mount in case it does. A missing element is a missed spark, which is the
 * correct outcome.
 */
function burstFrom(selector: string, { edge, token, ...rest }: Shape): void {
  const element = document.querySelector(selector);
  if (!element) return;

  // Read the colour off the element rather than hardcoding it, so a reskin
  // takes the sparks with it instead of leaving them the one thing on screen
  // still wearing the old palette.
  const color = getComputedStyle(element).getPropertyValue(token).trim();

  emitBurst({
    ...anchorOf(element, edge),
    ...rest,
    // An empty string is a token that did not resolve, and is not a colour.
    color: color || undefined,
  });
}

/**
 * A factory paying out: a hot upward fountain off the base of the plate, as
 * though the machine inside had just run.
 */
export function burstFromCard(cardId: string, goods: number): void {
  burstFrom(`[data-card-id="${CSS.escape(cardId)}"]`, {
    edge: "bottom",
    // Goods are thrown in the colour goods are counted in everywhere else; a
    // perk that pays anything else throws plain hot metal.
    token: goods > 0 ? "--color-res-goods" : "--color-spice-400",
    // A bigger payout throws more sparks, up to a point — a big run should
    // read as "a lot", not as a house fire.
    count: Math.min(14 + goods * 5, 56),
  });
}

/**
 * A die landing in a Headquarters slot. Deliberately unlike the above: fewer
 * sparks, thrown much wider and a little harder, so it reads as something
 * struck rather than something produced.
 *
 * Aether, because that is already the board's word for *the die you are
 * holding lands here* — the slot glows aether while you drag, so the landing
 * finishes a sentence the drag started.
 */
export function burstFromHq(section: HqSectionId): void {
  burstFrom(`[data-hq-id="${section}"]`, {
    edge: "center",
    token: "--color-aether-400",
    count: 12,
    // Near flat: an impact sprays sideways where a fountain goes up.
    spread: 1.15,
    speed: 210,
  });
}
