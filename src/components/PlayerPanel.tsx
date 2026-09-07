import type { DragEvent } from "react";
import type { Move, Player } from "@/engine";
import type { DieTargets } from "@/lib/board";
import { colorSwatch, DIE_SWATCHES } from "@/lib/colors";
import { CardView } from "./CardView";
import { HeadquartersView } from "./HeadquartersView";
import styles from "./game.module.css";

/**
 * Everything the panel needs to be playable. Absent for the opponent's panel
 * and while the opponent is thinking, which leaves it a plain read-only view.
 */
export type PanelInteraction = {
  /** Dice with somewhere to go. Anything else is not worth picking up. */
  readonly movableDice: ReadonlySet<string>;
  /** The die under the cursor right now, if one is being dragged. */
  readonly dragging: string | null;
  readonly onDragChange: (dieId: string | null) => void;
  /** Where the die being dragged may land. Null when nothing is in hand. */
  readonly targets: DieTargets | null;
  /** Hand cards that could pay for the contractor being taken, if any. */
  readonly payments: ReadonlyMap<string, Move> | null;
  readonly onPlay: (move: Move) => void;
};

type Props = {
  player: Player;
  active: boolean;
  /** Hide an AI opponent's hand; blueprints are private information. */
  hideHand?: boolean;
  interaction?: PanelInteraction;
};

export function PlayerPanel({ player, active, hideHand = false, interaction }: Props) {
  const targets = interaction?.targets ?? null;

  function startDrag(event: DragEvent, dieId: string) {
    event.dataTransfer.effectAllowed = "move";
    // Some browsers refuse to start a drag without payload, even unused.
    event.dataTransfer.setData("text/plain", dieId);
    interaction?.onDragChange(dieId);
  }

  return (
    <section className={`${styles.section} ${active ? styles.playerActive : ""}`}>
      <header className={styles.playerHeader}>
        <span className={styles.playerName}>
          <span
            className={styles.swatch}
            style={colorSwatch(player.color)}
            title={`${player.color} dice`}
          />
          {player.name}
          {active ? " — to act" : ""}
        </span>
        <span className={styles.cardMeta}>
          {player.resources.metal} metal · {player.resources.energy} energy ·{" "}
          {player.resources.goods} goods · {player.compound.length} in compound
        </span>
      </header>

      <div>
        <div className={styles.sectionTitle}>Dice</div>
        {player.dice.length === 0 ? (
          <p className={styles.empty}>Not rolled yet.</p>
        ) : (
          <div className={styles.dice}>
            {player.dice.map((die) => {
              const movable = interaction?.movableDice.has(die.id) ?? false;
              return (
                <span
                  key={die.id}
                  className={[
                    styles.die,
                    die.spent && styles.dieSpent,
                    movable && styles.dieMovable,
                    interaction?.dragging === die.id && styles.dieDragging,
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  style={DIE_SWATCHES[die.color]}
                  title={`${die.color} ${die.face} — ${die.spent ? "spent" : "available"}`}
                  draggable={movable}
                  onDragStart={movable ? (event) => startDrag(event, die.id) : undefined}
                  onDragEnd={() => interaction?.onDragChange(null)}
                >
                  {die.face}
                </span>
              );
            })}
          </div>
        )}
        {interaction && interaction.movableDice.size > 0 && (
          <p className={styles.prompt}>Drag a die onto a slot, a blueprint, or a building.</p>
        )}
      </div>

      <HeadquartersView
        placements={player.headquarters}
        color={player.color}
        targets={targets?.sections ?? null}
        onPlay={interaction?.onPlay}
      />

      <div>
        <div className={styles.sectionTitle}>Compound</div>
        {player.compound.length === 0 ? (
          <p className={styles.empty}>Nothing built yet.</p>
        ) : (
          <div className={styles.cardRow}>
            {player.compound.map((building) => {
              const move = targets?.activations.get(building.card.id);
              return (
                <CardView
                  key={building.card.id}
                  card={building.card}
                  built
                  spent={building.activated}
                  dropTarget={Boolean(move)}
                  onDropDie={move ? () => interaction?.onPlay(move) : undefined}
                />
              );
            })}
          </div>
        )}
      </div>

      <div>
        <div className={styles.sectionTitle}>Hand</div>
        {hideHand ? (
          <p className={styles.empty}>{player.hand.length} card(s), hidden.</p>
        ) : player.hand.length === 0 ? (
          <p className={styles.empty}>No cards.</p>
        ) : (
          <div className={styles.cardRow}>
            {player.hand.map((card) => {
              const build = targets?.builds.get(card.id);
              const payment = interaction?.payments?.get(card.id);
              return (
                <CardView
                  key={card.id}
                  card={card}
                  highlight={Boolean(payment)}
                  onSelect={payment ? () => interaction?.onPlay(payment) : undefined}
                  selectLabel={`Pay with ${card.name}`}
                  dropTarget={Boolean(build)}
                  onDropDie={build ? () => interaction?.onPlay(build) : undefined}
                />
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
