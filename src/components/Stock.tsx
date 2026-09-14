"use client";

import { prestigeFor, scoreOf, type Player } from "@/engine";
import { ResourceChip, Rolling } from "./Resource";
import styles from "./game.module.css";

/**
 * What a player is holding, in one line of glyphs: their stock, how much they
 * have built, and the only number that decides anything.
 *
 * Its own component because it is wanted in two places that are nowhere near
 * each other — your own goes in the action bar, where it is on screen whatever
 * the table is doing, and an opponent's goes in their strip. Printing the same
 * four chips twice on one screen would read as a bug, so yours appears in the
 * bar and nowhere else.
 */
export function Stock({ player }: { player: Player }) {
  const automaton = player.isAi;

  return (
    <span className={styles.resourceBar}>
      {/* The automaton buys nothing, so it is never dealt anything to buy with. */}
      {!automaton && (
        <>
          <ResourceChip kind="metal" amount={player.resources.metal} track />
          <ResourceChip kind="energy" amount={player.resources.energy} track />
        </>
      )}
      <ResourceChip kind="goods" amount={player.resources.goods} track />
      <ResourceChip kind="prestige" amount={prestigeFor(player)} track />
      <span className={styles.chipFree}>{player.compound.length} built</span>
      <strong
        className={styles.score}
        title={
          automaton
            ? "Goods, plus a point a card and another for each Monument"
            : "Goods plus prestige standing"
        }
      >
        <Rolling value={scoreOf(player)} />
      </strong>
    </span>
  );
}
