import type { DragEvent } from "react";
import {
  AUTOMA_PRODUCTION,
  canAfford,
  countByCategory,
  HAND_LIMIT,
  overLimits,
  perkCost,
  RESOURCE_LIMIT,
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
  readonly freeActivations: ReadonlyMap<string, readonly Move[]>;
  /** Hand cards that could come off to meet the end-of-phase limit. */
  readonly discardable: ReadonlySet<string>;
  /** Resource discards forced by the limit. Nothing on the board to point at. */
  readonly discards: readonly { readonly move: Move; readonly label: string }[];
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

/**
 * Whatever a choice still leaves open, as buttons: which resources the Black
 * Market pays, which run works an Assembly Line, or — on a card you could also
 * build — that you simply want it gone.
 */
function Choices({ interaction }: { interaction?: PanelInteraction }) {
  if (!interaction || interaction.choices.length === 0) return null;

  return (
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
  const over = overLimits(player);
  // A choice about a card in hand is asked beside the hand, not the compound.
  const choosingInHand = player.hand.some((card) => card.id === interaction?.pending);

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

      {/*
        * Over a limit, the Work Phase cannot end until it comes down. Said up
        * top, because until it is dealt with the End turn button is gone and
        * its absence is the only other clue.
        */}
      {interaction && (over.resources > 0 || over.cards > 0) && (
        <div>
          <p className={styles.prompt}>
            {over.resources > 0 &&
              `Over by ${over.resources} — keep at most ${RESOURCE_LIMIT} metal and energy. `}
            {over.cards > 0 &&
              `Over by ${over.cards} — keep at most ${HAND_LIMIT} cards, so click one to discard.`}
          </p>
          {interaction.discards.length > 0 && (
            <div className={styles.choices}>
              {interaction.discards.map(({ move, label }) => (
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
      )}

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
              const free = (interaction?.freeActivations.get(cardId)?.length ?? 0) > 0;
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
                  highlight={free}
                  selected={choosing}
                  // Both cases go through the same click: working a perk that
                  // offers a choice asks it, and clicking again backs out.
                  onSelect={
                    choosing || free ? () => interaction?.onSelectCard(cardId) : undefined
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
        {/* Asked beside whichever card is being chosen for. */}
        {!choosingInHand && <Choices interaction={interaction} />}
      </div>

      {/* The automaton has no hand — a card it takes goes straight up. */}
      {!automaton && (
      <div>
        <div className={styles.sectionTitle}>Hand</div>
        {/* The payment comes from hand whether a card is taken, built or sold. */}
        {interaction?.payments && (
          <p className={styles.prompt}>Click a highlighted blueprint to discard as payment.</p>
        )}
        {choosingInHand && <Choices interaction={interaction} />}
        {player.hand.length === 0 ? (
          <p className={styles.empty}>No cards.</p>
        ) : (
          <div className={styles.cardRow}>
            {player.hand.map((card) => {
              const paying = Boolean(interaction?.payments?.has(card.id));
              const pending = interaction?.pending === card.id;
              // Mid-choice the hand is for paying, so only the cards that
              // could pay stay live — plus the one being paid for, to cancel.
              const live = !interaction?.pending;
              const buildable = (interaction?.buildable.has(card.id) ?? false) && live;
              const droppable = (interaction?.discardable.has(card.id) ?? false) && live;
              const clickable = paying || pending || buildable || droppable;

              return (
                <CardView
                  key={card.id}
                  card={card}
                  highlight={paying || buildable || droppable}
                  selected={pending}
                  onSelect={clickable ? () => interaction?.onSelectCard(card.id) : undefined}
                  selectLabel={
                    paying
                      ? `Discard ${card.name} to pay`
                      : droppable && !buildable
                        ? `Discard ${card.name}`
                        : `Build ${card.name}`
                  }
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
