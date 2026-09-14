"use client";

import {
  useEffect,
  useId,
  useRef,
  type MouseEvent,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import type { Card, Resources } from "@/engine";
import {
  describeEffect,
  describePassive,
  describePerkCost,
  describeResources,
} from "@/lib/format";
import { PlateButton } from "./PlateButton";
import { ResourceText } from "./Resource";
import styles from "./game.module.css";

/**
 * A word out of the engine, standing at the head of a line for the first time.
 * Every string in `lib/format.ts` is written to sit inside a sentence, which
 * is what the log and the move buttons want; only here does one start one.
 */
function capitalised(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

/**
 * One fact off the card, as a term and what it says. Nothing is rendered for a
 * fact the card does not have — a blueprint with no perk should say nothing
 * about working, rather than say "none".
 */
function Fact({ term, children }: { term: string; children?: ReactNode }) {
  if (!children) return null;
  return (
    <>
      <dt className={styles.zoomTerm}>{term}</dt>
      <dd className={styles.zoomFact}>{children}</dd>
    </>
  );
}

type Props = {
  card: Card;
  /**
   * What this card costs *this* player, when that is not what is printed on
   * it. The same discount the plate shows, said in words.
   */
  buildCost?: Resources;
  /** Why the card cannot be used right now, when the face does not say. */
  note?: string;
  /**
   * The card's own move, carried in from the plate that was tapped. Taking it,
   * building it, working it — whatever the plate would have done on a screen
   * where tapping a plate played it.
   */
  action?: { readonly label: string; readonly onSelect: () => void };
  /** Escape, the backdrop and the Close plate all arrive here. */
  onClose: () => void;
  /** The plate itself, rendered at a size worth reading. */
  children: ReactNode;
};

/**
 * One card, held up to the light.
 *
 * Sideways on a phone a plate is about sixty pixels across — enough to tell
 * the cards apart by their band and their name, and nowhere near enough to
 * read a formula off. So the face up there is a summary on purpose (see the
 * short-landscape block in `game.module.css`, which puts the name on one line,
 * holds the symbols to one line and takes the prestige off), and this is where
 * the rest of it went.
 *
 * Both halves, deliberately: the plate again at a size that can be read, and
 * the same card in sentences beside it. The symbols are what the player has to
 * learn to read at a glance on the board, so the zoom teaches them rather than
 * replacing them — the words are the answer key, not the card.
 *
 * A native `<dialog>` like every other panel here, so it lands in the browser's
 * top layer above the market row it may have been opened from, Escape closes
 * it, and focus stays inside.
 */
export function CardZoom({ card, buildCost, note, action, onClose, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  // Mounted only while the card is up, so opening on mount is the whole of it.
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  /** Escape, which the browser delivers as `cancel` and nothing else. */
  function onCancel(event: SyntheticEvent<HTMLDialogElement>) {
    event.preventDefault();
    onClose();
  }

  /**
   * A modal dialog fills the viewport with its backdrop, so a click outside
   * the panel still lands on the dialog itself. That is what tells the two
   * apart.
   */
  function onBackdropClick(event: MouseEvent<HTMLDialogElement>) {
    if (event.target === ref.current) onClose();
  }

  const printed = card.kind === "blueprint" ? (buildCost ?? card.buildCost) : undefined;

  return (
    <dialog
      ref={ref}
      className={styles.zoomModal}
      aria-labelledby={titleId}
      onCancel={onCancel}
      onClick={onBackdropClick}
    >
      <div className={styles.zoomCard}>{children}</div>

      <div className={styles.zoomSide}>
        <h2 className={styles.zoomName} id={titleId}>
          {card.name}
        </h2>

        <dl className={styles.zoomFacts}>
          {card.kind === "blueprint" ? (
            <>
              <Fact term="Type">{capitalised(card.type)}</Fact>
              <Fact term="Build">
                <ResourceText>
                  {`Discard a ${card.tool} blueprint` +
                    (printed && (printed.metal > 0 || printed.energy > 0 || printed.goods > 0)
                      ? `, ${describeResources(printed)}`
                      : "")}
                </ResourceText>
              </Fact>
              <Fact term="Work">
                {card.perk && (
                  <ResourceText>
                    {`${capitalised(describePerkCost(card.perk))} — ` +
                      `${describeEffect(card.perk.effect)}`}
                  </ResourceText>
                )}
              </Fact>
              <Fact term="Always">
                {card.passive && <ResourceText>{describePassive(card.passive)}</ResourceText>}
              </Fact>
              <Fact term="Scores">
                {card.prestige ? (
                  <ResourceText>
                    {`${card.prestige} prestige` +
                      (card.prestigeBonus
                        ? `, and ${card.prestigeBonus} prestige more for holding any`
                        : "")}
                  </ResourceText>
                ) : null}
              </Fact>
            </>
          ) : (
            <>
              <Fact term="Type">Contractor — one engagement, then gone</Fact>
              <Fact term="Cost">
                {card.extraCost &&
                (card.extraCost.metal > 0 ||
                  card.extraCost.energy > 0 ||
                  card.extraCost.goods > 0) ? (
                  <ResourceText>
                    {`Its slot's blueprint token, and ${describeResources(card.extraCost)}`}
                  </ResourceText>
                ) : (
                  "Its slot's blueprint token"
                )}
              </Fact>
              <Fact term="Gives">
                <ResourceText>{describeEffect(card.effect)}</ResourceText>
              </Fact>
            </>
          )}
          <Fact term="Note">{note && <ResourceText>{note}</ResourceText>}</Fact>
        </dl>

        {/*
          * The way out, and — where the plate had one — the move the plate
          * would have played. A tap has to reach the card's move somehow, and
          * on this screen the tap itself is spent on opening the card.
          */}
        <div className={styles.zoomActions}>
          {action && (
            <PlateButton
              onClick={() => {
                onClose();
                action.onSelect();
              }}
            >
              {action.label}
            </PlateButton>
          )}
          <PlateButton onClick={onClose}>Close</PlateButton>
        </div>
      </div>
    </dialog>
  );
}
