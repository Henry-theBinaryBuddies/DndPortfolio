// The built site, served with its real headers (locally by `vite preview`, or the live site with PW_BASE_URL): it sends
// its security headers, and everything the app does works under its Content-Security-Policy with no violations:
// loading the packs, saving, a portrait, downloading a character file and exporting to Tome & Tile.
import { expect, test, type Page } from "@playwright/test";

const live = Boolean(process.env.PW_BASE_URL);
const stepButton = (page: Page, name: RegExp) => page.getByRole("navigation", { name: "Steps" }).getByRole("button", { name });

/** Collects Content-Security-Policy violations and console errors from the moment the page starts. */
async function watch(page: Page) {
  const problems: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") problems.push(`console: ${m.text()}`); });
  page.on("pageerror", (e) => problems.push(`page: ${e.message}`));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) => {
      (window as unknown as { cspViolations: string[] }).cspViolations ??= [];
      (window as unknown as { cspViolations: string[] }).cspViolations.push(`${e.violatedDirective}: ${e.blockedURI}`);
    });
  });
  return async () => [...problems, ...(await page.evaluate(() => (window as unknown as { cspViolations?: string[] }).cspViolations ?? []))];
}

test("the page sends its security headers; the schema can be fetched from anywhere", async ({ page, request }) => {
  const response = await page.goto("/");
  const headers = response!.headers();
  expect(headers["content-security-policy"]).toContain("default-src 'self'");
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  const schema = await request.get("schemas/dnd5e-2014-pack.schema.json");
  expect(schema.ok()).toBe(true);
  expect(schema.headers()["access-control-allow-origin"]).toBe("*");
  const asset = (await page.locator('script[type="module"]').getAttribute("src"))!;
  expect((await request.get(asset)).headers()["cache-control"]).toContain("immutable");
});

test("everything works under the Content-Security-Policy: saving, a portrait, a download and an export", async ({ page }) => {
  const problems = await watch(page);
  await page.goto("/");
  await stepButton(page, /^Class/).click();
  await page.getByRole("group", { name: "Choose a class" }).getByText("Fighter", { exact: true }).click();
  await stepButton(page, /^Details/).click();
  await page.getByRole("textbox", { name: "Name" }).fill("Borin");
  // A one-pixel PNG as the portrait: shrunk on a canvas and kept as a data: URL.
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
  await page.locator('input[type="file"]').first().setInputFiles({ name: "borin.png", mimeType: "image/png", buffer: png });
  await expect(page.locator("header").getByText(/^Saved /)).toBeVisible();
  await expect(page.getByRole("link", { name: "Source code (AGPL-3.0)" })).toHaveAttribute("href", /github\.com\/Henry-theBinaryBuddies\/DndPortfolio/);

  await stepButton(page, /^Review/).click();
  const [file] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download character file" }).click()]);
  expect(file.suggestedFilename()).toBe("borin.anvil.json");
  await page.getByRole("button", { name: "Export for Tome & Tile" }).click();
  const [creature] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download anyway" }).click()]);
  expect(creature.suggestedFilename()).toBe("borin.creature.json");

  await page.getByRole("button", { name: "Characters" }).click();
  await expect(page.getByRole("list", { name: "Saved characters" }).locator("img.avatar")).toBeVisible(); // the portrait's data: thumbnail
  expect(await problems()).toEqual([]);
});

test("a mistyped address gets a real 'not found' page (Cloudflare Pages only)", async ({ page }) => {
  test.skip(!live, "vite preview serves the app for any address; Cloudflare Pages serves 404.html");
  const response = await page.goto("/no-such-page");
  expect(response!.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "Nothing here" })).toBeVisible();
});
