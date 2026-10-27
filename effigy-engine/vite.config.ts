import { defineConfig } from "vite";

// base "./" keeps asset URLs relative so the built site works from any subfolder.
export default defineConfig({
  base: "./",
  server: { port: 5201, strictPort: true },
});
