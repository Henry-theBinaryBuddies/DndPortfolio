// The builder in a real browser: choosing a race, the summary and its breakdowns, keyboard use, Review, the phone
// layout, and automated WCAG 2.2 AA checks (axe) on every page.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  const found = results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.length}) ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
  expect(found).toEqual([]);
}

const race = (page: Page) => page.getByRole("group", { name: "Choose a race" });
const summary = (page: Page) => page.getByRole("complementary", { name: "Character summary" });
const tile = (page: Page, short: string) => summary(page).getByRole("button", { name: new RegExp(`^${short} `) });

async function pickHighElf(page: Page) {
  await page.goto("/");
  await race(page).getByText("Elf", { exact: true }).click();
  await page.getByRole("group", { name: "Choose a subrace of Elf" }).getByText("High Elf", { exact: true }).click();
}

test("choosing a High Elf updates the steps, the summary and its breakdowns", async ({ page }) => {
  await pickHighElf(page);
  await expect(tile(page, "Dex")).toHaveAccessibleName("Dex 12 (Dexterity): show how it's worked out");
  await expect(tile(page, "Int")).toHaveAccessibleName("Int 11 (Intelligence): show how it's worked out");

  await tile(page, "Dex").click();
  await expect(summary(page).getByText("Dexterity 12 =")).toBeVisible();
  await expect(summary(page).locator(".breakdown")).toContainText("Base 10 + Elf 2");

  // Common and Elvish are already known; picking Draconic finishes the Race step.
  const language = page.getByRole("group", { name: "Choose one extra language" });
  await expect(language.getByRole("radio", { name: /Elvish/ })).toBeDisabled();
  await expect(language.getByText("Already known (Elf)").first()).toBeVisible();
  await language.getByText("Draconic", { exact: true }).click();
  await expect(summary(page)).toContainText("Common, Elvish, Draconic");
  await expect(page.getByRole("navigation", { name: "Steps" }).getByRole("button", { name: "Race, done" })).toBeVisible();
  await expectAccessible(page);
});

test("the race cards work from the keyboard alone", async ({ page }) => {
  await page.goto("/");
  await expect(race(page)).toBeVisible(); // the packs have loaded
  await page.keyboard.press("Tab"); // the first stop is the skip link
  await expect(page.getByRole("link", { name: "Skip to the step" })).toBeFocused();
  const dwarf = race(page).getByRole("radio", { name: /Dwarf/ });
  await dwarf.focus();
  await page.keyboard.press("Space");
  await expect(dwarf).toBeChecked();
  await page.keyboard.press("ArrowRight");
  await expect(race(page).getByRole("radio", { name: /^Elf/ })).toBeChecked();
  await expect(page.getByRole("group", { name: "Choose a subrace of Elf" })).toBeVisible();
});

test("Needs attention jumps to the unfinished choice", async ({ page }) => {
  await page.goto("/");
  await race(page).getByText("Elf", { exact: true }).click();
  await summary(page).getByRole("button", { name: "Choose a subrace of Elf" }).click();
  await expect(page.getByRole("group", { name: "Choose a subrace of Elf" })).toBeFocused();
});

test("Review lists choices left behind and clears them", async ({ page }) => {
  await pickHighElf(page);
  await page.getByRole("group", { name: "Choose one extra language" }).getByText("Draconic", { exact: true }).click();
  await race(page).getByText("Dwarf", { exact: true }).click();
  await page.getByRole("navigation", { name: "Steps" }).getByRole("button", { name: "Review" }).click();

  await expect(page.getByRole("heading", { name: "Review", level: 1 })).toBeFocused();
  const left = page.getByRole("region", { name: "Choices left behind" });
  await expect(left.getByRole("listitem")).toHaveCount(2);
  await expectAccessible(page);
  await left.getByRole("button", { name: "Clear these" }).click();
  await expect(page.getByRole("region", { name: "Choices left behind" })).toHaveCount(0);
});

test("the Licences page shows each pack's credit", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("contentinfo").getByRole("button", { name: "Licences" }).click();
  await expect(page.getByRole("heading", { name: "System Reference Document 5.1" })).toBeVisible();
  await expect(page.locator("blockquote")).toContainText("Creative Commons Attribution 4.0");
  await expectAccessible(page);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("one column, no sideways scrolling, a folding summary and a Back/Next bar", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("navigation", { name: "Steps" })).toBeHidden();
    const widths = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(widths[0]).toBeLessThanOrEqual(widths[1]);

    await expect(tile(page, "Dex")).toBeHidden();
    await page.getByRole("button", { name: "Show summary" }).click();
    await expect(tile(page, "Dex")).toBeVisible();
    await expect(page.locator(".mobile-bar").getByRole("button", { name: "Next: Abilities" })).toBeVisible();
    await expectAccessible(page);
  });
});
