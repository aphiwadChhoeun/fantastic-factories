/**
 * Whether the dice are simulated rather than keyframed.
 *
 * Off by default, which is the opposite of `NEXT_PUBLIC_EMBERS` and for a
 * reason docs/dice.md §1.3 gives in as many words: the keyframed throw already
 * lands every die on the face the engine rolled, and Rapier is a WASM build on
 * top of the `three` the board already carries. That is a lot of bytes to buy
 * a tumble nobody has yet said they are missing, so the order was C first,
 * then measure, and this is the thing being measured against.
 *
 * "Off" means the canvas is never rendered, so its chunk is never *fetched* and
 * a visitor pays nothing for it — the same arrangement as the particle canvas,
 * and the reason `src/dice` is a self-contained directory with exactly one
 * import into it. The chunk is still emitted; deleting the bytes from the build
 * output means deleting that import.
 *
 * Inlined the same way as `NEXT_PUBLIC_EMBERS`; see the note in next.config.ts
 * for why the default has to be declared there.
 */
export const DICE_PHYSICS = process.env.NEXT_PUBLIC_DICE_PHYSICS === "1";
