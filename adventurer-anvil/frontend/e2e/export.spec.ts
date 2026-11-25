// The Tome & Tile export in a real browser: from Review (an unfinished character warns first) and from the list of
// characters, downloading a Creature file in Protobuf JSON. Each test starts with empty storage.
import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

const stepButton = (page: Page, name: RegExp) => page.getByRole("navigation", { name: "Steps" }).getByRole("button", { name });
const group = (page: Page, name: string | RegExp) => page.getByRole("group", { name });

/** A Fighter named Borin, with every other step left to do. */
async function borin(page: Page) {
  await page.goto("/");
  await stepButton(page, /^Class/).click();
  await group(page, "Choose a class").getByText("Fighter", { exact: true }).click();
  await stepButton(page, /^Details/).click();
  await page.getByRole("textbox", { name: "Name" }).fill("Borin");
  await expect(page.locator("header").getByText(/^Saved /)).toBeVisible();
}

test("from Review: an unfinished character warns first, then downloads a Creature file", async ({ page }) => {
  await borin(page);
  await stepButton(page, /^Review/).click();
  await page.getByRole("button", { name: "Export for Tome & Tile" }).click();
  const warning = page.getByRole("alert").filter({ hasText: "Before you export for Tome & Tile" });
  await expect(warning).toContainText("Not finished: Race, Abilities, Class, Background, Equipment still to do.");
  await expectAccessible(page);

  const [download] = await Promise.all([page.waitForEvent("download"), warning.getByRole("button", { name: "Download anyway" }).click()]);
  expect(download.suggestedFilename()).toBe("borin.creature.json");
  const json = JSON.parse(readFileSync(await download.path(), "utf8"));
  expect(json).toMatchObject({ kind: "CREATURE_KIND_PLAYER_CHARACTER", edition: "RULES_EDITION_2014", name: "Borin", summary: "Fighter 1", provenance: { source: "adventurers-anvil" } });
  expect(json.resources).toContainEqual({ key: "second_wind", label: "Second Wind", current: 1, max: 1 });
  await expect(warning).toHaveCount(0);
});

test("from the list of characters, and from the Sheet", async ({ page }) => {
  await borin(page);
  await stepButton(page, /^Sheet/).click();
  await expect(page.getByRole("button", { name: "Export for Tome & Tile" })).toBeVisible();
  await page.getByRole("button", { name: "Characters" }).click();
  await page.getByRole("button", { name: "Export for Tome & Tile Borin" }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download anyway" }).click()]);
  expect(download.suggestedFilename()).toBe("borin.creature.json");
});
