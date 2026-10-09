import path from "node:path";
import { defineConfig } from "vitest/config";

/** Opt-in performance smoke: `npm run test:perf`. Kept out of the default suite and CI. */
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    globals: true,
    include: ["tests/perf/**/*.spec.ts"],
    setupFiles: ["tests/setup.ts"],
    testTimeout: 600_000,
    hookTimeout: 120_000,
    pool: "forks",
  },
});
