import type { BlueprintCard, CardPool, ContractorMarket } from "@/engine";
import { BLUEPRINT_TYPE_GLYPHS, BLUEPRINT_TYPE_SWATCHES } from "@/lib/colors";
import { CardView } from "./CardView";
import styles from "./game.module.css";

function pileSummary(deck: readonly unknown[], discard: readonly unknown[]): string {
  return `${deck.length} in deck${discard.length > 0 ? ` · ${discard.length} discarded` : ""}`;
}

/**
 * Which market cards can be taken right now, and what taking one does. Empty
 * outside the Market Phase and while the opponent is thinking, which is what
 * makes the row inert then.
 */
export type MarketInteraction = {
  readonly takeable: ReadonlySet<string>;
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
      <div className={styles.sectionTitle}>
        Contractors · {pileSummary(market.deck, market.discard)}
      </div>
      <div className={styles.cardRow}>
        {market.slots.map((slot, index) => (
          <div key={`${slot.token}-${index}`} className={styles.slot}>
            <span
              className={styles.token}
              style={BLUEPRINT_TYPE_SWATCHES[slot.token]}
              title={`Costs a ${slot.token} blueprint`}
              aria-label={`Costs a ${slot.token} blueprint`}
              role="img"
            >
              {BLUEPRINT_TYPE_GLYPHS[slot.token]}
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
  return (
    <div>
      <div className={styles.sectionTitle}>
        Blueprints · {pileSummary(pool.deck, pool.discard)}
      </div>
      {pool.row.length === 0 ? (
        <p className={styles.empty}>This row is empty.</p>
      ) : (
        <div className={styles.cardRow}>
          {pool.row.map((card) => (
            <CardView
              key={card.id}
              card={card}
              highlight={interaction?.takeable.has(card.id)}
              onSelect={
                interaction?.takeable.has(card.id)
                  ? () => interaction.onSelect(card.id)
                  : undefined
              }
              selectLabel={`Draft ${card.name}`}
            />
          ))}
        </div>
      )}
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
  const choosing = interaction?.choosingPaymentFor;

  return (
    <section className={styles.section}>
      {choosing && <p className={styles.prompt}>Click a highlighted blueprint in hand to pay.</p>}
      <ContractorRow market={contractors} interaction={interaction} />
      <BlueprintRow pool={blueprints} interaction={interaction} />
    </section>
  );
}
