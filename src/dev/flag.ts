/**
 * Whether the in-game debug tools are compiled in at all.
 *
 * Next inlines `process.env.NEXT_PUBLIC_*` at build time, so in a production
 * build with `NEXT_PUBLIC_DEV_TOOLS` unset both halves fold to `false`, the
 * `DEV_TOOLS && <DevPanel />` branch is dropped, and nothing under `src/dev`
 * is reachable from the deployed bundle.
 *
 * On during `next dev` without any setup, because a tool you have to remember
 * to switch on is a tool you forget you have. Set the variable to `1` to keep
 * it in a production build — useful for testing the real bundle locally, and
 * the reason this is a flag rather than a bare `NODE_ENV` check.
 */
export const DEV_TOOLS =
  process.env.NEXT_PUBLIC_DEV_TOOLS === "1" || process.env.NODE_ENV !== "production";
