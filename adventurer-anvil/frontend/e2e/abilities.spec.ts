// The Abilities step in a real browser: each method, its rules, the roll log, switching methods, and WCAG checks.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

const ABILITIES = ["Strength", "Dexterity", "Constitution", "Intelligence", "Wisdom", "Charisma"];
const select = (page: Page, ability: string) => page.getByRole("combobox", { name: `${ability} base score` });
const summary = (page: Page) => page.getByRole("complementary", { name: "Character summary" });
const stepButton = (page: Page, name: RegExp) => page.getByRole("navigation", { name: "Steps" }).getByRole("button", { name });

/** A High Elf, then the Abilities step with a method chosen. */
async function open(page: Page, method: "Standard array" | "Point buy" | "Roll") {
  await page.goto("/");
  await page.getByRole("group", { name: "Choose a race" }).getByText("Elf", { exact: true }).click();
  await page.getByRole("group", { name: "Choose a subrace of Elf" }).getByText("High Elf", { exact: true }).click();
  // The step list on wide screens; on phones it's hidden, so go on with the Next button as a person would.
  if (await stepButton(page, /^Abilities/).isVisible()) await stepButton(page, /^Abilities/).click();
  else await page.locator(".mobile-bar").getByRole("button", { name: "Next: Abilities" }).click();
  await page.getByRole("group", { name: "How will you set your scores?" }).getByText(method, { exact: true }).click();
}

test("standard array: values swap, bonuses show, and the step finishes", async ({ page }) => {
  await open(page, "Standard array");
  await expect(page.getByRole("row", { name: /Dexterity/ })).toContainText("+2 Elf");
  await expect(page.getByRole("row", { name: /Intelligence/ })).toContainText("+1 High Elf");

  await select(page, "Strength").selectOption("15");
  await select(page, "Dexterity").selectOption("14");
  await select(page, "Dexterity").selectOption("15"); // taken by Strength: the two swap
  await expect(select(page, "Strength")).toHaveValue("14");
  await expect(select(page, "Dexterity")).toHaveValue("15");
  await expect(page.getByRole("row", { name: /Dexterity/ })).toContainText("17 (+3)");

  for (const [ability, v] of [["Constitution", "13"], ["Intelligence", "12"], ["Wisdom", "10"], ["Charisma", "8"]]) {
    await select(page, ability).selectOption(v);
  }
  await expect(page.getByText("Left to give:")).toContainText("none");
  await expect(stepButton(page, /^Abilities, done/)).toBeVisible();
  await expect(summary(page).getByRole("button", { name: /^Dex 17/ })).toBeVisible();
  await expectAccessible(page);
});

test("point buy: 27 points, 8 to 15, and buttons that stop when you can't afford more", async ({ page }) => {
  await open(page, "Point buy");
  await expect(page.getByRole("status").filter({ hasText: "Points left" })).toHaveText("Points left: 27 of 27");
  for (const ability of ["Strength", "Dexterity", "Constitution"]) {
    for (let i = 0; i < 7; i++) await page.getByRole("button", { name: `Raise ${ability}` }).click();
  }
  await expect(page.getByRole("status").filter({ hasText: "Points left" })).toHaveText("Points left: 0 of 27");
  await expect(page.getByRole("button", { name: "Raise Strength" })).toBeDisabled(); // at 15
  await expect(page.getByRole("button", { name: "Raise Wisdom" })).toBeDisabled(); // no points left
  await page.getByRole("button", { name: "Lower Strength" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Points left" })).toHaveText("Points left: 2 of 27");
  await expect(stepButton(page, /^Abilities, done/)).toBeVisible();
  await expectAccessible(page);
});

test("rolling: six totals from 3 to 18, every set kept, the latest assigned", async ({ page }) => {
  await open(page, "Roll");
  await page.getByRole("button", { name: "Roll", exact: true }).click();
  const totals = await page.locator(".detail .roll-set li .final").allTextContents();
  expect(totals).toHaveLength(6);
  for (const t of totals) expect(Number(t)).toBeGreaterThanOrEqual(3), expect(Number(t)).toBeLessThanOrEqual(18);

  // Give out the totals: each ability takes the first value still free.
  for (const ability of ABILITIES) {
    const options = await select(page, ability).locator("option").allTextContents();
    const free = options.find((o) => /^\d+$/.test(o))!;
    await select(page, ability).selectOption(free);
  }
  await expect(stepButton(page, /^Abilities, done/)).toBeVisible();

  await page.getByRole("button", { name: "Roll again" }).click();
  await expect(page.getByText("Set 2 of 2")).toBeVisible();
  await page.getByText("See all rolls (2 sets)").click();
  await expect(page.getByText(/^Set 1 ·/)).toBeVisible();
  await expectAccessible(page);
});

test("switching methods keeps each method's work", async ({ page }) => {
  await open(page, "Standard array");
  await select(page, "Strength").selectOption("15");
  await page.getByRole("group", { name: "How will you set your scores?" }).getByText("Point buy", { exact: true }).click();
  await page.getByRole("button", { name: "Raise Wisdom" }).click();
  await page.getByRole("group", { name: "How will you set your scores?" }).getByText("Standard array", { exact: true }).click();
  await expect(select(page, "Strength")).toHaveValue("15");
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 } });
  test("the rows stack and nothing scrolls sideways", async ({ page }) => {
    await open(page, "Point buy");
    const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(scroll).toBeLessThanOrEqual(client);
    await expectAccessible(page);
  });
});
