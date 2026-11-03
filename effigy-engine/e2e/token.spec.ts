import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

// The token picture, end to end in a real browser: what is saved (its size, the transparent corners, whether the
// horns stay inside the rim), and that saving it leaves the view as it was (size, fog, background, turn, paint or
// clay, the print preview). See src/token.ts and saveToken in src/main.ts.

const RIM = 0.065; // as in src/token.ts

// Opens the app and waits until the bust is built and painted
async function open(page: Page) {
  await page.goto("/");
  await page.waitForFunction(() => {
    const effigy = (window as unknown as { effigy?: { scene: { getObjectByName: (n: string) => unknown } } }).effigy;
    return !!effigy?.scene.getObjectByName("head");
  }, undefined, { timeout: 120000 });
  // (still, so the view is the same before and after: the turntable off, at three-quarter)
  await page.click('[data-yaw="0.785"]');
  // (and settled: the carved build replaces the quick draft a moment after the bust first shows, which on a busy
  // machine can land between a test's look at the view and the token)
  await page.waitForTimeout(2500);
}

// A tiefling with wide (or tall) horns painted bone, which shows against the dark backdrop if it runs into the rim
async function horned(page: Page, horn: string) {
  await page.evaluate(async (hornStyle) => {
    const selectOf = (value: string) => [...document.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === value))!;
    const race = selectOf("half-orc");
    race.value = "tiefling";
    race.dispatchEvent(new Event("change", { bubbles: true }));
    [...document.querySelectorAll("button")].find((b) => b.textContent === "Race defaults")!.click();
    const horns = selectOf("antelope");
    horns.value = hornStyle;
    horns.dispatchEvent(new Event("change", { bubbles: true }));
    const size = [...document.querySelectorAll("label.row")].find((l) => l.querySelector("span")?.textContent === "Horn size")!.querySelector("input")!;
    size.value = "1";
    size.dispatchEvent(new Event("input", { bubbles: true }));
    (document.querySelector('[aria-label="Horns: Bone"]') as HTMLButtonElement).click();
  }, horn);
  // (the carved build lands a moment after the draft)
  await page.waitForTimeout(3000);
}

interface Picture {
  width: number;
  height: number;
  corner: number; // alpha at the top left corner
  centre: number; // alpha in the middle
  // light pixels in the sliver just inside the rim, in its upper half (where only horns and hair reach): a horn the rim
  // cuts shows there (the whole-head framing keeps everything within 97% of the way to the rim, see tokenLens)
  rimBright: number;
  centreColour: [number, number, number];
  backdropColour: [number, number, number]; // up and to the left, inside the rim, where the backdrop shows past the head
}

// Saves a token through the button and reads the file back in the page
async function saveToken(page: Page, size: number, framing: "whole" | "close", backdrop = ""): Promise<{ name: string; picture: Picture }> {
  await page.selectOption("#token-size", String(size));
  await page.selectOption("#token-framing", framing);
  await page.selectOption("#token-backdrop", backdrop);
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 120000 }), page.click("#export-token")]);
  const file = readFileSync((await download.path())!);
  const picture = await page.evaluate(
    async ({ data, rim }) => {
      const image = new Image();
      image.src = `data:image/png;base64,${data}`;
      await image.decode();
      const canvas = document.createElement("canvas");
      [canvas.width, canvas.height] = [image.width, image.height];
      const g = canvas.getContext("2d")!;
      g.drawImage(image, 0, 0);
      const { data: px } = g.getImageData(0, 0, image.width, image.height);
      const at = (x: number, y: number) => (y * image.width + x) * 4;
      const size = image.width;
      const c = size / 2;
      const inner = c - Math.max(1, size * 0.004) - size * rim;
      let rimBright = 0;
      for (let y = 0; y < c; y++)
        for (let x = 0; x < size; x++) {
          const r = Math.hypot(x + 0.5 - c, y + 0.5 - c);
          if (r < inner * 0.975 || r > inner) continue;
          const i = at(x, y);
          // (the rim shades this sliver, and the backdrop under it is near black: a bone horn there is still far lighter)
          if ((0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) / 255 > 0.12) rimBright++;
        }
      const m = at(Math.floor(c), Math.floor(c * 1.05));
      const k = at(Math.floor(c - 0.55 * inner), Math.floor(c - 0.55 * inner));
      return { width: image.width, height: image.height, corner: px[3], centre: px[at(Math.floor(c), Math.floor(c)) + 3], rimBright, centreColour: [px[m], px[m + 1], px[m + 2]] as [number, number, number], backdropColour: [px[k], px[k + 1], px[k + 2]] as [number, number, number] };
    },
    { data: file.toString("base64"), rim: RIM },
  );
  return { name: download.suggestedFilename(), picture };
}

