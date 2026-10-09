import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  // Vite 8 transforms with oxc; tsconfig keeps `jsx: preserve` for Next, so set the runtime here.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    environment: "node",
    // Globals let Testing Library register its afterEach(cleanup) automatically.
    globals: true,
    // UI specs opt into jsdom with a `// @vitest-environment jsdom` pragma.
    include: ["tests/**/*.spec.ts", "tests/**/*.spec.tsx"],
    // Perf smoke is opt-in (vitest.perf.config.ts); e2e runs through Playwright against a live server.
    exclude: ["**/node_modules/**", "tests/perf/**", "tests/e2e/**"],
    setupFiles: ["tests/setup.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
    pool: "forks",
    coverage: {
      provider: "v8",
      include: ["src/lib/**/*.ts"],
      exclude: ["src/lib/**/index.ts", "src/lib/lake/adls-store.ts", "src/lib/pipeline/jobs.ts"],
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage",
    },
  },
});