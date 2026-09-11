/**
 * Whether the particle canvas is compiled in at all.
 *
 * On by default: it is a feature and not a debug tool. The flag exists because
 * `three` plus R3F is the single largest thing this game depends on — 232 kB
 * gzipped against 235 kB for the entire rest of the game — and a dependency
 * that size should stay one environment variable away from being off, rather
 * than a revert away.
 *
 * Note what "off" means, precisely: the canvas is never rendered, so the chunk
 * is never *fetched* and a visitor pays nothing for it. It is still *emitted*
 * — Turbopack builds a chunk for a dynamic import whether or not the branch
 * that reaches it survives folding, which was measured rather than assumed.
 * Deleting the 232 kB from the build output means removing the import, which
 * is what `src/effects` being a single self-contained directory is for.
 *
 * Inlined the same way as `NEXT_PUBLIC_DEV_TOOLS`; see the note in
 * next.config.ts for why the default has to be declared there.
 */
export const EMBERS = process.env.NEXT_PUBLIC_EMBERS !== "0";
