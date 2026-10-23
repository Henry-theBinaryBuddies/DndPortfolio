import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./" keeps asset and data URLs relative, so the built site works from
// any subfolder on GitHub Pages.
// The dev server always uses port 5199 (and refuses to start if it is taken, rather than quietly choosing another),
// because the Python service only accepts requests from the page addresses it is configured to allow.
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: { port: 5199, strictPort: true },
});
