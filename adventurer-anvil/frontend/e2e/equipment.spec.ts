// The Equipment step in a real browser, with the SRD Fighter and Acolyte: packages (lettered choices, a martial
// weapon picked, a holy symbol), what to wear and the Armor Class and attack it gives; starting gold and the shop;
// and WCAG checks on a wide screen and a phone.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

const stepButton = (page: Page, name: RegExp) => page.getByRole("navigation", { name: "Steps" }).getByRole("button", { name });
const group = (page: Page, name: string | RegExp) => page.getByRole("group", { name });
const summary = (page: Page) => page.getByRole("complementary", { name: "Character summary" });

/** Picks the Fighter and the Acolyte, then opens Equipment (by the step list, or the phone's Next buttons). */
async function fighterAcolyte(page: Page) {
  await page.goto("/");
  await expect(group(page, "Choose a race")).toBeVisible();
  const wide = await stepButton(page, /^Class/).isVisible();
  const next = (name: string) => page.locator(".mobile-bar").getByRole("button", { name });
  if (wide) await stepButton(page, /^Class/).click();
  else for (const n of ["Next: Abilities", "Next: Class"]) await next(n).click();
  await group(page, "Choose a class").getByText("Fighter", { exact: true }).click();
  if (wide) await stepButton(page, /^Background/).click();
  else await next("Next: Background").click();
  await group(page, "Choose a background").getByText("Acolyte", { exact: true }).click();
  if (wide) await stepButton(page, /^Equipment/).click();
  else await next("Next: Equipment").click();
  await expect(page.getByRole("heading", { name: "Equipment", level: 1 })).toBeVisible();
}

test("packages: the Fighter's and Acolyte's choices, then chain mail and a shield make AC 18", async ({ page }) => {
  await fighterAcolyte(page);
  await group(page, "How will you equip?").getByText("Class & background packages").click();

  await group(page, /^\(a\) chain mail or \(b\) leather armor/).getByText("Chain Mail", { exact: true }).click();
  await group(page, /^\(a\) a martial weapon and a shield/).getByText("A martial weapon + Shield").click();
  await group(page, "Choose a martial weapon").getByText("Longsword", { exact: true }).click();
  await group(page, /^\(a\) a light crossbow/).getByText("Handaxe × 2").click();
  await group(page, /^\(a\) a dungeoneer's pack/).getByText("Explorer's Pack", { exact: true }).click();
  await group(page, "Choose a holy symbol").getByText("Amulet", { exact: true }).click();
  await group(page, /^\(a\) a prayer book/).getByText("Prayer book", { exact: true }).click();
  await group(page, "What armour do you wear?").getByText("Chain Mail", { exact: true }).click();
  await group(page, "Do you carry a shield?").getByText("Carry a shield", { exact: true }).click();

  await expect(stepButton(page, /^Equipment, done/)).toBeVisible();
  const inventory = page.getByRole("region", { name: "Inventory" });
  await expect(inventory).toContainText("Amulet");
  await expect(inventory).toContainText("Torch × 10 · in Explorer's Pack · Fighter");
  await summary(page).getByRole("button", { name: /^Armor Class/ }).click();
  await expect(summary(page)).toContainText("Armor Class 18 = Chain Mail 16 + Shield 2");
  await expect(summary(page).getByRole("region", { name: "Attacks" })).toContainText("Handaxe");
  await expect(summary(page).getByRole("button", { name: /^Longsword/ })).toContainText("+2 to hit, 1d8 slashing (1d10 two-handed)");
  await expectAccessible(page);
});

test("starting gold: the DM's amount, then the shop spends it and stops at what you can't afford", async ({ page }) => {
  await fighterAcolyte(page);
  await group(page, "How will you equip?").getByText("Starting gold").click();
  await page.getByRole("spinbutton", { name: "Starting gold (gp)" }).fill("100");
  await page.getByRole("searchbox", { name: "Search 230 items" }).fill("sword");
  await page.getByRole("button", { name: "+ buy one Longsword" }).click();
  await expect(page.getByText("Spent 15 gp of 100 gp · 85 gp left")).toBeVisible();
  await page.getByRole("searchbox", { name: "Search 230 items" }).fill("plate");
  await expect(page.getByRole("button", { name: "+ buy one Plate Armor (not enough money)" })).toBeDisabled();
  await summary(page).getByRole("button", { name: /^Money/ }).click();
  await expect(summary(page)).toContainText("Money 85 gp = Starting gold 100 gp − Spent 15 gp");
  await expectAccessible(page);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 } });
  test("the packages and the shop fit, and nothing scrolls sideways", async ({ page }) => {
    await fighterAcolyte(page);
    await group(page, "How will you equip?").getByText("Class & background packages").click();
    const fits = async () => {
      const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      expect(scroll).toBeLessThanOrEqual(client);
    };
    await fits();
    await expectAccessible(page);
    await group(page, "How will you equip?").getByText("Starting gold").click();
    await page.getByRole("spinbutton", { name: "Starting gold (gp)" }).fill("50");
    await page.getByRole("searchbox", { name: "Search 230 items" }).fill("armor");
    await fits();
    await expectAccessible(page);
  });
});
