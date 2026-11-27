import { defineConfig } from "@playwright/test";

// The built site under its real headers (npm run test:production): builds the app, serves dist/ with `vite preview`
// (which sends the headers in public/_headers, as Cloudflare Pages does) and runs e2e-production/ against it.
// To check the live site instead: PW_BASE_URL=https://anvil.creaturecauldron.com npm run test:production
const channel = process.env.PW_CHANNEL ?? (process.platform === "win32" ? "msedge" : undefined);
const live = process.env.PW_BASE_URL;

export default defineConfig({
  testDir: "e2e-production",
  timeout: 30000,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: live ?? "http://localhost:5208",
    browserName: "chromium",
    channel: channel === "chromium" ? undefined : channel,
    headless: true,
    viewport: { width: 1280, height: 800 },
  },
  webServer: live
    ? undefined
    : { command: "npm run build && npx vite preview --port 5208 --strictPort", url: "http://localhost:5208", reuseExistingServer: false, timeout: 180000 },
});
