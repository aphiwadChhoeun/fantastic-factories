"use client";

import { useState, type RefObject } from "react";
import type { GameState, Move, Player } from "@/engine";
import { useDismissible } from "@/hooks/useDismissible";
import { describeMove, moveKey } from "@/lib/format";
import { DiceTray, type TrayInteraction } from "./DiceTray";
import { PlateButton } from "./PlateButton";
import { Stock } from "./Stock";
import styles from "./game.module.css";

/**
 * Whether a move has anything on the board to point at.
 *
 * Almost everything does: a card is drafted by clicking it, a die is dragged
 * onto the thing it works. These three are what is left over — the turn
 * itself, and the faces a Foreman or a Specialist names before there is a die
 * on the table to name them with. They have no home on the table, so the bar
 * is their home.
 */
function isBarMove(move: Move): boolean {
  return move.type === "rollDice" || move.type === "endPhase" || move.type === "setDie";
}

type Props = {
  state: GameState;
  /** Whoever is holding the screen, for the stock at the near end of the bar. */
  you: Player;
  /**
   * Your crew, and what can be done with it. The tray is here rather than on
   * the panel because the bar is the one strip of screen that never moves and
   * is never covered — see `.barTray`.
   */
  tray?: TrayInteraction;
  /** The table, which is the patch a throw is allowed to scatter across. */
  within: RefObject<HTMLElement | null>;
  moves: readonly Move[];
  /**
   * True while the opponent is deciding. The list is hidden rather than
   * disabled — these would be the AI's moves, and they reveal its hand.
   */
  waiting: boolean;
  onPlay: (move: Move) => void;
  /** Whether the market is on the table, for the plate at the far end. */
  marketOpen: boolean;
  /**
   * Folds the market away, and back. Absent while the market is being asked
   * something and so cannot be folded away — a Replicator waiting to be told
   * which blueprint to copy.
   */
  onToggleMarket?: () => void;
  /** The way back to a result that has been waved away. Absent unless there is one. */
  onShowResult?: () => void;
};

/**
 * The bar across the bottom: the moves that are not a card or a die, and the
 * plate that puts the market on the table.
 *
 * Everything still legal is reachable from here, not just the three plates in
 * the middle. The rest is behind `All moves`, which is the same faithful view
 * of `legalMoves` the sidebar used to hold — crude on purpose, useful for
 * debugging, and a legitimate way to play any move the board cannot be
 * pointed at.
 */
export function ActionBar({
  state,
  you,
  tray,
  within,
  moves,
  waiting,
  onPlay,
  marketOpen,
  onToggleMarket,
  onShowResult,
}: Props) {
  const [listing, setListing] = useState(false);
  const ref = useDismissible(listing, () => setListing(false));

  /*
   * Whether the turn still has a die in it.
   *
   * Counted as dice with somewhere to *go* rather than dice unspent, and that
   * is the whole of why this is safe: a die whose face fits no open slot and
   * no perk is already as spent as it is ever going to be, and gating on the
   * stricter reading would leave a player holding a die they cannot put down
   * and a turn they cannot end.
   */
  const crewLeft = tray?.movableDice.size ?? 0;

  /*
   * The turn does not end while there is a die left to spend. Dice are the
   * game, a wasted one is almost never what was meant, and the plate sitting
   * there all phase invites exactly that — so it is folded away until the
   * tray is done with.
   *
   * Folded rather than removed: it goes to `All moves`, which is the faithful
   * view of `legalMoves` and is the bar's standing promise that everything
   * still legal is reachable from it. A player who really does mean to throw a
   * die away has it two clicks from here.
   */
  function isHeldBack(move: Move): boolean {
    return move.type === "endPhase" && state.phase === "work" && crewLeft > 0;
  }

  const main = waiting ? [] : moves.filter((move) => isBarMove(move) && !isHeldBack(move));
  const rest = waiting ? [] : moves.filter((move) => !isBarMove(move) || isHeldBack(move));

  function play(move: Move) {
    setListing(false);
    onPlay(move);
  }

  return (
    <footer className={styles.bottomBar}>
      {/*
        * What you are holding, at the near end of the bar. Here rather than
        * over your own compound because it is the one thing on screen that is
        * worth a glance at any moment of any phase, and the bar is the one
        * part of the screen that never moves. See `Stock`.
        */}
      <div className={styles.barStart}>
        <Stock player={you} />
      </div>

      <div className={styles.barMain}>
        {/*
          * Your crew, in the middle of the bar and beside the plates that act
          * on it. The dice used to sit up on the panel next to the
          * Headquarters — which is where the *board* says they go — but that
          * is also the patch a market, a zoom or a choice covers, and a die
          * you cannot see is a die you cannot spend. Down here they are
          * always to hand, and the table is what they are dragged up onto.
          */}
        <DiceTray player={you} className={styles.barTray} within={within} interaction={tray} />

        {waiting ? (
          <span className={styles.empty}>Opponent is thinking…</span>
        ) : (
          <>
            {main.map((move) => (
              <PlateButton key={moveKey(move)} onClick={() => play(move)}>
                {describeMove(state, move)}
              </PlateButton>
            ))}
            {onShowResult && <PlateButton onClick={onShowResult}>Show result</PlateButton>}
            {/*
              * Said rather than left blank. An empty middle of the bar during
              * your own turn looks like the game has stopped answering, when
              * what it means is that everything left to do is on the table.
              *
              * Unless there are dice sitting here, in which case it has
              * already been said by something the player can pick up.
              */}
            {main.length === 0 && !onShowResult && crewLeft === 0 && (
              <span className={styles.empty}>
                {rest.length > 0 ? "Play from the table" : "No moves available."}
              </span>
            )}
          </>
        )}
      </div>

      {/* The two panels, at the far end: the rest of the move list, and the row. */}
      <div className={styles.barEnd}>
        <div className={styles.popover} ref={ref}>
          {rest.length > 0 && (
            <PlateButton
              onClick={() => setListing(!listing)}
              aria-expanded={listing}
              aria-controls="all-moves"
            >
              All moves {rest.length}
            </PlateButton>
          )}

          {listing && (
            <section
              id="all-moves"
              className={`${styles.section} ${styles.popoverPanel} ${styles.popoverAbove}`}
            >
              <div className={styles.sectionTitle}>Everything still legal</div>
              <div className={styles.moves}>
                {rest.map((move) => (
                  <PlateButton key={moveKey(move)} onClick={() => play(move)}>
                    {describeMove(state, move)}
                  </PlateButton>
                ))}
              </div>
            </section>
          )}
        </div>

        {/*
          * A mark rather than a word, and the mark does not change with the
          * state. This plate is the way to the market and back, it never
          * moves, and it is the one plate on the bar that is always there —
          * a label that swaps under a fixed target has to be re-read every
          * time it is aimed at, to say something the market being on screen
          * has already said.
          *
          * What the word was carrying is carried by `aria-label` and the
          * tooltip instead, so the plate still has a name for a screen reader
          * and still says what it is on hover. `aria-expanded` says whether
          * the row is up, as it did before.
          */}
        <PlateButton
          onClick={onToggleMarket}
          disabled={!onToggleMarket}
          aria-expanded={marketOpen}
          aria-label="Market"
          title={onToggleMarket ? "Market" : "Pick the blueprint to copy first"}
        >
          <span className={styles.plateIcon} aria-hidden>
            🏪
          </span>
        </PlateButton>
      </div>
    </footer>
  );
}
