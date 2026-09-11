import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Static export: `next build` emits a plain SPA into `out/`, which Wrangler
   * serves from Workers Assets.
   *
   * The trade-off is that there is no server at runtime — no route handlers,
   * no server actions, no image optimization. The whole game runs in the
   * browser, which is what we want for solo play. If you later need a server
   * (multiplayer, anti-cheat, saved games), drop this and move to
   * @opennextjs/cloudflare.
   */
  output: "export",
  images: { unoptimized: true },
  /**
   * Declared here so it is *inlined* rather than looked up at runtime. Left to
   * Next's own `NEXT_PUBLIC_` handling an unset variable compiles to a live
   * `process.env` read, which no bundler can fold — and the debug panel then
   * ships as dead code even though it never renders. Pinned to a literal, the
   * flag folds to `false` and the panel is dropped outright.
   */
  env: {
    NEXT_PUBLIC_DEV_TOOLS: process.env.NEXT_PUBLIC_DEV_TOOLS ?? "",
    /**
     * Same trick, opposite default: embers are on unless switched off, so an
     * unset variable has to inline as something that is not "0" rather than as
     * a live `process.env` read.
     */
    NEXT_PUBLIC_EMBERS: process.env.NEXT_PUBLIC_EMBERS ?? "",
  },
  /** Emits out/index.html style paths, which Workers Assets serves cleanly. */
  trailingSlash: true,
};

export default nextConfig;
