"use client";

import type { GameState, Move } from "@/engine";
import { describeMove, moveKey } from "@/lib/format";
import styles from "./game.module.css";

type Props = {
  state: GameState;
  moves: readonly Move[];
  /**
   * True while the opponent is deciding. The list is hidden rather than
   * disabled — these would be the AI's moves, and they reveal its hand.
   */
  waiting: boolean;
  onPlay: (move: Move) => void;
};

/**
 * Renders `legalMoves` as buttons. Crude on purpose: it is a faithful view of
 * the engine's move list, which makes it a useful debugging surface while the
 * real board UI does not exist yet.
 */
export function MoveList({ state, moves, waiting, onPlay }: Props) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionTitle}>Your moves</div>
      {waiting ? (
        <p className={styles.empty}>Opponent is thinking…</p>
      ) : moves.length === 0 ? (
        <p className={styles.empty}>No moves available.</p>
      ) : (
        <div className={styles.moves}>
          {moves.map((move) => (
            <button
              key={moveKey(move)}
              type="button"
              className={styles.moveButton}
              onClick={() => onPlay(move)}
            >
              {describeMove(state, move)}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
