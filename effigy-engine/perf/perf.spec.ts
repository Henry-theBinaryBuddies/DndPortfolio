import { mkdirSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// How long the built site takes, as a visitor would meet it (npm run perf; see docs/TECHNICAL.md, section 10). It runs
// against the production build, so it is also the check that the built site works, which the browser tests in e2e/
// (on the dev server) cannot be: an export from the build is asked for at the end, and must succeed.
//
//   CPU=4   slows the page's CPU four times (Chromium's throttling; it does not reach the workers, so clothing fits
//           and the export are timed at this machine's speed)
//   NET=1   throttles the network to 20 Mbps down, 40 ms latency
//
// The times are written to test-results/perf-cpu<CPU><-net>.json. Frame rates are not measured here: a headless
// browser's frames are paced by the browser, not the screen (see TECHNICAL.md for how the drawing was timed).

const CPU = Number(process.env.CPU ?? 1);
const NET = process.env.NET === "1";

const measures = (page: Page, name: string) => page.evaluate((n) => performance.getEntriesByName(n).map((e) => Math.round(e.duration)), name);
const clear = (page: Page) => page.evaluate(() => performance.clearMeasures());

// Sets the menu that has the option `marker` ("mail" for the outfit, "cowl" for the cloak, "dragonborn" for the race)
async function choose(page: Page, value: string, marker = value) {
  await page.evaluate(
    ([v, m]) => {
      const select = [...document.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === m))!;
      select.value = v;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    },
    [value, marker],
  );
}

// Waits until the carved build of the settings just chosen has landed (each build is a User Timing measure: see main.ts)
async function settled(page: Page) {
  await page.waitForFunction(() => performance.getEntriesByName("effigy:carved build").length > 0, undefined, { timeout: 180000 });
  await page.waitForTimeout(500);
}

test("the built site, timed", async ({ page }) => {
  test.setTimeout(900000);
  const cdp = await page.context().newCDPSession(page);
  if (CPU > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
  if (NET) await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 40, downloadThroughput: 20e6 / 8, uploadThroughput: 5e6 / 8 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const result: Record<string, unknown> = { cpu: CPU, net: NET };

  // Opening it: the first bust (the first build of any kind), then the carved one
  const opened = Date.now();
  await page.goto("/");
  await page.waitForFunction(() => performance.getEntriesByType("measure").some((e) => e.name.endsWith(" build")), undefined, { timeout: 300000 });
  result.firstBust = Date.now() - opened;
  await settled(page);
  result.firstCarved = Date.now() - opened;

  // A face slider dragged five steps: each step's draft, then the carved build once it is still
  await clear(page);
  await page.evaluate(async () => {
    const input = [...document.querySelectorAll<HTMLInputElement>('input[type="range"]')].find((i) => !i.closest("[hidden]"))!;
    for (const v of [0.3, 0.35, 0.4, 0.45, 0.5]) {
      input.value = String(Number(input.min) + v * (Number(input.max) - Number(input.min)));
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 120));
    }
  });
  await settled(page);
  result.slider = { editToDraft: await measures(page, "effigy:edit to draft"), carved: await measures(page, "effigy:carved build") };

  // Clothes: the fit (in its worker) and the build, and the whole wait from choosing to the carved bust
  const dress = async (label: string, steps: [string, string][]) => {
    await clear(page);
    const start = Date.now();
    for (const [value, marker] of steps) await choose(page, value, marker);
    await settled(page);
    result[label] = { wall: Date.now() - start, fit: await measures(page, "effigy:fit clothes"), carved: await measures(page, "effigy:carved build") };
  };
  await dress("humanArmourCowl", [["armour", "mail"], ["cowl", "cowl"]]);
  await dress("humanMail", [["none", "cowl"], ["mail", "mail"]]);
  await dress("humanBare", [["none", "mail"]]);

  // The Dragonborn: its model (11 MB) is loaded the first time it is chosen
  await dress("dragonbornFirst", [["dragonborn", "dragonborn"]]);
  await dress("dragonbornMailCloak", [["mail", "mail"], ["cloak", "cowl"]]);
  await dress("dragonbornArmourCloak", [["armour", "mail"]]);

  // The print, full size: it must come out
  await page.click("#show-output");
  await page.evaluate(() => {
    const tabletop = document.querySelector<HTMLInputElement>("#export-tabletop")!;
    if (tabletop.checked) tabletop.click();
  });
  const start = Date.now();
  await page.click("#export-stl");
  await page.waitForFunction(() => /Exported|failed|could not/i.test(document.querySelector("#export-status")?.textContent ?? ""), undefined, { timeout: 300000 });
  result.exportFullSize = Date.now() - start;
  const status = (await page.textContent("#export-status")) ?? "";

  mkdirSync("test-results", { recursive: true });
  writeFileSync(`test-results/perf-cpu${CPU}${NET ? "-net" : ""}.json`, JSON.stringify(result, null, 1));
  console.log(JSON.stringify(result, null, 1));
  expect(status, "the export from the built site").toMatch(/^Exported .*One solid/);
  expect(errors).toEqual([]);
});
