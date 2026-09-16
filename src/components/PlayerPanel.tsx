"use client";

import { useRef, useState } from "react";
import {
  AUTOMA_PRODUCTION,
  buildCostFor,
  canAfford,
  countByCategory,
  HAND_LIMIT,
  overLimits,
  perkCost,
  RESOURCE_LIMIT,
  type BlueprintCard,
  type Building,
  type Move,
  type Player,
} from "@/engine";
import type { DieTargets } from "@/lib/board";
import { colorSwatch } from "@/lib/colors";
import { describeResources, moveKey } from "@/lib/format";
import { CardView } from "./CardView";
import { DiceTray } from "./DiceTray";
import { HeadquartersView } from "./HeadquartersView";
import { PlateButton } from "./PlateButton";
import { ResourceText } from "./Resource";
import { Stock } from "./Stock";
import styles from "./game.module.css";

/**
 * Everything the panel needs to be playable. Absent for the opponent's panel
 * and while the opponent is thinking, which leaves it a plain read-only view.
 *
 * The dice themselves are not in here any more — they live in the action bar,
 * and the gesture that carries them is the bar's. What the panel still needs
 * of it is everything the *targets* need: where the die in hand may land, and
 * which of those it is pointed at right now.
 */
export type PanelInteraction = {
  /**
   * Dice with somewhere to go, which is only still here for the sentence that
   * tells the player what to do with them.
   */
  readonly movableDice: ReadonlySet<string>;
  /** Where the die being dragged may land. Null when nothing is in hand. */
  readonly targets: DieTargets | null;
  /**
   * The `data-drop` that die is aimed at, if any. Most of what a player feels
   * as magnetism is here rather than in the die: the target reaches out as the
   * die comes near, and it costs one render per target rather than one per
   * pointer move. See docs/dice.md §2.3.
   */
  readonly aimed: string | null;
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
    <div className={styles.produces}>
      <span className={styles.sectionTitle}>Produces on</span>
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
  /**
   * Whether this is somebody sitting across the table rather than the player
   * holding the screen. Their compound folds away, because with the whole game
   * in one viewport it is the largest thing on it that nobody can act on — and
   * for the automaton it is very nearly redundant besides, since what its
   * cards are worth to it is the count of each type, which is printed either
   * way.
   */
  compact?: boolean;
  interaction?: PanelInteraction;
};

