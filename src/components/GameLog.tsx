import styles from "./game.module.css";

export function GameLog({ entries }: { entries: readonly string[] }) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionTitle}>Log</div>
      {/* Reversed by CSS so the newest line sits on top without copying the array. */}
      <ul className={styles.log}>
        {entries.map((entry, index) => (
          <li key={`${index}-${entry}`}>{entry}</li>
        ))}
      </ul>
    </section>
  );
}
