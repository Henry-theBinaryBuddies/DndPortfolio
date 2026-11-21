// The optional rules in a real browser, with the SRD pack: the Rules step; a feat in place of an Ability Score
// Improvement (with its prerequisite); rolled hit points; moving a race's increases; and WCAG checks on a wide screen and a phone.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

const summary = (page: Page) => page.getByRole("complementary", { name: "Character summary" });
const stepButton = (page: Page, name: RegExp) => page.getByRole("navigation", { name: "Steps" }).getByRole("button", { name });
const group = (page: Page, name: string | RegExp) => page.getByRole("group", { name });

/** Sets rules on the Rules step: each a switch by its label, to the option named. */
async function setRules(page: Page, rules: Record<string, string>) {
  await stepButton(page, /^Rules/).click();
  for (const [rule, option] of Object.entries(rules)) await group(page, rule).getByText(option, { exact: true }).click();
}

test("a new character opens at Race; the Rules step is done and shows each rule's default", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Race", level: 1 })).toBeVisible();
  await expect(stepButton(page, /^Rules, done/)).toBeVisible();
  await stepButton(page, /^Rules/).click();
  await expect(group(page, "Feats").getByRole("radio", { name: "Off" })).toBeChecked();
  await expect(group(page, "Hit points after 1st level").getByRole("radio", { name: "Average" })).toBeChecked();
  await expectAccessible(page);
});

test("with feats and rolled hit points: a Fighter 4 may take a feat, and rolls each level", async ({ page }) => {
  await page.goto("/");
  await setRules(page, { Feats: "On", "Hit points after 1st level": "Rolled" });
  await stepButton(page, /^Class/).click();
  await group(page, "Choose a class").getByText("Fighter", { exact: true }).click();
  await page.getByRole("spinbutton", { name: "Level" }).fill("4");

  const improvement = group(page, "Ability Score Improvement");
  await expect(improvement.getByText("From Fighter 4")).toBeVisible();
  await improvement.getByText("Take a feat", { exact: true }).click();
  // No scores yet, so every score is 10: Grappler is shown with what it needs, and can't be picked without a DM.
  await expect(group(page, "Choose a feat").getByRole("radio", { name: "Grappler Needs Strength 13 (you have 10)" })).toBeDisabled();

  const rolls = group(page, "Hit points (rolled)");
  await expect(rolls.getByRole("button", { name: /^Roll for Fighter \d/ })).toHaveCount(3);
  await rolls.getByRole("button", { name: "Roll for Fighter 2 (1d10)" }).click();
  await expect(rolls.getByRole("button", { name: "Roll again for Fighter 2 (1d10)" })).toBeVisible();
  await expect(summary(page).getByRole("button", { name: /Hit points/ })).toBeVisible();
  await rolls.getByRole("button", { name: "Roll again for Fighter 2 (1d10)" }).click();
  await expect(rolls.getByText("1d10 · rolled 2 times")).toBeVisible();
  await expect(rolls.getByText("Hit points: Fighter 2 was rolled 2 times; the latest counts.")).toBeVisible();
  await expectAccessible(page);
});

test("a custom origin: a hill dwarf moves its Constitution increase to Dexterity", async ({ page }) => {
  await page.goto("/");
  await setRules(page, { "Ability increases from your race": "Move them" });
  await stepButton(page, /^Race/).click();
  await group(page, "Choose a race").getByText("Dwarf", { exact: true }).click();
  await group(page, /^Choose a subrace/).getByText("Hill Dwarf", { exact: true }).click();
  await group(page, "+2 Constitution (Dwarf) goes to").getByText("Dex", { exact: true }).click();
  await expect(summary(page).getByRole("button", { name: /^Dex 12/ })).toBeVisible();
  await expect(summary(page).getByRole("button", { name: /^Con 10/ })).toBeVisible();
  await expectAccessible(page);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 } });
  test("the Rules step and moved increases fit, and nothing scrolls sideways", async ({ page }) => {
    await page.goto("/");
    await page.locator(".mobile-bar").getByRole("button", { name: "Back" }).click();
    await expect(page.getByRole("heading", { name: "Rules", level: 1 })).toBeVisible();
    await group(page, "Ability increases from your race").getByText("Move them", { exact: true }).click();
    await page.locator(".mobile-bar").getByRole("button", { name: "Next: Race" }).click();
    await group(page, "Choose a race").getByText("Dwarf", { exact: true }).click();
    await expect(group(page, "+2 Constitution (Dwarf) goes to")).toBeVisible();
    const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(scroll).toBeLessThanOrEqual(client);
    await expectAccessible(page);
  });
});
