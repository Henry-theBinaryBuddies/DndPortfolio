// The character sheet in a real browser, with the SRD pack: from the step list and from the list of characters; the
// notice for an unfinished character; a DM ruling marked on it; the boxes to fill in by hand; printing (black on
// white in three columns, without the app's frame, each page on its own paper, long text only when asked); and WCAG
// checks on a wide screen and a phone. Each test starts with empty storage.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

const stepButton = (page: Page, name: RegExp) => page.getByRole("navigation", { name: "Steps" }).getByRole("button", { name });
const group = (page: Page, name: string | RegExp) => page.getByRole("group", { name });
const sheet = (page: Page) => page.locator(".sheet");

/** A Fighter 1 / Wizard 1 named Borin, with every score 10: short of the Wizard's Int 13, which a DM allows. */
async function borin(page: Page) {
  await page.goto("/");
  await stepButton(page, /^Class/).click();
  await group(page, "Choose a class").getByText("Fighter", { exact: true }).click();
  await page.getByRole("spinbutton", { name: "Level" }).fill("2");
  await page.getByRole("region", { name: "Other classes (multiclassing)" }).getByRole("button", { name: /one more for Wizard/ }).click();
  await stepButton(page, /^Details/).click();
  await page.getByRole("textbox", { name: "Name" }).fill("Borin");
  await stepButton(page, /^Review/).click();
  await page.getByRole("button", { name: /^Allow… Multiclassing into Wizard/ }).click();
  await page.getByRole("textbox", { name: "Why it's allowed (a short note for the sheet)" }).fill("agreed in session 0");
  await page.getByRole("button", { name: "Allow", exact: true }).click();
}

test("the sheet: the character, a notice while unfinished, and the DM's ruling", async ({ page }) => {
  await borin(page);
  await stepButton(page, /^Sheet/).click();
  await expect(page.getByRole("heading", { name: "Sheet", level: 1 })).toBeFocused();
  await expect(sheet(page).getByRole("heading", { name: "Borin", level: 2 })).toBeVisible();
  await expect(sheet(page).getByText("Fighter 1 / Wizard 1")).toBeVisible();
  await expect(sheet(page).getByText(/^Not finished: \d steps to do/)).toBeVisible();

  const saves = sheet(page).getByRole("region", { name: "Saving throws" });
  await expect(saves.getByRole("listitem").filter({ hasText: "Strength" })).toContainText("Proficient:");
  await expect(saves.getByRole("listitem").filter({ hasText: "Dexterity" })).toContainText("Not proficient:");
  // Boxes to fill in at the table: hit points under their maximum, death saves to tick, uses to tick.
  await expect(sheet(page).getByRole("region", { name: "Hit points" })).toContainText(/Hit point maximum \d+/);
  await expect(sheet(page).getByRole("region", { name: "Death saves" })).toContainText("3 boxes to tick for Successes");
  await expect(sheet(page).getByRole("region", { name: "Limited uses" })).toContainText("1 box to tick for Second Wind");
  await expect(sheet(page).getByRole("region", { name: "Attacks" }).getByRole("columnheader", { name: "Attack bonus" })).toBeVisible();
  const money = sheet(page).getByRole("region", { name: "Character" }).getByRole("region", { name: "Money" });
  for (const coin of ["CP", "SP", "EP", "GP", "PP"]) await expect(money.getByText(coin, { exact: true })).toBeVisible();
  const equipment = sheet(page).getByRole("region", { name: "Equipment and money" }).getByRole("region", { name: "Equipment", exact: true });
  for (const heading of ["Qty", "Item", "E", "A", "lb"]) await expect(equipment.getByRole("columnheader", { name: heading, exact: true }).first()).toBeVisible();
  for (const coin of ["CP", "SP", "EP", "GP", "PP", "Total weight", "Carrying capacity", "Attuned"]) await expect(equipment.getByText(coin, { exact: true })).toBeVisible();
  await expect(sheet(page).getByRole("region", { name: "Features and traits" })).toContainText("Second Wind · Fighter 1");
  const rulings = sheet(page).getByRole("region", { name: "DM rulings" });
  await expect(rulings).toContainText("Multiclassing into Wizard needs Int 13; you have Intelligence 10.");
  await expect(rulings).toContainText("Allowed: “agreed in session 0”.");
  await expectAccessible(page);

  await sheet(page).getByRole("button", { name: "Go to Review" }).click();
  await expect(page.getByRole("heading", { name: "Review", level: 1 })).toBeVisible();
});

test("printing: light, without the app's frame; long text only when asked for", async ({ page }) => {
  await borin(page);
  await stepButton(page, /^Sheet/).click();
  await expect(page.getByRole("button", { name: "Print" })).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("header.top")).toBeHidden();
  await expect(page.getByRole("navigation", { name: "Steps" })).toBeHidden();
  await expect(page.getByRole("button", { name: "Print" })).toBeHidden();
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(255, 255, 255)");
  const layout = await page.evaluate(() => ({
    columns: getComputedStyle(document.querySelector(".sheet-columns")!).gridTemplateColumns.split(" ").length,
    breaks: [...document.querySelectorAll(".sheet-page")].map((p) => getComputedStyle(p).breakAfter),
  }));
  expect(layout.columns).toBe(3);
  expect(layout.breaks.at(0)).toBe("page");
  const text = sheet(page).locator(".item-description").first();
  await expect(text).toHaveCount(1); // there is long text to print, but it waits to be asked for
  await expect(text).toBeHidden();

  await page.emulateMedia({ media: "screen" });
  await page.getByRole("checkbox", { name: "Print full text" }).check();
  await page.emulateMedia({ media: "print" });
  await expect(text).toBeVisible();
});

test("Sheet from the list opens a character straight onto its sheet", async ({ page }) => {
  await borin(page);
  await page.getByRole("button", { name: "Characters" }).click();
  await page.getByRole("button", { name: "Sheet for Borin" }).click();
  await expect(page.getByRole("heading", { name: "Sheet", level: 1 })).toBeVisible();
  await expect(sheet(page).getByRole("heading", { name: "Borin", level: 2 })).toBeVisible();
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 } });
  test("the sheet is one column, and nothing scrolls sideways", async ({ page }) => {
    await page.goto("/");
    for (let i = 0; i < 8; i++) await page.locator(".mobile-bar").getByRole("button", { name: /^Next/ }).click();
    await expect(page.getByRole("heading", { name: "Sheet", level: 1 })).toBeVisible();
    const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(scroll).toBeLessThanOrEqual(client);
    await expectAccessible(page);
  });
});
