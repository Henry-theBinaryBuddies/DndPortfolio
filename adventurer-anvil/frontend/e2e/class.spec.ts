// The Class step in a real browser, with the SRD pack: a Fighter, a Draconic Sorcerer (subclass at level 1), a Rogue's
// expertise, what the class gives, the summary, and WCAG checks on a wide screen and a phone.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

const summary = (page: Page) => page.getByRole("complementary", { name: "Character summary" });
const stepButton = (page: Page, name: RegExp) => page.getByRole("navigation", { name: "Steps" }).getByRole("button", { name });
const group = (page: Page, name: string | RegExp) => page.getByRole("group", { name });

/** The Class step with a class chosen. On phones the step list is hidden, so go on with Next as a person would. */
async function open(page: Page, className: string) {
  await page.goto("/");
  await expect(group(page, "Choose a race")).toBeVisible();
  if (await stepButton(page, /^Class/).isVisible()) {
    await stepButton(page, /^Class/).click();
  } else {
    for (const next of ["Next: Abilities", "Next: Class"]) await page.locator(".mobile-bar").getByRole("button", { name: next }).click();
  }
  await group(page, "Choose a class").getByText(className, { exact: true }).click();
}

test("a Fighter: skills and a fighting style finish the step; hit points and what the class gives show", async ({ page }) => {
  await open(page, "Fighter");
  await expect(page.getByText("Saves: Str, Con")).toBeVisible();
  await expect(summary(page).getByRole("button", { name: /Hit points/ })).toContainText("10");
  await expect(summary(page).getByRole("button", { name: /Hit dice/ })).toContainText("1d10");

  const skills = group(page, /^Choose two skills/);
  await skills.getByText("Athletics", { exact: true }).click();
  await skills.getByText("Perception", { exact: true }).click();
  await expect(skills.getByText("2 of 2 chosen")).toBeVisible();
  await expect(skills.getByRole("checkbox", { name: "Survival" })).toBeDisabled(); // two is all

  await group(page, /^Fighting Style/).getByText("Defense", { exact: true }).click();
  await expect(stepButton(page, /^Class, done/)).toBeVisible();

  const gains = page.getByRole("region", { name: "What you get at level 1" });
  await expect(gains.getByRole("listitem").filter({ hasText: "Second Wind" })).toContainText("1 per short rest");
  await gains.getByText("Read more about Second Wind").click();
  await expect(gains.getByText(/regain hit points equal to 1d10 \+ your fighter level/)).toBeVisible();
  await expectAccessible(page);
});

test("a Draconic Sorcerer: the origin is chosen at level 1, with its dragon, AC and hit points", async ({ page }) => {
  await open(page, "Sorcerer");
  await group(page, "Choose your Sorcerous Origin").getByText("Draconic", { exact: true }).click();
  await group(page, /^Dragon Ancestor/).getByText("Red - Fire Damage", { exact: true }).click();
  await expect(summary(page).getByRole("button", { name: /Armor Class/ })).toContainText("13");
  await expect(summary(page).getByRole("button", { name: /Hit points/ })).toContainText("7"); // d6 + Con 0 + 1
  await expect(summary(page).getByText("Draconic", { exact: true })).toBeVisible();
  await expectAccessible(page);
});

test("a Rogue's expertise offers the proficiencies you have", async ({ page }) => {
  await open(page, "Rogue");
  const expertise = group(page, /^Expertise/);
  await expect(expertise.getByRole("checkbox")).toHaveCount(1); // thieves' tools, before any skills
  const skills = group(page, /^Choose four skills/);
  for (const s of ["Stealth", "Acrobatics", "Deception", "Insight"]) await skills.getByText(s, { exact: true }).click();
  await expect(expertise.getByRole("checkbox")).toHaveCount(5);
  await expertise.getByText("Stealth", { exact: true }).click();
  await expertise.getByText("Thieves Tools", { exact: true }).click();
  await expect(summary(page).getByText(/Stealth \(expertise\)/)).toBeVisible();
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 } });
  test("class cards and choices fit, and nothing scrolls sideways", async ({ page }) => {
    await open(page, "Monk");
    const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(scroll).toBeLessThanOrEqual(client);
    await expectAccessible(page);
  });
});
