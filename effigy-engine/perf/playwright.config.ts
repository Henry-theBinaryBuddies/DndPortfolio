import { defineConfig } from "@playwright/test";

// The timing run (npm run perf): the production build, served by vite preview on a port of its own, in headless
// Chromium on the machine's own GPU. Run `npm run build` first (npm run perf does).
export default defineConfig({
  testDir: ".",
  workers: 1,
  reporter: [["list"]],
  outputDir: "../test-results/perf",
  use: {
    baseURL: "http://localhost:5204",
    browserName: "chromium",
    headless: true,
    viewport: { width: 1280, height: 800 },
    acceptDownloads: true,
    launchOptions: { args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] },
  },
  webServer: { command: "npx vite preview --port 5204 --strictPort", cwd: "..", url: "http://localhost:5204", reuseExistingServer: false, timeout: 60000 },
});
