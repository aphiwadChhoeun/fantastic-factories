import type { DragEvent } from "react";
import {
  AUTOMA_PRODUCTION,
  canAfford,
  countByCategory,
  perkCost,
  scoreOf,
  type Building,
  type Move,
  type Player,
} from "@/engine";
import type { DieTargets } from "@/lib/board";
import { colorSwatch, DIE_SWATCHES } from "@/lib/colors";
import { describeResources, moveKey } from "@/lib/format";
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
  readonly payments: ReadonlyMap<string, readonly Move[]> | null;
  /**
   * Whatever a choice still leaves open once the cards are settled, spelled
   * out: which resources to take, or which run of dice to work.
   */
  readonly choices: readonly { readonly move: Move; readonly label: string }[];
  /** The card mid-choice — one being taken, built, or worked. */
  readonly pending: string | null;
  /** Clicking a hand card: starts a build, pays for one, or cancels. */
  readonly onSelectCard: (cardId: string) => void;
  /** Dropping the die being dragged onto a building in the compound. */
  readonly onDropDie: (cardId: string) => void;
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
  // The Black Market's price is a card out of hand, not a resource.
  if (perk.effect.kind === "discardForResources" && player.hand.length === 0) {
    return "needs a blueprint in hand";
  }
  if (!canAfford(player.resources, perk.cost)) {
    return `needs ${describeResources(perk.cost)}`;
  }
  // A price read off the dice is not a number until they are chosen, so the
  // most that can be said in advance is that even the cheapest face is short.
  if (perk.costByFace && !canAfford(player.resources, perkCost(perk, [1]))) {
    return `needs ${perk.costByFace} for its dice`;
  }
  return undefined;
}

/**
 * What the automaton's compound is worth to it, type by type: how many cards
 * stand of each, and which colour die answers for them.
 *
 * This is the whole of its Work Phase, so it is worth showing plainly — a die
 * pays a good when its face is at most the count beside its colour. Monuments
 * answer to no colour and so appear nowhere here.
 */
function ProductionSummary({ player }: { player: Player }) {
  return (
    <div>
      <div className={styles.sectionTitle}>Produces on</div>
      <div className={styles.automaTypes}>
        {AUTOMA_PRODUCTION.map(({ color, category }) => {
          const standing = countByCategory(player.compound, category);
          return (
            <span
              key={color}
              className={styles.cardMeta}
              title={
                standing === 0
                  ? `Nothing of this type — the ${color} die cannot pay`
                  : `The ${color} die pays a good on ${standing} or less`
              }
            >
              <span className={styles.swatch} style={colorSwatch(color)} />
              {category} <strong>{standing}</strong>
            </span>
          );
        })}
      </div>
    </div>
  );
}

type Props = {
  player: Player;
  active: boolean;
  interaction?: PanelInteraction;
};

export function PlayerPanel({ player, active, interaction }: Props) {
  const targets = interaction?.targets ?? null;
  // The automaton holds no cards and never places a die on its Headquarters,
  // so both sections would be permanently empty furniture.
  const automaton = player.isAi;

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
          {/* The automaton buys nothing, so it is never dealt anything to buy with. */}
          {!automaton && `${player.resources.metal} metal · ${player.resources.energy} energy · `}
          {player.resources.goods} goods · {player.compound.length} in compound ·{" "}
          <strong title="Goods plus prestige standing">{scoreOf(player)} score</strong>
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

      {automaton ? (
        <ProductionSummary player={player} />
      ) : (
        <HeadquartersView
          placements={player.headquarters}
          color={player.color}
          targets={targets?.sections ?? null}
          onPlay={interaction?.onPlay}
        />
      )}

      <div>
        <div className={styles.sectionTitle}>Compound</div>
        {player.compound.length === 0 ? (
          <p className={styles.empty}>Nothing built yet.</p>
        ) : (
          <div className={styles.cardRow}>
            {player.compound.map((building) => {
              const cardId = building.card.id;
              const droppable = targets?.activations.has(cardId) ?? false;
              // A perk that takes no dice has nothing to drag at it, so it is
              // worked by clicking the card instead.
              const free = interaction?.freeActivations.get(cardId);
              // The card mid-choice stays clickable, to back out of it.
              const choosing = interaction?.pending === cardId;
              return (
                <CardView
                  key={cardId}
                  card={building.card}
                  built
                  // The automaton never works a perk, so "needs 2 energy"
                  // would be reporting a failure it is not having.
                  note={automaton ? undefined : perkNote(player, building)}
                  dice={building.dice}
                  spent={building.worked}
                  highlight={Boolean(free)}
                  selected={choosing}
                  onSelect={
                    choosing
                      ? () => interaction?.onSelectCard(cardId)
                      : free
                        ? () => interaction?.onPlay(free)
                        : undefined
                  }
                  selectLabel={
                    choosing ? `Cancel ${building.card.name}` : `Work ${building.card.name}`
                  }
                  dropTarget={droppable}
                  onDropDie={droppable ? () => interaction?.onDropDie(cardId) : undefined}
                />
              );
            })}
          </div>
        )}
        {interaction && interaction.choices.length > 0 && (
          <div className={styles.choices}>
            {interaction.choices.map(({ move, label }) => (
              <button
                key={moveKey(move)}
                type="button"
                className={styles.moveButton}
                onClick={() => interaction.onPlay(move)}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* The automaton has no hand — a card it takes goes straight up. */}
      {!automaton && (
      <div>
        <div className={styles.sectionTitle}>Hand</div>
        {/* The payment comes from hand whether a card is taken, built or sold. */}
        {interaction?.payments && (
          <p className={styles.prompt}>Click a highlighted blueprint to discard as payment.</p>
        )}
        {player.hand.length === 0 ? (
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
      )}
    </section>
  );
}