// What saving a token must leave as it found it
const viewState = (page: Page) =>
  page.evaluate(() => {
    const effigy = (window as unknown as { effigy: { scene: any; renderer: any } }).effigy;
    const { scene, renderer } = effigy;
    const canvas = renderer.domElement as HTMLCanvasElement;
    const pivot = scene.children.find((c: any) => c.isGroup);
    let headColour = -1;
    scene.traverse((o: any) => {
      if (o.isMesh && o.name === "head") headColour = o.material.color.getHex();
    });
    const print = scene.getObjectByName("print preview");
    return {
      size: [canvas.width, canvas.height],
      ratio: renderer.getPixelRatio(),
      fog: scene.fog ? [scene.fog.near, scene.fog.far] : null,
      background: scene.background?.isColor ? scene.background.getHex() : String(scene.background),
      yaw: Math.round(pivot.rotation.y * 1000),
      headColour,
      print: print ? print.visible : null,
    };
  });

test.describe("the token", () => {
  test("is saved at each size, square, transparent outside its rim", async ({ page }) => {
    await open(page);
    for (const size of [256, 512, 1024]) {
      const { name, picture } = await saveToken(page, size, "whole");
      expect(name).toBe(`effigy-human-masculine-token-${size}.png`);
      expect([picture.width, picture.height]).toEqual([size, size]);
      expect(picture.corner).toBe(0);
      expect(picture.centre).toBe(255);
    }
  });

  test("fits wide and tall horns inside the rim when framing the whole head, and says the close portrait may crop them", async ({ page }) => {
    await open(page);
    for (const horn of ["bull", "ram", "antelope"]) {
      await horned(page, horn);
      const whole = await saveToken(page, 512, "whole");
      expect(whole.picture.rimBright, `${horn}: whole head`).toBe(0);
    }
    // (wide bull horns run into the rim on the close portrait, as its label says they may)
    await horned(page, "bull");
    const close = await saveToken(page, 512, "close");
    expect(close.picture.rimBright).toBeGreaterThan(0);
    await expect(page.locator("#token-framing option[value=close]")).toHaveText(/may crop horns/);
  });

  test("stands the bust on the backdrop chosen, from the pictures listed in public/backdrops", async ({ page }) => {
    await open(page);
    const listed = await page.locator("#token-backdrop option").allTextContents();
    expect(listed[0]).toBe("Plain dark glow");
    expect(listed).toContain("Dungeon stone");
    const plain = await saveToken(page, 256, "whole", "");
    const icy = await saveToken(page, 256, "whole", "icy-cavern.png");
    // (the icy cavern is cold blue where the plain glow is a warm near-black)
    const [r, g, b] = icy.picture.backdropColour;
    expect(b).toBeGreaterThan(r + 10);
    expect(Math.hypot(...icy.picture.backdropColour.map((v, i) => v - plain.picture.backdropColour[i]))).toBeGreaterThan(20);
    expect(icy.picture.corner).toBe(0);
  });

  test("shows a preview of the token, redrawn as the backdrop, the framing and the character change", async ({ page }) => {
    await open(page);
    // The preview's pixels, as a short fingerprint (a sample of them), once it is drawn for what is chosen
    const preview = async (backdrop: string, framing: string) => {
      await page.waitForFunction(([b, f]) => {
        const p = document.querySelector("#token-preview") as HTMLCanvasElement;
        return p.dataset.backdrop === b && p.dataset.framing === f;
      }, [backdrop, framing], { timeout: 60000 });
      return page.evaluate(() => {
        const p = document.querySelector("#token-preview") as HTMLCanvasElement;
        const { data } = p.getContext("2d")!.getImageData(0, 0, p.width, p.height);
        const sample: number[] = [];
        for (let i = 0; i < data.length; i += 4 * 97) sample.push(data[i], data[i + 1], data[i + 2], data[i + 3]);
        return sample;
      });
    };
    // (how far apart two are, per channel on average: the same picture drawn again is near 0; a dark backdrop for the
    // plain glow, with the bust and the rim unchanged, about 2)
    const differ = (a: number[], b: number[]) => a.reduce((sum, v, i) => sum + Math.abs(v - b[i]), 0) / a.length;
    const plain = await preview("", "whole");
    // (drawn: a picture in the round, and its corners clear)
    expect(Math.max(...plain)).toBeGreaterThan(40);
    expect(plain[3]).toBe(0);
    // stepping on to the next backdrop and back
    await page.click("#token-backdrop-next");
    const first = await page.inputValue("#token-backdrop");
    expect(first).not.toBe("");
    const stepped = await preview(first, "whole");
    expect(differ(stepped, plain)).toBeGreaterThan(1.2);
    await page.click("#token-backdrop-previous");
    expect(differ(await preview("", "whole"), plain)).toBeLessThan(0.5);
    // the framing (redrawn for it: for a head without horns both framings are the same picture, as the close one
    // already holds the whole head; the horns test above shows them apart)
    await page.selectOption("#token-framing", "close");
    await preview("", "close");
    await page.selectOption("#token-framing", "whole");
    await preview("", "whole");
    // the character: a tiefling, red with horns, once its build has settled
    const before = await preview("", "whole");
    await page.evaluate(() => {
      const race = [...document.querySelectorAll("select")].find((s) => [...s.options].some((o) => o.value === "half-orc"))!;
      race.value = "tiefling";
      race.dispatchEvent(new Event("change", { bubbles: true }));
      (document.querySelector("#token-preview") as HTMLCanvasElement).dataset.backdrop = "stale";
    });
    expect(differ(await preview("", "whole"), before)).toBeGreaterThan(1.2);
  });

  test("leaves the view as it was: its size, fog, background and turn", async ({ page }) => {
    await open(page);
    const before = await viewState(page);
    await saveToken(page, 1024, "whole");
    expect(await viewState(page)).toEqual(before);
  });

  test("is painted even from the clay view, and the view stays clay", async ({ page }) => {
    await open(page);
    await page.click("#clay");
    await page.waitForTimeout(500);
    const before = await viewState(page);
    expect(before.headColour).toBe(0x9c9a96);
    const { picture } = await saveToken(page, 256, "whole");
    // (the painted skin is warm, not the grey of the clay)
    const [r, g, b] = picture.centreColour;
    expect(r).toBeGreaterThan(b + 15);
    expect(await viewState(page)).toEqual(before);
  });

  test("can be saved while the print preview is shown, which stays shown", async ({ page }) => {
    await open(page);
    await page.click("#export-preview");
    await expect(page.locator("#export-preview")).toHaveText("Back to sculpt", { timeout: 120000 });
    const before = await viewState(page);
    expect(before.print).toBe(true);
    const { picture } = await saveToken(page, 256, "whole");
    expect(picture.centre).toBe(255);
    expect(await viewState(page)).toEqual(before);
  });
});
