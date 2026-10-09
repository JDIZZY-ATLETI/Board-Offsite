import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    // Globals let Testing Library register its afterEach(cleanup) automatically.
    globals: true,
    // UI specs opt into jsdom with a `// @vitest-environment jsdom` pragma.
    include: ["tests/**/*.spec.ts", "tests/**/*.spec.tsx"],
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