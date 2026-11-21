// Levels and multiclassing in a real browser, with the SRD pack: a Fighter 4 / Wizard 1 (the level, the other classes,
// a prerequisite a DM may allow, the archetype at Fighter 3, an Ability Score Improvement, hit points); levelling up
// from Review and from the list; and WCAG checks on a wide screen and a phone. Each test starts with empty storage.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

const summary = (page: Page) => page.getByRole("complementary", { name: "Character summary" });
const stepButton = (page: Page, name: RegExp) => page.getByRole("navigation", { name: "Steps" }).getByRole("button", { name });
const group = (page: Page, name: string | RegExp) => page.getByRole("group", { name });
const multiclass = (page: Page) => page.getByRole("region", { name: "Other classes (multiclassing)" });

/** A Fighter at level 5 with one level of Wizard. On phones the step list is hidden, so go on with Next as a person would. */
async function fighterWizard(page: Page) {
  await page.goto("/");
  await expect(group(page, "Choose a race")).toBeVisible();
  if (await stepButton(page, /^Class/).isVisible()) {
    await stepButton(page, /^Class/).click();
  } else {
    for (const next of ["Next: Abilities", "Next: Class"]) await page.locator(".mobile-bar").getByRole("button", { name: next }).click();
  }
  await group(page, "Choose a class").getByText("Fighter", { exact: true }).click();
  await page.getByRole("spinbutton", { name: "Level" }).fill("5");
  await multiclass(page).getByRole("button", { name: /one more for Wizard/ }).click();
}

test("a Fighter 4 / Wizard 1: other classes share the levels; prerequisites, the archetype and an improvement", async ({ page }) => {
  await fighterWizard(page);
  await expect(multiclass(page).getByText("1 of 4 given · 3 left")).toBeVisible();
  // No race or scores yet, so every score is 10: short of the Wizard's Int 13 and the Fighter's own Str or Dex 13.
  // Problems a DM can allow, shown on the choice.
  await expect(multiclass(page).getByText("Leaving Fighter for another class needs Str 13 or Dex 13; you have Strength 10, Dexterity 10.")).toBeVisible();
  await expect(multiclass(page).getByText("Multiclassing into Wizard needs Int 13; you have Intelligence 10.")).toBeVisible();
  await expect(summary(page).getByRole("button", { name: /Hit points/ })).toContainText("32"); // 10 + 3 × 6 + 4
  await expect(summary(page).getByRole("button", { name: /Hit dice/ })).toContainText("4d10 + 1d6");

  await expect(group(page, "Choose your Martial Archetype").getByText("From Fighter 3")).toBeVisible();
  await group(page, "Choose your Martial Archetype").getByText("Champion", { exact: true }).click();
  const improvement = page.getByRole("region", { name: "Ability Score Improvement" });
  await expect(improvement.getByText("From Fighter 4")).toBeVisible();
  await improvement.getByRole("button", { name: "Raise Strength" }).click();
  await improvement.getByRole("button", { name: "Raise Strength" }).click();
  await expect(improvement.getByRole("status")).toContainText("Points left: 0 of 2");
  await expect(summary(page).getByRole("button", { name: /^Str 12/ })).toBeVisible();
  const gains = page.getByRole("region", { name: "What you get" });
  await expect(gains.getByRole("listitem").filter({ hasText: "Improved Critical" })).toContainText("Champion (Fighter 3)");
  await expect(gains.getByRole("listitem").filter({ hasText: "Arcane Recovery" })).toContainText("Wizard 1");
  await expectAccessible(page);

  // Review: the answers, then the next level, given to the Fighter.
  await stepButton(page, /^Review/).click();
  await expect(page.getByText(/^Other classes.*: Wizard 1$/)).toBeVisible();
  await expect(page.getByText(/^Ability Score Improvement: Str \+2$/)).toBeVisible();
  await page.getByRole("button", { name: "Level up to 6" }).click();
  await expect(page.getByRole("heading", { name: "Class", level: 1 })).toBeFocused();
  await expect(page.getByRole("spinbutton", { name: "Level" })).toHaveValue("6");
  await expect(summary(page).getByRole("button", { name: /Hit dice/ })).toContainText("5d10 + 1d6");
});

test("Level up from the list saves the next level and opens the Class step", async ({ page }) => {
  await fighterWizard(page);
  await expect(page.locator("header").getByText(/^Saved /)).toBeVisible();
  await page.getByRole("button", { name: "Characters" }).click();
  const row = page.getByRole("list", { name: "Saved characters" }).getByRole("listitem");
  await expect(row).toContainText("Fighter 4 / Wizard 1");
  await expectAccessible(page);

  await row.getByRole("button", { name: /^Level up/ }).click();
  await expect(page.getByRole("heading", { name: "Class", level: 1 })).toBeVisible();
  await expect(page.getByRole("spinbutton", { name: "Level" })).toHaveValue("6");
  await page.getByRole("button", { name: "Characters" }).click();
  await expect(row).toContainText("Fighter 5 / Wizard 1");
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 } });
  test("the level, the other classes and an improvement fit, and nothing scrolls sideways", async ({ page }) => {
    await fighterWizard(page);
    await expect(page.getByRole("region", { name: "Ability Score Improvement" })).toBeVisible();
    const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(scroll).toBeLessThanOrEqual(client);
    await expectAccessible(page);
  });
});
