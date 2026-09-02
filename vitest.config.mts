import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    // The engine and the AI are pure TypeScript — no DOM needed.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
