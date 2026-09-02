import type { Card } from "@/engine";
import { CardView } from "./CardView";
import styles from "./game.module.css";

type Props = {
  cards: readonly Card[];
  deckSize: number;
};

export function Marketplace({ cards, deckSize }: Props) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionTitle}>Marketplace · {deckSize} in deck</div>
      {cards.length === 0 ? (
        <p className={styles.empty}>The marketplace is empty.</p>
      ) : (
        <div className={styles.cardRow}>
          {cards.map((card) => (
            <CardView key={card.id} card={card} />
          ))}
        </div>
      )}
    </section>
  );
}
