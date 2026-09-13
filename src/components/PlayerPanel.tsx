"use client";

import { useEffect, useRef, useState } from "react";
import {
  AUTOMA_PRODUCTION,
  buildCostFor,
  canAfford,
  countByCategory,
  HAND_LIMIT,
  HQ_SECTION_IDS,
  overLimits,
  perkCost,
  prestigeFor,
  RESOURCE_LIMIT,
  scoreOf,
  type BlueprintCard,
  type Building,
  type Move,
  type Player,
} from "@/engine";
import { emitRoll } from "@/dice/bus";
import { useGrowth } from "@/hooks/useGrowth";
import type { DieTargets } from "@/lib/board";
import { colorSwatch } from "@/lib/colors";
import { describeResources, moveKey } from "@/lib/format";
import { CardView } from "./CardView";
import { DraggableDie } from "./DraggableDie";
import { HeadquartersView } from "./HeadquartersView";
import { PlateButton } from "./PlateButton";
import { ResourceChip, ResourceText, Rolling } from "./Resource";
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
  /**
   * Buildings worked by clicking rather than by dragging: a perk that takes no
   * dice, or one that copies and has to be asked which card first.
   */
  readonly workable: ReadonlySet<string>;
  /** Hand cards that could come off to meet the end-of-phase limit. */
  readonly discardable: ReadonlySet<string>;
  /** Resource discards forced by the limit. Nothing on the board to point at. */
  readonly discards: readonly { readonly move: Move; readonly label: string }[];
  /** Hand cards that could pay for whatever is mid-choice, if anything. */
  readonly payments: ReadonlyMap<string, readonly Move[]> | null;
  /**
   * Hand cards already promised to the choice in progress. A perk that eats
   * two is fed one click at a time, so the first has to look spent for it.
   */
  readonly spending: ReadonlySet<string>;
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
function perkNote(
  player: Player,
  building: Building,
  market: readonly BlueprintCard[],
): string | undefined {
  const { perk, passive, prestigeBonus } = building.card;
  // A passive fires by itself; `worked` is how it remembers that it has.
  if (passive) return building.worked ? "already fired this round" : "watching";
  if (!perk) return prestigeBonus ? "scores, and stacks" : "scores only";
  if (building.worked) return "worked this round";
  // A card with no perk of its own is only as good as the row it copies from,
  // and a row of Monuments leaves it nothing to do.
  if (perk.effect.kind === "borrowFromMarket") {
    const copyable = market.some(
      (card) => card.perk && card.perk.effect.kind !== "borrowFromMarket",
    );
    if (!copyable) return "nothing face up to copy";
  }
  // Some perks are priced in cards rather than resources.
  const eats = perk.discardsCards ?? 0;
  if (player.hand.length < eats) {
    return eats === 1 ? "needs a blueprint in hand" : `needs ${eats} blueprints in hand`;
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
        <PlateButton key={moveKey(move)} onClick={() => interaction.onPlay(move)}>
          {label}
        </PlateButton>
      ))}
    </div>
  );
}

type Props = {
  player: Player;
  active: boolean;
  /** The face-up blueprint row — what a Replicator standing here could copy. */
  market: readonly BlueprintCard[];
  /**
   * Cards lit by the last move. Not part of `interaction`: the automaton's
   * compound is read-only and its buildings still go up and still fire.
   */
  flashing?: ReadonlySet<string>;
  /**
   * Cards that have just arrived in this panel — drafted into the hand, or
   * stood up in the compound. They lean into the travel; nothing else does.
   */
  arriving?: ReadonlySet<string>;
  /**
   * Buildings a die has just landed on, winding up. Not part of `interaction`
   * either: the automaton's perks fire too, and its compound is read-only.
   */
  charging?: ReadonlySet<string>;
  interaction?: PanelInteraction;
};

