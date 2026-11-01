import { defineConfig } from "vitest/config";

// base "./" keeps asset URLs relative so the built site works from any subfolder.
export default defineConfig({
  base: "./",
  server: { port: 5201, strictPort: true },
  // Exporting a bust through Manifold takes seconds, not milliseconds (and the first call loads the WASM)
  test: { testTimeout: 60000 },
});
