// The Spells step in a real browser, with SRD casters: a High Elf wizard (the race's cantrip, class cantrips, the
// spellbook found by search and filter, prepared spells), a Life cleric's always-prepared spells, a fighter's note,
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
const pick = (page: Page, list: string | RegExp, spell: string) => group(page, list).getByRole("checkbox", { name: new RegExp(`^${spell} `) }).check();

/** Optionally a race (and subrace), then a class (and subclass), then the Spells step, on a wide screen. */
async function caster(page: Page, opts: { race?: string; subrace?: string; cls: string; subclass?: [string, string] }) {
  await page.goto("/");
  await expect(group(page, "Choose a race")).toBeVisible();
  if (opts.race) await group(page, "Choose a race").getByText(opts.race, { exact: true }).click();
  if (opts.subrace) await group(page, /subrace/i).getByText(opts.subrace, { exact: true }).click();
  await stepButton(page, /^Class/).click();
  await group(page, "Choose a class").getByText(opts.cls, { exact: true }).click();
  if (opts.subclass) await group(page, opts.subclass[0]).getByText(opts.subclass[1], { exact: true }).click();
  await stepButton(page, /^Spells/).click();
  await expect(page.getByRole("heading", { name: "Spells", level: 1 })).toBeVisible();
}

test("a High Elf wizard: the race's cantrip, three class cantrips, a spellbook of six found by search and filter", async ({ page }) => {
  await caster(page, { race: "Elf", subrace: "High Elf", cls: "Wizard" });
  await group(page, "Choose a wizard cantrip").getByRole("radio", { name: /^Fire Bolt / }).check();
  await expect(group(page, "Wizard cantrips (3)").getByRole("checkbox", { name: /^Fire Bolt / })).toBeDisabled();
  await expect(group(page, "Wizard cantrips (3)").getByText("Already known (High Elf)")).toBeVisible();
  for (const c of ["Light", "Mage Hand", "Prestidigitation"]) await pick(page, "Wizard cantrips (3)", c);

  const book = "Spellbook: 1st-level wizard spells (6)";
  await group(page, book).getByRole("combobox", { name: `Show only: ${book}` }).selectOption("Ritual");
  await expect(group(page, book).getByRole("listitem").filter({ hasText: "Read more" })).toHaveCount(8); // the SRD's 1st-level wizard rituals
  await pick(page, book, "Detect Magic");
  await pick(page, book, "Comprehend Languages");
  await group(page, book).getByRole("combobox", { name: `Show only: ${book}` }).selectOption("");
  await group(page, book).getByRole("searchbox", { name: `Search: ${book}` }).fill("missile");
  await pick(page, book, "Magic Missile");
  await group(page, book).getByRole("searchbox", { name: `Search: ${book}` }).fill("");
  for (const s of ["Burning Hands", "Mage Armor", "Sleep"]) await pick(page, book, s);
  await expect(stepButton(page, /^Spells, done/)).toBeVisible();

  await pick(page, "Prepared today (optional)", "Magic Missile");
  await expect(page.getByRole("region", { name: "Your spells" })).toContainText("Magic Missile · 1st level · cast with Intelligence · prepared · Wizard");
  await expect(summary(page).getByRole("region", { name: "Spellcasting" })).toContainText("Spell slots");
  await summary(page).getByRole("button", { name: /^Spell save DC/ }).click();
  await expect(summary(page)).toContainText("Spell save DC 10 = Base 8 + Proficiency bonus 2 + Intelligence 0");
  await expectAccessible(page);
});

test("a Life Domain cleric always has Bless and Cure Wounds prepared; a fighter's Spells step says why it's empty", async ({ page }) => {
  await caster(page, { cls: "Cleric", subclass: ["Choose your Divine Domain", "Life"] });
  const yours = page.getByRole("region", { name: "Your spells" });
  await expect(yours).toContainText("Bless · 1st level · cast with Wisdom · always prepared · Life");
  await expect(group(page, "Prepared today (optional)").getByRole("checkbox", { name: /^Bless / })).toHaveCount(0);

  await caster(page, { cls: "Fighter" });
  await expect(page.getByText("The Fighter doesn't cast spells at level 1.")).toBeVisible();
  await expect(stepButton(page, /^Spells, done/)).toBeVisible();
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 } });
  test("the spell list fits, with its search and filter, and nothing scrolls sideways", async ({ page }) => {
    await page.goto("/");
    await expect(group(page, "Choose a race")).toBeVisible();
    const next = (name: string) => page.locator(".mobile-bar").getByRole("button", { name });
    for (const n of ["Next: Abilities", "Next: Class"]) await next(n).click();
    await group(page, "Choose a class").getByText("Wizard", { exact: true }).click();
    for (const n of ["Next: Background", "Next: Equipment", "Next: Spells"]) await next(n).click();
    await page.getByText("Read more", { exact: false }).first().click();
    const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(scroll).toBeLessThanOrEqual(client);
    await expectAccessible(page);
  });
});
