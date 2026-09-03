import type { BlueprintCard, CardPool, ContractorMarket } from "@/engine";
import { BLUEPRINT_TYPE_GLYPHS, BLUEPRINT_TYPE_SWATCHES } from "@/lib/colors";
import { CardView } from "./CardView";
import styles from "./game.module.css";

function pileSummary(deck: readonly unknown[], discard: readonly unknown[]): string {
  return `${deck.length} in deck${discard.length > 0 ? ` · ${discard.length} discarded` : ""}`;
}

/**
 * The contractor row. Each slot carries a tool token above it: taking the card
 * costs a blueprint of that type from hand.
 */
function ContractorRow({ market }: { market: ContractorMarket }) {
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
              <CardView card={slot.card} />
            ) : (
              <div className={`${styles.card} ${styles.cardEmpty}`}>
                <span className={styles.empty}>Empty until cleanup</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function BlueprintRow({ pool }: { pool: CardPool<BlueprintCard> }) {
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
            <CardView key={card.id} card={card} />
          ))}
        </div>
      )}
    </div>
  );
}

type Props = {
  contractors: ContractorMarket;
  blueprints: CardPool<BlueprintCard>;
};

/** The market: a tokened contractor row above a blueprint row. */
export function Marketplace({ contractors, blueprints }: Props) {
  return (
    <section className={styles.section}>
      <ContractorRow market={contractors} />
      <BlueprintRow pool={blueprints} />
    </section>
  );
}
