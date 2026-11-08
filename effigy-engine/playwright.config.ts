import { defineConfig } from "@playwright/test";

// Browser tests (npm run test:browser): the app itself in Chromium, for what needs a real page and WebGL, such as the
// token picture. They start their own dev server on a port of their own, so a server already running on 5201 is left
// alone. WebGL runs in software (SwiftShader) when there is no screen, so renders are slow but the same everywhere.
export default defineConfig({
  testDir: "e2e",
  timeout: 180000,
  expect: { timeout: 60000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5203",
    browserName: "chromium",
    headless: true,
    viewport: { width: 1280, height: 800 },
    acceptDownloads: true,
    launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] },
  },
  webServer: {
    command: "npx vite --port 5203 --strictPort",
    url: "http://localhost:5203",
    reuseExistingServer: true,
    timeout: 60000,
  },
});
