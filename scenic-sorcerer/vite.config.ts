import { defineConfig } from "vitest/config";

// base "./" keeps asset URLs relative so the built site works from any subfolder.
export default defineConfig({
  base: "./",
  server: { port: 5202, strictPort: true },
});
