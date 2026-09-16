"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { Player } from "@/engine";
import { emitRoll } from "@/dice/bus";
import { useGrowth } from "@/hooks/useGrowth";
import { DraggableDie } from "./DraggableDie";
import styles from "./game.module.css";

/**
 * Everything a tray needs to be played from. Absent for one nobody can act on
 * — an opponent's strip, or your own while the automaton is thinking.
 */
export type TrayInteraction = {
  /** Dice with somewhere to go. Anything else is not worth picking up. */
  readonly movableDice: ReadonlySet<string>;
  /** The die under the cursor right now, if one is being carried. */
  readonly dragging: string | null;
  /**
   * How far a die may be carried. The tray is a strip at the foot of the
   * screen and everything a die is spent on is above it, so the bounds are the
   * page rather than the box the dice sit in.
   */
  readonly bounds: RefObject<HTMLElement | null>;
  readonly onPick: (dieId: string) => void;
  /** The `data-drop` the die is aimed at, so the board can light it up. */
  readonly onAim: (drop: string | null) => void;
  /** Let go. The drop is null if the die was let go at nothing. */
  readonly onRelease: (drop: string | null) => void;
};

type Props = {
  player: Player;
  /**
   * What the row of dice sits in, on top of being a row of dice. Empty for a
   * tray that is simply part of a panel; the one in the bar is a well.
   */
  className?: string;
  /**
   * What to say before there are any dice. Omitted where the tray is one thing
   * among several on a line and an absence explains itself — the bar, where
   * the plate beside it says `Roll dice`.
   */
  empty?: string;
  /**
   * The patch of screen a throw may scatter across, when the dice are
   * simulated rather than keyframed — see docs/dice.md §2.1. Your own dice
   * come to rest in the bar, which is far too thin to roll anything across, so
   * what they are thrown over is the table above it; an opponent's is their
   * own strip, as it always was.
   */
  within: RefObject<HTMLElement | null>;
  interaction?: TrayInteraction;
};

/**
 * The dice on the table, however they came to be there.
 *
 * Its own component because the crew is wanted in two places that are nowhere
 * near each other — yours lives in the action bar, where it is on screen
 * whatever the table is doing, and an opponent's lives in their strip. The
 * throw travels with it: which handful was rolled, and whether it was rolled
 * at all, is a question only the tray holding them can answer.
 */
export function DiceTray({ player, className, empty, within, interaction }: Props) {
  /** How many dice were on the table a render ago. Anything past that is new. */
  const inTray = useGrowth(player.dice.length);
  /*
   * ...and whether enough of them arrived together to have been rolled.
   *
   * A handful comes down at once; a die that turns up on its own is as likely
   * to have been *chosen* as thrown — a Foreman picks a face and never rolls
   * it — and docs/dice.md §0 is blunt about which mistake matters: a dice
   * system that only knows how to throw has nothing to show for a die that
   * was placed. So a lone arrival is left to fade in, and the cost is that a
   * contractor's single extra die fades when it should have been thrown.
   *
   * Nothing to read off the board can do better. A chosen die and a rolled one
   * are the same die by the time the move is over.
   */
  const rolled = player.dice.length - inTray >= 2;
  /** The last handful this tray asked to have thrown, so it asks only once. */
  const asked = useRef("");

  /*
   * Hand the throw to the physics canvas, if there is one listening.
   *
   * Nothing here knows whether there is: `emitRoll` is dropped on the floor
   * when the flag is off, the chunk has not loaded, or the player has asked
   * for less motion, and the dice throw themselves in the DOM instead.
   */
  useEffect(() => {
    if (!rolled) return;
    const fresh = player.dice.slice(inTray);
    const key = fresh.map((die) => die.id).join(",");
    // `rolled` stays true for the rest of the round, so without this a die
    // being spent would be read as the whole handful being thrown again.
    if (!key || key === asked.current) return;
    asked.current = key;

    const box = within.current?.getBoundingClientRect();
    if (!box) return;
    emitRoll({
      dice: fresh.map((die) => ({ id: die.id, face: die.face, color: die.color })),
      within: { left: box.left, top: box.top, width: box.width, height: box.height },
    });
  }, [rolled, player.dice, inTray, within]);

  /*
   * A word, or nothing at all — but never an empty row.
   *
   * The component itself stays mounted the whole time, and has to: how many
   * dice there were a render ago is the only way to tell a handful being
   * thrown from a handful restored out of `localStorage`, and a tray that
   * mounts with four dice already in it has no history to read that off. So
   * the caller may drop the dice, never the tray.
   */
  if (player.dice.length === 0) {
    return empty ? <p className={styles.empty}>{empty}</p> : null;
  }

  return (
    <div className={[styles.dice, className].filter(Boolean).join(" ")}>
      {player.dice.map((die, index) => (
        <DraggableDie
          key={die.id}
          die={die}
          movable={interaction?.movableDice.has(die.id) ?? false}
          held={interaction?.dragging === die.id}
          index={index}
          thrown={index >= inTray && rolled}
          bounds={interaction?.bounds ?? within}
          onPick={() => interaction?.onPick(die.id)}
          onAim={(drop) => interaction?.onAim(drop)}
          onRelease={(drop) => interaction?.onRelease(drop)}
        />
      ))}
    </div>
  );
}
