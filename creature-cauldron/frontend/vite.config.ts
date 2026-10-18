import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./" keeps asset and data URLs relative, so the built site works from
// any subfolder on GitHub Pages.
export default defineConfig({
  base: "./",
  plugins: [react()],
});