export function PlayerPanel({
  player,
  active,
  market,
  flashing,
  arriving,
  charging,
  compact = false,
  interaction,
}: Props) {
  const targets = interaction?.targets ?? null;
  const aimed = interaction?.aimed ?? null;
  /** Whether an opponent's compound has been unfolded to be read. */
  const [showCompound, setShowCompound] = useState(!compact);
  /** The patch of screen an opponent's throw is allowed to scatter across. */
  const panel = useRef<HTMLElement | null>(null);
  // The automaton holds no cards and never places a die on its Headquarters,
  // so both sections would be permanently empty furniture.
  const automaton = player.isAi;
  const over = overLimits(player);
  // A choice about a card in hand is asked beside the hand, not the compound.
  const choosingInHand = player.hand.some((card) => card.id === interaction?.pending);

  /*
   * The parts both shapes of panel are made of, so that the strip an opponent
   * gets is the same board as the panel you get and not a second rendering of
   * it that can drift.
   */

  /** Who this is, and whether it is their go. */
  const who = (
    <span className={styles.playerName}>
      <span
        className={styles.swatch}
        style={colorSwatch(player.color)}
        title={`${player.color} dice`}
      />
      {player.name}
      {active ? " — to act" : ""}
    </span>
  );

  /*
   * An opponent's dice, on their own strip.
   *
   * Only theirs. Yours are in the action bar — see `ActionBar` — where they
   * are on screen whatever the table is doing, and where they are not a
   * second copy of themselves. This panel is only ever unfolded for the
   * player holding the screen, so the tray below belongs to the strip and
   * appears nowhere else in here.
   */
  const tray = <DiceTray player={player} within={panel} empty="Not rolled yet." />;

  /** Everything standing, as the row of plates it is. */
  const compound =
    player.compound.length === 0 ? (
      <p className={styles.empty}>Nothing built yet.</p>
    ) : (
      <div className={styles.cardRow}>
        {player.compound.map((building) => {
          const cardId = building.card.id;
          const droppable = targets?.activations.has(cardId) ?? false;
          // A perk with nothing to drag at it is worked by clicking the card
          // instead — it takes no dice, or it has to be told what to copy
          // before its dice mean anything.
          const free = interaction?.workable.has(cardId) ?? false;
          // The card mid-choice stays clickable, to back out of it.
          const choosing = interaction?.pending === cardId;
          return (
            <CardView
              key={cardId}
              card={building.card}
              arriving={arriving?.has(cardId)}
              built
              // The automaton never works a perk, so "needs 2 energy" would be
              // reporting a failure it is not having.
              note={automaton ? undefined : perkNote(player, building, market)}
              dice={building.dice}
              spent={building.worked}
              highlight={free}
              selected={choosing}
              flash={flashing?.has(cardId)}
              // Both cases go through the same click: working a perk that
              // offers a choice asks it, and clicking again backs out.
              onSelect={choosing || free ? () => interaction?.onSelectCard(cardId) : undefined}
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
    );

  /** The plate that unfolds an opponent's compound, once they have one. */
  const unfold = player.compound.length > 0 && (
    <PlateButton onClick={() => setShowCompound(!showCompound)} aria-expanded={showCompound}>
      {showCompound ? "Hide cards" : `${player.compound.length} cards`}
    </PlateButton>
  );

  /*
   * Somebody across the table, in one line. See `.compactPanel` for why an
   * opponent gets a strip: it is the biggest thing on a screen that has to
   * hold the whole game, and it is the one thing on it nobody can act on.
   */
  if (compact) {
    return (
      <section
        ref={panel}
        className={[styles.section, styles.compactPanel, active && styles.playerActive]
          .filter(Boolean)
          .join(" ")}
      >
        <div className={styles.compactRow}>
          {who}
          {tray}
          {/* What its dice are read against, which is its whole Work Phase. */}
          {automaton && <ProductionSummary player={player} />}
          <Stock player={player} />
          {unfold}
        </div>
        {showCompound && compound}
      </section>
    );
  }

  return (
    <section
      ref={panel}
      className={`${styles.section} ${active ? styles.playerActive : ""}`}
    >
      {/*
        * Your name and nothing else. What you are holding is in the action
        * bar — see `Stock` — where it is on screen whatever the table is
        * doing, and where it is not a second copy of itself.
        */}
      <header className={styles.playerHeader}>{who}</header>

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

      {/*
        * The machinery: what you rolled, what it goes into, and what already
        * stands. One wrapper with no box of its own — see `.workbench`, which
        * is `display: contents` until the screen is a phone on its side, and
        * a grid after that.
        */}
      <div className={styles.workbench}>
        {/*
          * Where a die can go, and the sentence about it. Another
          * `display: contents` wrapper, so that sideways the two of them are
          * one column and the sentence costs nothing: the tile is shorter than
          * the compound beside it, and that slack is exactly a line of text
          * tall.
          *
          * The dice that feed it are in the bar now, so what is left here is
          * the half of the thought that has to stay on the table — the slots
          * are a thing the board owns and a die is carried up to.
          */}
        <div className={styles.machinery}>
          <div className={styles.tableRow}>
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
          </div>

          {interaction && interaction.movableDice.size > 0 && (
            <p className={styles.prompt}>
              Drag a die up from the bar onto a slot, a blueprint, or a building.
            </p>
          )}
        </div>

        <div className={styles.compoundBlock}>
          <div className={styles.sectionTitle}>Compound</div>
          {compound}
          {/* Asked beside whichever card is being chosen for. */}
          {!choosingInHand && <Choices interaction={interaction} />}
        </div>
      </div>

      {/* The automaton has no hand — a card it takes goes straight up. */}
      {!automaton && (
      <div className={styles.handBlock}>
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
