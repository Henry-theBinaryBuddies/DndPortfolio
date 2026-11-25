// The inventory editor and the session journal in a real browser, with the SRD pack: changing what's carried, adding
// an item, your own item, a money change, a journal entry (and how it prints), and WCAG checks on a wide screen and a
// phone. Each test starts with empty storage.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

const summary = (page: Page) => page.getByRole("complementary", { name: "Character summary" });
const stepButton = (page: Page, name: RegExp) => page.getByRole("navigation", { name: "Steps" }).getByRole("button", { name });
const group = (page: Page, name: string | RegExp) => page.getByRole("group", { name });
const region = (page: Page, name: string) => page.getByRole("region", { name, exact: true });

/** A Fighter with 100 gp who bought five torches. */
async function fighterWithTorches(page: Page) {
  await page.goto("/");
  await stepButton(page, /^Class/).click();
  await group(page, "Choose a class").getByText("Fighter", { exact: true }).click();
  await stepButton(page, /^Equipment/).click();
  await group(page, "How will you equip?").getByText("Starting gold").click();
  await page.getByRole("spinbutton", { name: "Starting gold (gp)" }).fill("100");
  await page.getByRole("searchbox", { name: "Search 230 items" }).fill("torch");
  for (let i = 0; i < 5; i++) await page.getByRole("button", { name: "+ buy one Torch" }).first().click();
}

test("the inventory: change what's carried, add an item, your own item, and money", async ({ page }) => {
  await fighterWithTorches(page);
  const carry = region(page, "Change what you carry");
  await carry.getByRole("button", { name: "− one fewer Torch" }).click();
  await carry.getByRole("button", { name: "− one fewer Torch" }).click();
  await expect(carry.getByRole("listitem").filter({ hasText: "Torch" })).toContainText("was 5");
  await expect(region(page, "Inventory")).toContainText("Torch × 3 · Bought");

  const add = region(page, "Add items");
  await add.getByRole("searchbox").fill("rope");
  await add.getByRole("button", { name: "+ add one Rope, silk (50 feet)" }).click();
  await expect(region(page, "Inventory")).toContainText("Rope, silk (50 feet) · Added");

  const own = region(page, "Your own items");
  await own.getByRole("button", { name: "Add item" }).click();
  await expect(own.getByRole("textbox", { name: "Name" })).toBeFocused();
  await own.getByRole("textbox", { name: "Name" }).fill("Dragon's tooth");
  await own.getByRole("spinbutton", { name: "How many" }).fill("2");
  await expect(region(page, "Inventory")).toContainText("Dragon's tooth × 2 · Your own");

  const money = region(page, "Money");
  await money.getByRole("button", { name: "Add change" }).click();
  await money.getByRole("spinbutton", { name: "Amount" }).fill("50");
  await money.getByRole("textbox", { name: "What for" }).fill("Crypt loot");
  await summary(page).getByRole("button", { name: /^Money/ }).click();
  await expect(summary(page)).toContainText("Crypt loot 50 gp");
  await expectAccessible(page);

  await own.getByRole("button", { name: "Remove item 1" }).click();
  await expect(region(page, "Inventory")).not.toContainText("Dragon's tooth");
});

test("the session journal: dated entries, newest first, printed only with full text", async ({ page }) => {
  await page.goto("/");
  await stepButton(page, /^Details/).click();
  const journal = region(page, "Session journal");
  await journal.getByRole("button", { name: "Add entry" }).click();
  await expect(journal.getByRole("textbox", { name: "Date" })).toHaveValue(/^\d{4}-\d{2}-\d{2}$/);
  await journal.getByRole("textbox", { name: "Title" }).fill("Session 1");
  await journal.getByRole("textbox", { name: "What happened" }).fill("We met in a tavern.");
  await journal.getByRole("button", { name: "Add entry" }).click();
  await journal.getByRole("textbox", { name: "Title" }).first().fill("Session 2");
  await expect(journal.getByRole("textbox", { name: "Title" }).nth(0)).toHaveValue("Session 2"); // newest first
  await expect(journal.getByRole("textbox", { name: "Title" }).nth(1)).toHaveValue("Session 1");
  await expectAccessible(page);

  await stepButton(page, /^Sheet/).click();
  const onSheet = page.locator(".sheet").getByRole("region", { name: "Session journal" });
  await expect(onSheet).toContainText("Session 2");
  await expect(onSheet).toContainText("We met in a tavern.");
  await page.emulateMedia({ media: "print" });
  await expect(onSheet).toBeHidden();
  await page.emulateMedia({ media: "screen" });
  await page.getByRole("checkbox", { name: "Print full text" }).check();
  await page.emulateMedia({ media: "print" });
  await expect(onSheet).toBeVisible();
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 375, height: 812 } });
  test("the inventory editor fits, and nothing scrolls sideways", async ({ page }) => {
    await page.goto("/");
    for (const n of ["Abilities", "Class"]) await page.locator(".mobile-bar").getByRole("button", { name: `Next: ${n}` }).click();
    await group(page, "Choose a class").getByText("Fighter", { exact: true }).click();
    for (const n of ["Background", "Equipment"]) await page.locator(".mobile-bar").getByRole("button", { name: `Next: ${n}` }).click();
    await region(page, "Your own items").getByRole("button", { name: "Add item" }).click();
    await region(page, "Money").getByRole("button", { name: "Add change" }).click();
    const [scroll, client] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(scroll).toBeLessThanOrEqual(client);
    await expectAccessible(page);
  });
});
