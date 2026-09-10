"use client";

import { useEffect, useRef, type MouseEvent } from "react";
import { prestigeOf, scoreOf, type GameState } from "@/engine";
import { describeEnding, describeWinner } from "@/lib/format";
import { colorSwatch } from "@/lib/colors";
import styles from "./game.module.css";

type Props = {
  /** A finished game. Rendered only when `gameOver` is set. */
  readonly state: GameState;
  /** The seed the next game would be dealt from, for the button to name. */
  readonly nextSeed: number;
  readonly onNewGame: () => void;
  /** Closed without starting another — the board is still worth looking at. */
  readonly onDismiss: () => void;
};

/**
 * The result, once the game is over: who won, what each player was worth, and
 * a way straight into another game.
 *
 * A native `<dialog>` rather than a div with a high z-index, so Esc closes it,
 * focus is trapped inside it, and it sits above everything without the rest of
 * the board having to know it exists.
 */
export function GameOver({ state, nextSeed, onNewGame, onDismiss }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  // Mounted only when the game is over, so opening on mount is the whole of it.
  // Closing on the way out keeps the browser's top layer tidy.
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  /**
   * A modal dialog fills the viewport with its backdrop, so a click outside
   * the panel still lands on the dialog itself. That is what tells the two
   * apart.
   */
  function onBackdropClick(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === ref.current) onDismiss();
  }

  return (
    <dialog
      ref={ref}
      className={styles.modal}
      aria-labelledby="game-over-title"
      // `cancel` is Escape and nothing else. `close` would do here too, until
      // the moment it does not: it also fires when the dialog is closed on the
      // way out, which would report a dismissal for a game already replaced.
      onCancel={onDismiss}
      onClick={onBackdropClick}
    >
      <h2 className={styles.modalTitle} id="game-over-title">
        {describeWinner(state)}
      </h2>
      <p className={styles.modalReason}>{describeEnding(state)}</p>

      <table className={styles.scores}>
        <thead>
          <tr>
            <th scope="col">Player</th>
            <th scope="col">Goods</th>
            <th scope="col">Prestige</th>
            <th scope="col">Score</th>
          </tr>
        </thead>
        <tbody>
          {state.players.map((player, index) => (
            <tr key={player.id} className={index === state.winner ? styles.scoreWon : undefined}>
              <th scope="row">
                <span
                  className={styles.swatch}
                  style={colorSwatch(player.color)}
                  title={`${player.color} dice`}
                />
                {player.name}
              </th>
              {/* Goods and prestige are the two halves of a score, and which
                  half someone won on is the whole shape of the game. */}
              <td>{player.resources.goods}</td>
              <td>{prestigeOf(player.compound)}</td>
              <td>
                <strong>{scoreOf(player)}</strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className={styles.modalActions}>
        <button type="button" className={styles.moveButton} onClick={onNewGame}>
          New game (seed {nextSeed})
        </button>
        {/* Named to pair with the "Show result" button it leaves behind, so
            putting it away plainly reads as something you can undo. */}
        <button type="button" className={styles.moveButton} onClick={onDismiss}>
          Hide result
        </button>
      </div>
    </dialog>
  );
}
