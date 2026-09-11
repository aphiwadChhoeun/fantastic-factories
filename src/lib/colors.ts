import type { CSSProperties } from "react";
import type { BlueprintCategory, BlueprintTool, DieColor } from "@/engine";

/**
 * What a card pays in and what it pays out. Four things the eye should be able
 * to count without reading: the two you spend, the one you score, and the one
 * that outlasts the concession.
 *
 * Text glyphs rather than emoji, deliberately. An emoji brings its own colour
 * and ignores `color`, and the whole point of these is to be colour-coded.
 */
export type ResourceKind = "metal" | "energy" | "goods" | "prestige";

export const RESOURCE_GLYPHS: Record<ResourceKind, string> = {
  /* An ingot on its side. A hexagon would be nicer and falls back to a circle
   * in too many stacks, which puts it one glyph away from a player's colour. */
  metal: "▰",
  energy: "↯",
  goods: "▣",
  prestige: "✦",
};

export const RESOURCE_COLORS: Record<ResourceKind, string> = {
  metal: "var(--color-res-metal)",
  energy: "var(--color-res-energy)",
  goods: "var(--color-res-goods)",
  prestige: "var(--color-res-standing)",
};

/**
 * Every colour the board wears that is not a UI state. The theme's tokens live
 * in `globals.css`; these are here instead because they are chosen per card and
 * per die, which is a decision a stylesheet cannot make.
 *
 * See docs/theme.md.
 */

/**
 * Swatches for the six crews. Pulled down out of primary hues and into the
 * Rustward's dust so they sit on iron rather than on white: still six clearly
 * different colours, none of them shouting.
 *
 * Yellow and bone take dark pips; the rest take light ones, so every face stays
 * legible.
 */
export const DIE_SWATCHES: Record<DieColor, CSSProperties> = {
  red: { background: "#b5402f", color: "#f2e8df", borderColor: "#d4664f" },
  blue: { background: "#2f6fa8", color: "#f2e8df", borderColor: "#5a9bd1" },
  green: { background: "#3e8c63", color: "#f2e8df", borderColor: "#63b589" },
  purple: { background: "#6c4aa6", color: "#f2e8df", borderColor: "#9375ce" },
  yellow: { background: "#c99a22", color: "#17140f", borderColor: "#e8bc4a" },
  // Bone, not white. Nothing out here stays white for long.
  white: { background: "#d6d3c9", color: "#17140f", borderColor: "#a9a69c" },
};

/** Just the fill, for the dot next to a player's name. */
export function colorSwatch(color: DieColor): CSSProperties {
  return { background: DIE_SWATCHES[color].background };
}

/**
 * The four guild marks, colour-coded. Hues are kept clear of each other and
 * carry parchment text, so the badge reads against the iron behind it.
 */
export const BLUEPRINT_TOOL_SWATCHES: Record<BlueprintTool, CSSProperties> = {
  hammer: { background: "#a94e28", color: "#e8dcc0" },
  wrench: { background: "#1e6f79", color: "#e8dcc0" },
  gear: { background: "#5a4fa3", color: "#e8dcc0" },
  shovel: { background: "#6b7a2b", color: "#e8dcc0" },
};

/** Unicode stand-ins until the real icons exist. */
export const BLUEPRINT_TOOL_GLYPHS: Record<BlueprintTool, string> = {
  hammer: "🔨",
  wrench: "🔧",
  gear: "⚙",
  shovel: "⛏",
};

/**
 * The printed colour of each blueprint type, as the plate carries it.
 *
 * Darker and flatter than the guild marks on purpose: this is a band behind a
 * word, while a mark is a glyph the eye has to pick out. Monuments are basalt —
 * the one type that is deliberately colourless, because what it is worth is
 * written in gilt elsewhere.
 */
export const BLUEPRINT_CATEGORY_SWATCHES: Record<BlueprintCategory, CSSProperties> = {
  production: { background: "#2c5d8a", color: "#e8dcc0" },
  utility: { background: "#b8862b", color: "#17140f" },
  training: { background: "#a33b2e", color: "#e8dcc0" },
  monument: { background: "#6e6a63", color: "#e8dcc0" },
  special: { background: "#6b4e9e", color: "#e8dcc0" },
};
