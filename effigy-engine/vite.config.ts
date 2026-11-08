import { defineConfig } from "vitest/config";

// base "./" keeps asset URLs relative so the built site works from any subfolder.
export default defineConfig({
  base: "./",
  server: { port: 5201, strictPort: true },
  // Exporting a bust through Manifold takes seconds, not milliseconds (and the first call loads the WASM)
  // (the browser tests in e2e/ are Playwright's: see playwright.config.ts)
  test: { testTimeout: 60000, exclude: ["e2e/**", "perf/**", "node_modules/**"] },
});
