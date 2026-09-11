import type { BlueprintCard, CardPool, ContractorMarket } from "@/engine";
import { BLUEPRINT_TOOL_GLYPHS, BLUEPRINT_TOOL_SWATCHES } from "@/lib/colors";
import { CardView } from "./CardView";
import styles from "./game.module.css";

/**
 * A plan, drawn the way the cards in the pile under it will be: white line on
 * blueprint navy, the inversion the theme saves for a building nobody has
 * raised yet. A saw-tooth shed and a stack, which is the silhouette every
 * Production card in the deck is some version of.
 */
function PlanArt() {
  return (
    <svg
      className={styles.deckArt}
      viewBox="0 0 120 104"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      {/* The saw-tooth roof, vertical at the back and sloped to the front. */}
      <path d="M20 54 V44 L36 54 V44 L52 54 V44 L68 54 V44 L84 54" />
      <path d="M20 54 H84 V88 H20 Z" />
      <path d="M94 88 V32 H106 V88" />
      {/* The cap on the stack, wider than the stack itself. */}
      <path d="M91 32 H109" />
      <path d="M30 70 H40 V88 H30 Z" />
      <path d="M54 64 H68 V74 H54 Z" />
      <path d="M8 88 H114" />
      {/* A dimension line, because that is what says "plan" and not "picture". */}
      <path d="M20 98 H84 M20 94 v8 M84 94 v8" strokeWidth="1" />
    </svg>
  );
}

/**
 * The pile a row is dealt from, drawn as the face-down card it actually is.
 *
 * A plate the same size as every other card in the row, so the market reads
 * as five cards rather than four and a counter — and so the row it feeds is
 * obvious from where it sits rather than from a heading.
 *
 * The counts live here rather than in the section title above. They are facts
 * about the pile, and a pile that is drawn should be the thing that says how
 * deep it is; printing them twice, a centimetre apart, reads as a bug.
 */
function Deck({
  kind,
  deck,
  discard,
}: {
  kind: "contractor" | "blueprint";
  deck: readonly unknown[];
  discard: readonly unknown[];
}) {
  const label =
    `${deck.length} ${kind}${deck.length === 1 ? "" : "s"} left in the deck` +
    (discard.length > 0 ? `, ${discard.length} discarded` : "");

  return (
    <div
      className={`${styles.card} ${styles.deck} ${
        kind === "contractor" ? styles.deckTape : styles.deckPlan
      }`}
      role="img"
      aria-label={label}
      title={label}
    >
      {kind === "blueprint" && <PlanArt />}
      <span className={styles.deckBand}>
        <span className={styles.deckCount}>{deck.length}</span>
        <span className={styles.deckNote}>
          in deck{discard.length > 0 ? ` · ${discard.length} discarded` : ""}
        </span>
      </span>
    </div>
  );
}

/**
 * Which market cards can be taken right now, and what taking one does. Empty
 * outside the Market Phase and while the opponent is thinking, which is what
 * makes the row inert then.
 */
export type MarketInteraction = {
  readonly takeable: ReadonlySet<string>;
  /**
   * Face-up blueprints a Replicator mid-choice could copy. Empty the rest of
   * the time, which is most of it.
   */
  readonly copyable: ReadonlySet<string>;
  /** The contractor waiting for the player to choose a payment, if any. */
  readonly choosingPaymentFor: string | null;
  readonly onSelect: (cardId: string) => void;
};

type RowProps = {
  interaction?: MarketInteraction;
};

/**
 * The contractor row. Each slot carries a tool token above it: taking the card
 * costs a blueprint of that type from hand.
 */
function ContractorRow({ market, interaction }: { market: ContractorMarket } & RowProps) {
  return (
    <div>
      <div className={styles.sectionTitle}>Contractors</div>
      <div className={styles.cardRow}>
        {/* The pile the row is dealt from, at the head of the row it feeds. */}
        <Deck kind="contractor" deck={market.deck} discard={market.discard} />
        {market.slots.map((slot, index) => (
          <div key={`${slot.token}-${index}`} className={styles.slot}>
            <span
              className={styles.token}
              style={BLUEPRINT_TOOL_SWATCHES[slot.token]}
              title={`Costs a ${slot.token} blueprint`}
              aria-label={`Costs a ${slot.token} blueprint`}
              role="img"
            >
              {BLUEPRINT_TOOL_GLYPHS[slot.token]}
            </span>
            {slot.card ? (
              <CardView
                card={slot.card}
                highlight={interaction?.takeable.has(slot.card.id)}
                selected={interaction?.choosingPaymentFor === slot.card.id}
                onSelect={
                  interaction?.takeable.has(slot.card.id)
                    ? () => interaction.onSelect(slot.card!.id)
                    : undefined
                }
                selectLabel={`Take ${slot.card.name}, paying a ${slot.token} blueprint`}
              />
            ) : (
              <div className={`${styles.card} ${styles.cardEmpty}`}>
                <span className={styles.empty}>Deck and discard exhausted</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function BlueprintRow({ pool, interaction }: { pool: CardPool<BlueprintCard> } & RowProps) {
  const copying = (interaction?.copyable.size ?? 0) > 0;

  return (
    <div>
      <div className={styles.sectionTitle}>Blueprints</div>
      {/* Only while a Replicator is waiting to be told which card to work. */}
      {copying && (
        <p className={styles.prompt}>Click a highlighted blueprint to work it from here.</p>
      )}
      {/*
        * The deck is drawn whether or not the row it feeds has anything on it:
        * an empty row beside a deck with cards left is a state worth being
        * able to see, and it is the one the message below is about.
        */}
      <div className={styles.cardRow}>
        <Deck kind="blueprint" deck={pool.deck} discard={pool.discard} />
        {pool.row.length === 0 ? (
          <p className={styles.empty}>This row is empty.</p>
        ) : (
          pool.row.map((card) => {
            // Taking and copying are never on offer at once — one is a Market
            // Phase move and the other a Work Phase one.
            const live =
              interaction?.takeable.has(card.id) || interaction?.copyable.has(card.id);
            return (
              <CardView
                key={card.id}
                card={card}
                highlight={live}
                onSelect={live ? () => interaction?.onSelect(card.id) : undefined}
                selectLabel={
                  interaction?.copyable.has(card.id) ? `Work ${card.name}` : `Draft ${card.name}`
                }
              />
            );
          })
        )}
      </div>
    </div>
  );
}

type Props = {
  contractors: ContractorMarket;
  blueprints: CardPool<BlueprintCard>;
  interaction?: MarketInteraction;
};

/** The market: a tokened contractor row above a blueprint row. */
export function Marketplace({ contractors, blueprints, interaction }: Props) {
  return (
    <section className={styles.section}>
      <ContractorRow market={contractors} interaction={interaction} />
      <BlueprintRow pool={blueprints} interaction={interaction} />
    </section>
  );
}
