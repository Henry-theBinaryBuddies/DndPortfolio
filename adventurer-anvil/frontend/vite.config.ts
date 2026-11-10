import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// base "./" keeps asset and pack URLs relative, so the built site works from any subfolder.
// The dev server always uses port 5205 and refuses to start if it is taken (Creature Cauldron uses 5199,
// Effigy Engine 5201 and 5203), because the Milestone 2 API will only accept requests from known page addresses.
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: { port: 5205, strictPort: true },
  preview: { port: 5206, strictPort: true },
});
