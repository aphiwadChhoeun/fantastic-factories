import type { CSSProperties } from "react";
import type { BlueprintCategory, BlueprintTool, DieColor } from "@/engine";

/**
 * Swatches for the six die colours. Yellow and white take dark pips; the rest
 * take light ones, so every face stays legible in either theme.
 */
export const DIE_SWATCHES: Record<DieColor, CSSProperties> = {
  red: { background: "#c0392b", color: "#ffffff", borderColor: "#e0604f" },
  blue: { background: "#2a6ec9", color: "#ffffff", borderColor: "#5290e8" },
  green: { background: "#2e8b57", color: "#ffffff", borderColor: "#4fb37c" },
  purple: { background: "#7a4bbd", color: "#ffffff", borderColor: "#a077dd" },
  yellow: { background: "#d4a017", color: "#1a1a1a", borderColor: "#ecbe45" },
  white: { background: "#ededed", color: "#1a1a1a", borderColor: "#b9b9b9" },
};

/** Just the fill, for the dot next to a player's name. */
export function colorSwatch(color: DieColor): CSSProperties {
  return { background: DIE_SWATCHES[color].background };
}

/**
 * The four blueprint tool types, colour-coded. Hues are kept clear of each
 * other and carry white text, so the badge reads in either theme.
 */
export const BLUEPRINT_TOOL_SWATCHES: Record<BlueprintTool, CSSProperties> = {
  hammer: { background: "#b85c33", color: "#ffffff" },
  wrench: { background: "#22808a", color: "#ffffff" },
  gear: { background: "#6257b8", color: "#ffffff" },
  shovel: { background: "#6e7f2e", color: "#ffffff" },
};

/** Unicode stand-ins until the real icons exist. */
export const BLUEPRINT_TOOL_GLYPHS: Record<BlueprintTool, string> = {
  hammer: "🔨",
  wrench: "🔧",
  gear: "⚙",
  shovel: "⛏",
};

/**
 * The printed colour of each blueprint type, as the card carries it.
 *
 * Darker and flatter than the tool badges on purpose: this is a band behind
 * a word, while a badge is a glyph the eye has to pick out.
 */
export const BLUEPRINT_CATEGORY_SWATCHES: Record<BlueprintCategory, CSSProperties> = {
  production: { background: "#2a6ec9", color: "#ffffff" },
  utility: { background: "#d4a017", color: "#1a1a1a" },
  training: { background: "#c0392b", color: "#ffffff" },
  monument: { background: "#6b7280", color: "#ffffff" },
  special: { background: "#7a4bbd", color: "#ffffff" },
};
