import type { DragEvent } from "react";
import { canAfford, scoreOf, type Building, type Move, type Player } from "@/engine";
import type { DieTargets } from "@/lib/board";
import { colorSwatch, DIE_SWATCHES } from "@/lib/colors";
import { describeResources } from "@/lib/format";
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
  /** Hand cards that could be built right now. */
  readonly buildable: ReadonlySet<string>;
  /** Buildings whose perk takes no dice, and so is clicked rather than dragged. */
  readonly freeActivations: ReadonlyMap<string, Move>;
  /** Hand cards that could pay for whatever is mid-choice, if anything. */
  readonly payments: ReadonlyMap<string, Move> | null;
  /** The card mid-choice — a contractor being taken, or a build being paid for. */
  readonly pending: string | null;
  /** Clicking a hand card: starts a build, pays for one, or cancels. */
  readonly onSelectCard: (cardId: string) => void;
  readonly onPlay: (move: Move) => void;
};

/**
 * Why a building cannot be worked, when the card face does not already say.
 * A perk that wants dice you have not rolled explains itself — the dice are
 * right there — but one you cannot pay for looks broken without this.
 */
function perkNote(player: Player, building: Building): string | undefined {
  const { perk, prestigeBonus } = building.card;
  if (!perk) return prestigeBonus ? "scores, and stacks" : "scores only";
  if (building.worked) return "worked this round";
  if (!canAfford(player.resources, perk.cost)) {
    return `needs ${describeResources(perk.cost)}`;
  }
  return undefined;
}

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
          {player.resources.goods} goods · {player.compound.length} in compound ·{" "}
          <strong title="Goods plus prestige built">{scoreOf(player)} score</strong>
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
              // A perk that takes no dice has nothing to drag at it, so it is
              // worked by clicking the card instead.
              const free = interaction?.freeActivations.get(building.card.id);
              return (
                <CardView
                  key={building.card.id}
                  card={building.card}
                  built
                  note={perkNote(player, building)}
                  dice={building.dice}
                  spent={building.worked}
                  highlight={Boolean(free)}
                  onSelect={free ? () => interaction?.onPlay(free) : undefined}
                  selectLabel={`Work ${building.card.name}`}
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
        {/* The payment comes from hand whether a card is being taken or built. */}
        {interaction?.pending && (
          <p className={styles.prompt}>Click a highlighted blueprint to discard as payment.</p>
        )}
        {hideHand ? (
          <p className={styles.empty}>{player.hand.length} card(s), hidden.</p>
        ) : player.hand.length === 0 ? (
          <p className={styles.empty}>No cards.</p>
        ) : (
          <div className={styles.cardRow}>
            {player.hand.map((card) => {
              const paying = Boolean(interaction?.payments?.has(card.id));
              const pending = interaction?.pending === card.id;
              // Mid-choice the hand is for paying, so only the cards that
              // could pay stay live — plus the one being paid for, to cancel.
              const buildable =
                (interaction?.buildable.has(card.id) ?? false) && !interaction?.pending;
              const clickable = paying || pending || buildable;

              return (
                <CardView
                  key={card.id}
                  card={card}
                  highlight={paying || buildable}
                  selected={pending}
                  onSelect={clickable ? () => interaction?.onSelectCard(card.id) : undefined}
                  selectLabel={paying ? `Discard ${card.name} to pay` : `Build ${card.name}`}
                />
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
