// The Details step and Review in a real browser: a suggested name reaching the header, alignment, appearance
// suggestions, personality (moved here from Background), a portrait upload, Review's answers, and a DM ruling made
// and removed; with WCAG checks on a wide screen and a phone.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

const stepButton = (page: Page, name: RegExp) => page.getByRole("navigation", { name: "Steps" }).getByRole("button", { name });
const group = (page: Page, name: string | RegExp) => page.getByRole("group", { name });
/** A 2 × 2 red PNG. */
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==", "base64");

test("a dwarf acolyte: a suggested name, alignment, appearance, personality and a portrait", async ({ page }) => {
  await page.goto("/");
  await group(page, "Choose a race").getByText("Dwarf", { exact: true }).click();
  await stepButton(page, /^Background/).click();
  await group(page, "Choose a background").getByText("Acolyte", { exact: true }).click();
  await stepButton(page, /^Details/).click();
  await expect(page.getByRole("heading", { name: "Details", level: 1 })).toBeVisible();

  await page.getByRole("button", { name: "Suggest name" }).click();
  const name = await page.getByRole("textbox", { name: "Name" }).inputValue();
  expect(name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
  await expect(page.locator("header .name")).toHaveText(name);
  await expect(stepButton(page, /^Details, done/)).toBeVisible();

  await group(page, "Alignment").getByText("Lawful good", { exact: true }).click();
  await page.getByRole("button", { name: "Suggest age for a dwarf" }).click();
  expect(Number(await page.getByRole("textbox", { name: "Age" }).inputValue())).toBeGreaterThanOrEqual(50);
  await page.getByRole("textbox", { name: "Eyes" }).fill("Grey");

  await page.getByText("All suggestions (6) for bond").click();
  await page.getByRole("button", { name: /^I would die to recover an ancient relic/ }).click();
  await expect(page.getByRole("textbox", { name: "Bond" })).toHaveValue(/^I would die to recover an ancient relic/);

  await page.getByLabel("Portrait").setInputFiles({ name: "portrait.png", mimeType: "image/png", buffer: PNG });
  await expect(page.getByRole("img", { name: "Portrait chosen" })).toBeVisible();
  await expectAccessible(page);

  await page.getByRole("navigation", { name: "Steps" }).getByRole("button", { name: "Review" }).click();
  const details = page.getByRole("listitem").filter({ hasText: /^Details/ });
  await expect(details).toContainText(`Name: ${name}`);
  await expect(details).toContainText("Alignment: Lawful good");
  await expect(details).toContainText("Portrait: Added");
  await expect(page.getByRole("listitem").filter({ hasText: /^Race/ })).toContainText("Race: Dwarf");
});

test("Review: a DM allows a rolled-score mismatch with a note, then removes the ruling", async ({ page }) => {
  await page.goto("/");
  await expect(group(page, "Choose a race")).toBeVisible();
  await stepButton(page, /^Abilities/).click();
  await group(page, "How will you set your scores?").getByText("Roll", { exact: true }).click();
  await page.getByRole("button", { name: "Roll", exact: true }).click();
  // Give out the totals: each ability takes the first value still free.
  for (const ability of ["Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma"]) {
    const select = page.getByRole("combobox", { name: `${ability} base score` });
    const free = (await select.locator("option").allTextContents()).find((o) => /^\d+$/.test(o))!;
    await select.selectOption(free);
  }
  await page.getByRole("button", { name: "Roll again" }).click(); // the scores no longer match the latest roll (unless the dice agree)
  const mismatch = page.getByText("These scores don't match your latest roll. Give its totals out again.");
  test.skip(!(await mismatch.first().isVisible()), "the new roll happened to match");

  await page.getByRole("navigation", { name: "Steps" }).getByRole("button", { name: "Review" }).click();
  await page.getByRole("button", { name: /^Allow… These scores don't match/ }).click();
  await page.getByRole("textbox", { name: "Why it's allowed (a short note for the sheet)" }).fill("Rolled at the table with the DM");
  await page.getByRole("button", { name: "Allow", exact: true }).click();
  const rulings = page.getByRole("region", { name: "DM rulings" });
  await expect(rulings).toContainText("Allowed: These scores don't match your latest roll.");
  await expect(rulings).toContainText("“Rolled at the table with the DM”");
  await expect(stepButton(page, /^Abilities, done/)).toBeVisible(); // allowed, so no longer a problem
  await expectAccessible(page);

  await rulings.getByRole("button", { name: "Remove this ruling" }).click();
  await expect(stepButton(page, /^Abilities, has a problem/)).toBeVisible();
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 } });
  test("Details and Review fit, and nothing scrolls sideways", async ({ page }) => {
    await page.goto("/");
    await expect(group(page, "Choose a race")).toBeVisible();
    const next = (n: string) => page.locator(".mobile-bar").getByRole("button", { name: n });
    for (const n of ["Next: Abilities", "Next: Class", "Next: Background", "Next: Equipment", "Next: Spells", "Next: Details"]) await next(n).click();
    const fits = async () => {
      const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      expect(scroll).toBeLessThanOrEqual(client);
    };
    await fits();
    await expectAccessible(page);
    await next("Next: Review").click();
    await fits();
    await expectAccessible(page);
  });
});
