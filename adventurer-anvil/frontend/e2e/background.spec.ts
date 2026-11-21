// The Background step in a real browser, with the SRD Acolyte: its languages and feature, the pointer to Details
// (where personality is written), the duplicate-skill swap, and WCAG checks on a wide screen and a phone.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

const stepButton = (page: Page, name: RegExp) => page.getByRole("navigation", { name: "Steps" }).getByRole("button", { name });
const group = (page: Page, name: string | RegExp) => page.getByRole("group", { name });

async function goToBackground(page: Page) {
  if (await stepButton(page, /^Background/).isVisible()) {
    await stepButton(page, /^Background/).click();
  } else {
    for (const next of ["Next: Abilities", "Next: Class", "Next: Background"]) await page.locator(".mobile-bar").getByRole("button", { name: next }).click();
  }
}

test("an Acolyte: two languages finish the step; the feature shows; personality is pointed to Details", async ({ page }) => {
  await page.goto("/");
  await expect(group(page, "Choose a race")).toBeVisible();
  await goToBackground(page);
  await group(page, "Choose a background").getByText("Acolyte", { exact: true }).click();
  await expect(page.getByText("Insight", { exact: true }).first()).toBeVisible();

  const languages = group(page, /^Choose two languages/);
  await languages.getByText("Dwarvish", { exact: true }).click();
  await languages.getByText("Celestial", { exact: true }).click();
  await expect(stepButton(page, /^Background, done/)).toBeVisible();
  await expect(page.getByRole("region", { name: "What you get" })).toContainText("Shelter of the Faithful");

  await expect(page.getByText("Its personality tables are offered as suggestions on the Details step.")).toBeVisible();
  await expectAccessible(page);
});

test("a Half-Elf who took Insight swaps the Acolyte's Insight for another skill", async ({ page }) => {
  await page.goto("/");
  await group(page, "Choose a race").getByText("Half-Elf", { exact: true }).click();
  const versatility = group(page, /^Skill Versatility/);
  await versatility.getByText("Insight", { exact: true }).click();
  await versatility.getByText("Stealth", { exact: true }).click();
  await goToBackground(page);
  await group(page, "Choose a background").getByText("Acolyte", { exact: true }).click();

  const replace = group(page, /^Acolyte gives Insight, which you already have from Half-Elf/);
  await expect(replace.getByRole("radio", { name: /Stealth/ })).toBeDisabled(); // already proficient
  await replace.getByText("Perception", { exact: true }).click();
  await expect(page.getByRole("complementary", { name: "Character summary" }).getByText("Insight, Stealth, Religion, Perception")).toBeVisible();
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 } });
  test("the step fits, text boxes included, and nothing scrolls sideways", async ({ page }) => {
    await page.goto("/");
    await expect(group(page, "Choose a race")).toBeVisible();
    await goToBackground(page);
    await group(page, "Choose a background").getByText("Acolyte", { exact: true }).click();
    const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(scroll).toBeLessThanOrEqual(client);
    await expectAccessible(page);
  });
});
