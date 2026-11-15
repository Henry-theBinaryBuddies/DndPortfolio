import { defineConfig } from "@playwright/test";

// Browser tests (npm run test:browser): the real app in a real browser, including automated accessibility checks.
// They start their own dev server on port 5207, so a server already running on 5205 is left alone.
// On Windows they drive the installed Microsoft Edge (the same Chromium engine), so no browser download is needed;
// set PW_CHANNEL=chromium to use Playwright's own Chromium instead (after `npx playwright install chromium`).
const channel = process.env.PW_CHANNEL ?? (process.platform === "win32" ? "msedge" : undefined);

export default defineConfig({
  testDir: "e2e",
  timeout: 30000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5207",
    browserName: "chromium",
    channel: channel === "chromium" ? undefined : channel,
    headless: true,
    viewport: { width: 1280, height: 800 },
  },
  webServer: {
    command: "npx vite --port 5207 --strictPort",
    url: "http://localhost:5207",
    reuseExistingServer: true,
    timeout: 60000,
  },
});
