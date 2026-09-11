import type { ComponentProps } from "react";
import { m } from "motion/react";
import styles from "./game.module.css";

/**
 * Every button on the board: a brushed brass plate that gives when pressed.
 *
 * The squash is two percent and the spring lets it release back past its own
 * size — anticipation and overshoot, at an amplitude nobody consciously sees.
 * It is the difference between a plate and a rectangle that changes colour.
 *
 * The downward travel is Motion's rather than the stylesheet's. Both want
 * `transform`, and an inline one written per frame beats a rule in a file, so
 * `:active` in the CSS keeps only the lighting.
 */
type Props = Omit<ComponentProps<typeof m.button>, "className"> & {
  /** A plate that spans its column, like New game, rather than one in a row. */
  full?: boolean;
};

export function PlateButton({ full = false, disabled, children, ...rest }: Props) {
  return (
    <m.button
      type="button"
      className={full ? styles.resetButton : styles.moveButton}
      disabled={disabled}
      whileTap={disabled ? undefined : { scale: 0.975, y: 1 }}
      transition={{ type: "spring", stiffness: 700, damping: 26, mass: 0.5 }}
      {...rest}
    >
      {children}
    </m.button>
  );
}
