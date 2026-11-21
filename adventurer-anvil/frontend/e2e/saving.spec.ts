// Saving and opening in a real browser: a character saves itself and is listed after a reload; it downloads as a
// file, is deleted (after asking), and opens again from that file; a file that is already saved asks Replace or
// Keep both; a second tab's change pauses saving here; a bad file is explained; and WCAG checks on a wide screen and
// a phone. Each test starts with empty browser storage.
import AxeBuilder from "@axe-core/playwright";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

const stepButton = (page: Page, name: RegExp) => page.getByRole("navigation", { name: "Steps" }).getByRole("button", { name });
const fileInput = (page: Page) => page.locator('input[type="file"][aria-label="Character file"]');
const saved = (page: Page) => page.locator("header").getByText(/^Saved /);

/** A new dwarf named `name`, saved. */
async function makeDwarf(page: Page, name: string, phone = false) {
  await page.getByRole("group", { name: "Choose a race" }).getByText("Dwarf", { exact: true }).click();
  if (phone) {
    for (const n of ["Abilities", "Class", "Background", "Equipment", "Spells", "Details"]) await page.locator(".mobile-bar").getByRole("button", { name: `Next: ${n}` }).click();
  } else {
    await stepButton(page, /^Details/).click();
  }
  await page.getByRole("textbox", { name: "Name" }).fill(name);
  await expect(saved(page)).toBeVisible();
}

test("a character saves itself, is listed after a reload, and opens again", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("header").getByText("Not saved yet")).toBeVisible(); // a blank character isn't saved
  await makeDwarf(page, "Borin Stonehelm");

  await page.reload();
  await expect(page.getByRole("heading", { name: "My characters", level: 1 })).toBeVisible();
  const row = page.getByRole("list", { name: "Saved characters" }).getByRole("listitem");
  await expect(row).toHaveCount(1);
  await expect(row).toContainText("Borin Stonehelm");
  await expect(row).toContainText("Dwarf");
  await expectAccessible(page);

  await page.getByRole("button", { name: "Open Borin Stonehelm" }).click();
  await expect(page.locator("header .name")).toHaveText("Borin Stonehelm");
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  await expect(stepButton(page, /^Details, done/)).toBeVisible();

  // Back to the list, then a new character beside it.
  await page.getByRole("button", { name: "Characters" }).click();
  await page.getByRole("button", { name: "New character" }).click();
  await expect(page.locator("header .name")).toHaveText("New character");
  await page.getByRole("button", { name: "Characters" }).click();
  await expect(page.getByRole("list", { name: "Saved characters" }).getByRole("listitem")).toHaveCount(1); // the blank wasn't saved
});

test("download, delete after asking, and open the file again; a saved one asks Replace or Keep both", async ({ page }) => {
  await page.goto("/");
  await makeDwarf(page, "Borin Stonehelm");
  await page.getByRole("navigation", { name: "Steps" }).getByRole("button", { name: "Review" }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download character file" }).click()]);
  expect(download.suggestedFilename()).toBe("borin-stonehelm.anvil.json");
  const file = await download.path();
  const json = JSON.parse(readFileSync(file, "utf8"));
  expect(json).toMatchObject({ format: "adventurer-anvil-character", name: "Borin Stonehelm", choices: { race: "srd-5.1:dwarf" } });

  await page.getByRole("button", { name: "Characters" }).click();
  await page.getByRole("button", { name: "Delete Borin Stonehelm" }).click();
  await expect(page.getByText("Delete Borin Stonehelm? This can't be undone.")).toBeVisible();
  await expectAccessible(page);
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText("No saved characters yet.")).toBeVisible();

  await fileInput(page).setInputFiles(file);
  await expect(page.locator("header .name")).toHaveText("Borin Stonehelm");
  await page.getByRole("button", { name: "Characters" }).click();

  // The same file again: it is already saved.
  await fileInput(page).setInputFiles(file);
  await expect(page.getByRole("heading", { name: "Borin Stonehelm is already saved here" })).toBeVisible();
  await expectAccessible(page);
  await page.getByRole("button", { name: "Keep both" }).click();
  await expect(page.locator("header .name")).toHaveText("Borin Stonehelm (copy)");
  await page.getByRole("button", { name: "Characters" }).click();
  await expect(page.getByRole("list", { name: "Saved characters" }).getByRole("listitem")).toHaveCount(2);

  await fileInput(page).setInputFiles(file);
  await page.getByRole("button", { name: "Replace the saved one" }).click();
  await expect(page.locator("header .name")).toHaveText("Borin Stonehelm");
  await page.getByRole("button", { name: "Characters" }).click();
  await expect(page.getByRole("list", { name: "Saved characters" }).getByRole("listitem")).toHaveCount(2);
});

test("a file that isn't a character is explained, and nothing is saved", async ({ page }) => {
  await page.goto("/");
  await makeDwarf(page, "Borin");
  await page.getByRole("button", { name: "Characters" }).click();
  await fileInput(page).setInputFiles({ name: "notes.json", mimeType: "application/json", buffer: Buffer.from('{"hello": 1}') });
  await expect(page.getByRole("alert")).toHaveText("“notes.json” couldn't be opened. This isn't an Adventurer Anvil character file.");
  await fileInput(page).setInputFiles({ name: "broken.json", mimeType: "application/json", buffer: Buffer.from("{ not json") });
  await expect(page.getByRole("alert")).toHaveText("“broken.json” couldn't be opened. This file isn't readable: it isn't JSON.");
  await expect(page.getByRole("list", { name: "Saved characters" }).getByRole("listitem")).toHaveCount(1);
});

test("a change in another tab pauses saving here until a copy is chosen", async ({ page, context }) => {
  await page.goto("/");
  await makeDwarf(page, "Borin");

  const other = await context.newPage();
  await other.goto("/");
  await other.getByRole("button", { name: "Open Borin" }).click();
  await other.getByRole("navigation", { name: "Steps" }).getByRole("button", { name: /^Details/ }).click();
  await other.getByRole("textbox", { name: "Name" }).fill("Borin the Bold");
  await expect(saved(other)).toBeVisible();

  await expect(page.getByText("This character was changed in another tab. Saving here is paused.")).toBeVisible();
  await expectAccessible(page);
  await page.getByRole("button", { name: "Reload it" }).click();
  await expect(page.locator("header .name")).toHaveText("Borin the Bold");
  await expect(page.getByRole("textbox", { name: "Name" })).toHaveValue("Borin the Bold");
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 } });
  test("the list fits, and nothing scrolls sideways", async ({ page }) => {
    await page.goto("/");
    await makeDwarf(page, "Borin Stonehelm of the Iron Hills", true);
    await page.getByRole("button", { name: "Characters" }).click();
    const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(scroll).toBeLessThanOrEqual(client);
    await expectAccessible(page);
  });
});