export function PlayerPanel({
  player,
  active,
  market,
  flashing,
  arriving,
  charging,
  interaction,
}: Props) {
  const targets = interaction?.targets ?? null;
  /** How far a die may be dragged: its own panel, and no further. */
  const panel = useRef<HTMLElement | null>(null);
  /**
   * The `data-drop` the die in hand is aimed at, if any.
   *
   * Most of what a player feels as magnetism is here rather than in the die:
   * the target reaches out as the die comes near, and it costs one render per
   * target rather than one per pointer move. See docs/dice.md §2.3.
   */
  const [aimed, setAimed] = useState<string | null>(null);
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
  /** The last handful this panel asked to have thrown, so it asks only once. */
  const asked = useRef("");

  /*
   * Hand the throw to the physics canvas, if there is one listening.
   *
   * Nothing here knows whether there is: `emitRoll` is dropped on the floor
   * when the flag is off, the chunk has not loaded, or the player has asked
   * for less motion, and the dice throw themselves in the DOM instead. The
   * panel's own box goes with it, because that is the patch of screen the dice
   * are allowed to roll across — see docs/dice.md §2.1.
   */
  useEffect(() => {
    if (!rolled) return;
    const fresh = player.dice.slice(inTray);
    const key = fresh.map((die) => die.id).join(",");
    // `rolled` stays true for the rest of the round, so without this a die
    // being spent would be read as the whole handful being thrown again.
    if (!key || key === asked.current) return;
    asked.current = key;

    const box = panel.current?.getBoundingClientRect();
    if (!box) return;
    emitRoll({
      dice: fresh.map((die) => ({ id: die.id, face: die.face, color: die.color })),
      within: { left: box.left, top: box.top, width: box.width, height: box.height },
    });
  }, [rolled, player.dice, inTray]);
  // The automaton holds no cards and never places a die on its Headquarters,
  // so both sections would be permanently empty furniture.
  const automaton = player.isAi;
  const over = overLimits(player);
  // A choice about a card in hand is asked beside the hand, not the compound.
  const choosingInHand = player.hand.some((card) => card.id === interaction?.pending);

  /**
   * What a die was dropped on, and what that means.
   *
   * The die works this out for itself and hands over the answer, rather than
   * the board hit-testing the release. That is not a detail: the same answer
   * lit the target up, leaned the die toward it and drew the line to it while
   * the player was still deciding, so resolving the drop any other way would
   * be letting the board break a promise it spent the whole drag making.
   *
   * Null when the die was let go at nothing, which springs it home.
   */
  function release(drop: string | null) {
    if (drop && interaction) {
      const section = HQ_SECTION_IDS.find((id) => drop === `hq:${id}`);
      if (section) {
        const move = targets?.sections.get(section);
        if (move) interaction.onPlay(move);
      } else if (drop.startsWith("card:")) {
        interaction.onDropDie(drop.slice("card:".length));
      }
    }

    setAimed(null);
    // Last, because the move above is resolved against the die still in hand.
    interaction?.onDragChange(null);
  }

  return (
    <section
      ref={panel}
      className={`${styles.section} ${active ? styles.playerActive : ""}`}
    >
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
      </header>

      {/*
        * Over a limit, the Work Phase cannot end until it comes down. Said up
        * top, because until it is dealt with the End turn button is gone and
        * its absence is the only other clue.
        */}
      {interaction && (over.resources > 0 || over.cards > 0) && (
        <div>
          <p className={styles.prompt}>
            {over.resources > 0 && (
              <ResourceText>
                {`Over by ${over.resources} — keep at most ${RESOURCE_LIMIT} metal and energy. `}
              </ResourceText>
            )}
            {over.cards > 0 &&
              `Over by ${over.cards} — keep at most ${HAND_LIMIT} cards, so click one to discard.`}
          </p>
          {interaction.discards.length > 0 && (
            <div className={styles.choices}>
              {interaction.discards.map(({ move, label }) => (
                <PlateButton key={moveKey(move)} onClick={() => interaction.onPlay(move)}>
                  {label}
                </PlateButton>
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
            {player.dice.map((die, index) => {
              const movable = interaction?.movableDice.has(die.id) ?? false;
              return (
                <DraggableDie
                  key={die.id}
                  die={die}
                  movable={movable}
                  held={interaction?.dragging === die.id}
                  index={index}
                  thrown={index >= inTray && rolled}
                  bounds={panel}
                  onPick={() => interaction?.onDragChange(die.id)}
                  onAim={setAimed}
                  onRelease={release}
                />
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
          aimed={aimed}
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
              // A perk with nothing to drag at it is worked by clicking the
              // card instead — it takes no dice, or it has to be told what to
              // copy before its dice mean anything.
              const free = interaction?.workable.has(cardId) ?? false;
              // The card mid-choice stays clickable, to back out of it.
              const choosing = interaction?.pending === cardId;
              return (
                <CardView
                  key={cardId}
                  card={building.card}
                  arriving={arriving?.has(cardId)}
                  built
                  // The automaton never works a perk, so "needs 2 energy"
                  // would be reporting a failure it is not having.
                  note={automaton ? undefined : perkNote(player, building, market)}
                  dice={building.dice}
                  spent={building.worked}
                  highlight={free}
                  selected={choosing}
                  flash={flashing?.has(cardId)}
                  // Both cases go through the same click: working a perk that
                  // offers a choice asks it, and clicking again backs out.
                  onSelect={
                    choosing || free ? () => interaction?.onSelectCard(cardId) : undefined
                  }
                  selectLabel={
                    choosing ? `Cancel ${building.card.name}` : `Work ${building.card.name}`
                  }
                  dropTarget={droppable}
                  aimed={aimed === `card:${cardId}`}
                  charging={charging?.has(cardId)}
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
          <p className={styles.prompt}>
            Click a highlighted blueprint to discard as payment.
            {interaction.spending.size > 0 && " It wants another."}
          </p>
        )}
        {choosingInHand && <Choices interaction={interaction} />}
        {player.hand.length === 0 ? (
          <p className={styles.empty}>No cards.</p>
        ) : (
          <div className={styles.cardRow}>
            {player.hand.map((card) => {
              const paying = Boolean(interaction?.payments?.has(card.id));
              const promised = Boolean(interaction?.spending.has(card.id));
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
                  arriving={arriving?.has(card.id)}
                  buildCost={buildCostFor(player, card)}
                  highlight={paying || buildable || droppable}
                  selected={pending || promised}
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
