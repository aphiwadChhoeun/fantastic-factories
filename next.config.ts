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
  /** Emits out/index.html style paths, which Workers Assets serves cleanly. */
  trailingSlash: true,
};

export default nextConfig;
