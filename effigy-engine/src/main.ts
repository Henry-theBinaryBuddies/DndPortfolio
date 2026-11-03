import * as THREE from "three";
import "./style.css";
import { buildBust, disposeObject, pedestalGeometry } from "./builder";
import { MM, PRINT } from "./print";
import { loadAssets, type Assets } from "./assets";
import { defaultParams, type Params } from "./params";
import { exportStl, describe } from "./exportStl";
import { describePrint, disposePreview, preparePrint, previewGroup, printKey, type Prepared } from "./printPreview";
import { mountPanel } from "./ui";
import { defaultPaint, Painter, racePaint } from "./paint";
import { mountPaint, type TokenFraming } from "./paintPanel";
import { backdropPicture, frameToken, loadBackdrops, RIM, tokenBackdrop } from "./token";

const stage = document.getElementById("stage") as HTMLElement;
const canvas = document.getElementById("view") as HTMLCanvasElement;
const panel = document.getElementById("panel") as HTMLElement;

// Three.js needs three things to draw: a scene (the world), a camera (the eye)
// and a renderer (which paints the camera's view onto the canvas).
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.localClippingEnabled = true; // (the bust is cut flat underneath: see FLAT_CUT in builder.ts)

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14110f);
const fog = new THREE.Fog(0x14110f, 5, 10); // (see placeCamera)
scene.fog = fog;

const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
// Scrolling zooms. Close in, the camera aims at the face instead of the whole bust. "Face" framing fits
// everything from the chin to the highest point of the head (the skull, horns or a mohawk), so it is
// worked out from each new bust.
const faceButton = document.querySelector<HTMLButtonElement>('#framing [data-distance="face"]')!;
const BUST_DISTANCE = 7.4;
let chinY = 1.4; // just under the chin (or the beard), as a height above the plinth: set from each bust
let faceTop = 2.7;
let distance = BUST_DISTANCE;
function faceDistance() {
  // (with room to spare: the face sits in front of the turntable's centre, so it looks bigger than it is)
  const halfHeight = ((faceTop - chinY) / 2) * 1.5;
  return Math.min(BUST_DISTANCE - 1, Math.max(2.6, halfHeight / Math.tan(THREE.MathUtils.degToRad(16))));
}
// The print preview stands on a taller base than the sculpt (and at tabletop size over the one inch square), so
// while it is shown the full-bust framing is fitted to it instead: `printFrame` is the middle of its height, and
// the half height and the farthest it reaches from the turntable's axis, in scene units. Framing the face is the same.
let printFrame: { y: number; halfHeight: number; radius: number } | null = null;
const FOG = { near: fog.near, far: fog.far };
function placeCamera() {
  const face = faceDistance();
  const t = Math.min(1, Math.max(0, (BUST_DISTANCE - distance) / (BUST_DISTANCE - face))); // 0 = full bust, 1 = the face
  const bustY = printFrame?.y ?? 1.2;
  const targetY = bustY + ((faceTop + chinY) / 2 - bustY) * t;
  // (how much farther back the whole print needs the camera than the sculpt does: it turns, so its farthest reach is
  // toward the camera at some point, and it must fit the view's height and its width, whichever is narrower)
  let extra = 0;
  if (printFrame) {
    const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const fits = Math.max(printFrame.halfHeight / tan, printFrame.radius / (tan * camera.aspect)) * 1.12 + printFrame.radius;
    extra = Math.max(0, fits - BUST_DISTANCE) * (1 - t);
  }
  camera.position.set(0, targetY + 0.5 - 0.5 * t, distance + extra);
  camera.lookAt(0, targetY, 0);
  // (the fog keeps its distance from the bust as the camera moves back)
  fog.near = FOG.near + extra;
  fog.far = FOG.far + extra;
}
placeCamera();
faceButton.dataset.distance = String(faceDistance());

// Newer Three.js uses physical light units, so intensities need a ~PI boost to match older looks.
scene.add(new THREE.HemisphereLight(0x6a5860, 0x1a1412, 1.1 * Math.PI));
const key = new THREE.DirectionalLight(0xffc9a0, 1.7 * Math.PI);
key.position.set(-3.5, 2, 2);
scene.add(key);
// A soft fill from the front keeps the shadowed side of the face readable
const fill = new THREE.DirectionalLight(0xb8c4e0, 0.55 * Math.PI);
fill.position.set(2.5, 1.2, 4);
scene.add(fill);
const rim = new THREE.DirectionalLight(0x7a8ab0, 1.0 * Math.PI);
rim.position.set(3, 2, -3);
scene.add(rim);

// The miniature's base: the one that prints (see print.ts), following the underside of the bust, so it is
// rebuilt with each bust. Its top is the plane the bust stands on.
const baseMaterial = new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.95, flatShading: true });
let base: THREE.Mesh | null = null;

const pivot = new THREE.Group();
scene.add(pivot);

let figure: THREE.Group | null = null;
let assets: Assets | null = null;
// The print preview (see printPreview.ts), shown in place of the sculpt until the sculpt is edited
let printView: { group: THREE.Group; prepared: Prepared } | null = null;

function leavePrint() {
  if (!printView) return;
  pivot.remove(printView.group);
  disposePreview(printView.group);
  printView = null;
  printFrame = null;
  placeCamera();
  if (figure) figure.visible = true;
  if (base) base.visible = true;
}

// Rebuilds the bust from the current settings. The sculpt is a deformed copy of a real head mesh, so
// this is fast enough to run on every slider movement.
let settle: number | undefined;
// The bust's colours (see paint.ts), apart from its sculpt: a change of colour repaints the bust as it is
let paint = defaultPaint(defaultParams().race);
let painter: Painter | null = null;
let clayOn = false;
let current: { params: Params; detail: boolean } | null = null; // the settings of the bust on show

function swap(params: Params, detail: boolean) {
  if (!assets) return;
  if (figure) {
    pivot.remove(figure);
    disposeObject(figure);
  }
  figure = buildBust(params, assets, detail);
  painter ??= new Painter(assets.head, paint);
  painter.apply(figure, params, clayOn);
  current = { params, detail };
  pivot.add(figure);
  if (base) {
    pivot.remove(base);
    base.geometry.dispose();
  }
  base = new THREE.Mesh(pedestalGeometry(figure.userData.reach, -PRINT.baseHeight * MM, (figure.userData.flatCut + PRINT.baseOverlap) * MM), baseMaterial);
  pivot.add(base); // (it turns with the bust, so the flare under the bust stays under it)
  // (a finer rebuild that lands while the print is shown stays hidden behind it)
  figure.visible = base.visible = !printView;
  // Refit the face framing to this bust (keeping the camera where it was if it is framing the face): from
  // the lowest point of its chin or beard to the highest point of its head
  const framingFace = Math.abs(distance - faceDistance()) < 0.01;
  chinY = figure.userData.faceBottom - 0.12;
  faceTop = new THREE.Box3().setFromObject(figure).max.y;
  faceButton.dataset.distance = String(faceDistance());
  if (framingFace) distance = faceDistance();
  placeCamera();
}

// Every edit shows a quick draft (without the carving), and the carved beard replaces it once the controls
// have been still for a moment.
function show(params: Params) {
  leavePrint();
  // (a new race brings its own colours: a half-orc's green skin, a tiefling's red; the grime stays)
  if (current && params.race !== current.params.race) {
    paint = racePaint(paint, params.race);
    paintPanel.set(paint);
    painter?.setPaint(paint);
  }
  swap(params, false);
  window.clearTimeout(settle);
  settle = window.setTimeout(() => swap(params, true), 160);
}

function resize() {
  const { clientWidth: w, clientHeight: h } = stage;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  placeCamera(); // (a narrow view needs the print preview farther off)
}
new ResizeObserver(resize).observe(stage);

let yaw = -0.5;
let turntable = true;
let dragging = false;
let lastX = 0;
canvas.addEventListener("pointerdown", (e) => {
  dragging = true;
  lastX = e.clientX;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointerup", () => (dragging = false));
canvas.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    distance = Math.min(9.5, Math.max(2.3, distance * (1 + e.deltaY * 0.001)));
    placeCamera();
  },
  { passive: false },
);
// Double-click snaps the bust to face the camera and holds it there for a few seconds.
let hold = 0;
canvas.addEventListener("dblclick", () => {
  yaw = 0;
  hold = performance.now() + 6000;
});
canvas.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  yaw += (e.clientX - lastX) * 0.012;
  lastX = e.clientX;
});

function frame() {
  requestAnimationFrame(frame);
  if (turntable && !dragging && performance.now() > hold) yaw += 0.003;
  draw();
  syncToolbar();
}

function draw() {
  pivot.rotation.y = yaw;
  renderer.render(scene, camera);
}

// The viewport toolbar: fixed views for comparing shapes at matching angles, bust or face framing, and the
// turntable
const toolbar = document.getElementById("toolbar") as HTMLElement;
const rotateButton = document.getElementById("rotate") as HTMLButtonElement;
const setTurntable = (on: boolean) => {
  turntable = on;
  rotateButton.setAttribute("aria-pressed", String(on));
};
for (const button of toolbar.querySelectorAll<HTMLButtonElement>("[data-yaw]")) {
  button.addEventListener("click", () => {
    yaw = Number(button.dataset.yaw);
    setTurntable(false);
  });
}
for (const button of toolbar.querySelectorAll<HTMLButtonElement>("[data-distance]")) {
  button.addEventListener("click", () => {
    distance = Number(button.dataset.distance);
    placeCamera();
  });
}
rotateButton.addEventListener("click", () => setTurntable(!turntable));
// Clay shows the bare form, in the one plain material of the print
const clayButton = document.getElementById("clay") as HTMLButtonElement;
clayButton.addEventListener("click", () => {
  clayOn = !clayOn;
  clayButton.setAttribute("aria-pressed", String(clayOn));
  if (figure && current) painter?.apply(figure, current.params, clayOn);
});

// The view and framing buttons light up while the camera is at their setting
const viewButtons = [...toolbar.querySelectorAll<HTMLButtonElement>("[data-yaw]")];
const framingButtons = [...toolbar.querySelectorAll<HTMLButtonElement>("[data-distance]")];
let shown = "";
function syncToolbar() {
  const still = !turntable && !dragging && performance.now() > hold;
  const state = `${still ? yaw.toFixed(3) : "moving"} ${distance.toFixed(2)}`;
  if (state === shown) return;
  shown = state;
  for (const button of viewButtons) button.setAttribute("aria-pressed", String(still && Math.abs(Number(button.dataset.yaw) - yaw) < 0.002));
  for (const button of framingButtons) button.setAttribute("aria-pressed", String(Math.abs(Number(button.dataset.distance) - distance) < 0.01));
}

// In development, a page script can render a frame on demand and read it back (for checking the look
// from a script even when the page is in a background tab and animation frames are paused)
if (import.meta.env.DEV) {
  (window as unknown as { effigy: unknown }).effigy = {
    scene,
    THREE, // (for cutting the bust open in a script, to look inside)
    renderer,
    render(view?: { yaw?: number; distance?: number }) {
      if (view?.yaw !== undefined) yaw = view.yaw;
      if (view?.distance !== undefined) {
        distance = view.distance;
        placeCamera();
      }
      setTurntable(false);
      draw();
      return canvas.toDataURL("image/jpeg", 0.88);
    },
  };
}

const initial = defaultParams();
mountPanel(
  panel,
  initial,
  show,
  async (params, say, partial, gusset, tabletop) => {
    if (!assets) throw new Error("the head model has not loaded");
    // (the print as previewed, if it was, with these same settings)
    const prepared = printView?.prepared.key === printKey(params, gusset, tabletop) ? printView.prepared : undefined;
    say(describe(await exportStl(params, assets, say, partial, gusset, tabletop, prepared)));
  },
  async (params, say, gusset, tabletop) => {
    if (!assets) throw new Error("the head model has not loaded");
    say(tabletop ? "Fitting the bust to the square" : "Collecting the parts");
    // (a moment for the message to show: this runs a few seconds on the page's own thread)
    await new Promise((resolve) => window.setTimeout(resolve, 30));
    const prepared = preparePrint(params, assets, gusset, tabletop);
    leavePrint();
    const group = previewGroup(prepared);
    // (measured before it joins the turning pivot, so in its own frame: the board's square included)
    const box = new THREE.Box3().setFromObject(group);
    const radius = Math.max(...[box.min.x, box.max.x].flatMap((x) => [box.min.z, box.max.z].map((z) => Math.hypot(x, z))));
    printFrame = { y: (box.min.y + box.max.y) / 2, halfHeight: (box.max.y - box.min.y) / 2, radius };
    placeCamera();
    pivot.add(group);
    printView = { group, prepared };
    if (figure) figure.visible = false;
    if (base) base.visible = false;
    say(describePrint(prepared));
  },
);

// The token (see token.ts): the painted head and shoulders, turned a little toward three-quarter view, drawn
// square over a dark backdrop at the size asked for, then framed and saved
const TOKEN_YAW = 0.35;
const TOKEN_FOV = 22;

// The camera for the token. Head and shoulders: from above the head to below the chin by about a head's depth.
// "whole" also fits everything above the chin (the head, its ears, hair and horns) inside the round within the
// rim, as it is seen turned to the token's view: measured from its own points as they fall in the picture, since
// horns that reach out sideways add width and depth, not height, and the frame is round, not square. "close" frames
// the height alone, a larger face, and wide horns may run into the rim.
function tokenLens(bust: THREE.Object3D, framing: TokenFraming): THREE.PerspectiveCamera {
  const top = faceTop + 0.08;
  const bottom = chinY - 0.7;
  const lens = new THREE.PerspectiveCamera(TOKEN_FOV, 1, 0.1, 80);
  const tan = Math.tan(THREE.MathUtils.degToRad(TOKEN_FOV / 2));
  const place = (y: number, distance: number) => {
    lens.position.set(0, y + 0.03 * distance, distance);
    lens.lookAt(0, y, 0);
    lens.updateMatrixWorld(true);
  };
  // (with room to spare at the top: the frame is round)
  const halfHeight = ((top - bottom) / 2 / (1 - 2 * RIM)) * 1.08;
  const close = halfHeight / tan;
  if (framing === "close") {
    place((top + bottom) / 2, close);
    return lens;
  }
  // The points that must stay inside the round, in the token's own turn (a sample of each part: a few thousand do)
  pivot.rotation.y = TOKEN_YAW;
  pivot.updateMatrixWorld(true);
  const points: THREE.Vector3[] = [new THREE.Vector3(0, bottom, 0)];
  bust.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.visible) return;
    const position = object.geometry.attributes.position;
    const step = Math.max(1, Math.floor(position.count / 3000));
    for (let i = 0; i < position.count; i += step) {
      const v = new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld);
      if (v.y >= chinY - 0.1) points.push(v);
    }
  });
  const highest = points.reduce((h, v) => Math.max(h, v.y), top);
  const y = (highest + bottom) / 2;
  const inside = (1 - 2 * RIM) * 0.96; // (the round within the rim, as a share of the half-width, with a little room)
  const fits = (distance: number) => {
    place(y, distance);
    const p = new THREE.Vector3();
    return points.every((v) => {
      p.copy(v).project(lens);
      return Math.hypot(p.x, p.y) <= inside;
    });
  };
  // (no nearer than the close framing; then as near as lets everything in)
  let [near, far] = [close, close * 4];
  if (!fits(near)) {
    while (!fits(far) && far < 60) far *= 1.5;
    for (let k = 0; k < 18; k++) {
      const middle = (near + far) / 2;
      if (fits(middle)) far = middle;
      else near = middle;
    }
  } else far = near;
  // The sample chose the distance; every point above the chin is checked against it, so a horn's tip that fell
  // between the sampled points is not cut by the rim (stepped back a little at a time until all are in)
  const all: THREE.Vector3[] = [];
  bust.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || !object.visible) return;
    const position = object.geometry.attributes.position;
    for (let i = 0; i < position.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(object.matrixWorld);
      if (v.y >= chinY - 0.1) all.push(v);
    }
  });
  const allFit = (distance: number) => {
    place(y, distance);
    const p = new THREE.Vector3();
    return all.every((v) => Math.hypot(p.copy(v).project(lens).x, p.y) <= inside);
  };
  for (let k = 0; k < 40 && !allFit(far); k++) far *= 1.02;
  place(y, far);
  return lens;
}

async function saveToken(size: number, framing: TokenFraming, backdropFile: string, say: (text: string) => void) {
  if (!assets || !figure || !current) throw new Error("the head model has not loaded");
  // (the character as it was when asked for: the picture and its name are of this, whatever is edited meanwhile)
  const asked = current.params;
  say("Painting the token");
  // (the backdrop's picture, if one is chosen, loaded while the message shows)
  const [picture] = await Promise.all([backdropFile ? backdropPicture(backdropFile).catch(() => null) : null, new Promise((resolve) => window.setTimeout(resolve, 30))]);
  if (backdropFile && !picture) throw new Error(`the backdrop ${backdropFile} could not be loaded`);
  if (current.params !== asked) throw new Error("the character changed before the token was painted: save it again");
  // (the carved hair and beard, if a slider has only just moved and the draft is on show)
  if (!current.detail) {
    window.clearTimeout(settle);
    swap(current.params, true);
  }
  const bust = figure!;
  const saved = { ratio: renderer.getPixelRatio(), background: scene.background, fog: scene.fog, yaw: pivot.rotation.y, print: printView?.group.visible, figure: bust.visible, base: base?.visible, clay: clayOn };
  const backdrop = tokenBackdrop(size, picture ?? undefined);
  let framed: HTMLCanvasElement;
  try {
    if (printView) printView.group.visible = false;
    bust.visible = true;
    if (base) base.visible = false;
    if (clayOn) painter?.apply(bust, current!.params, false);
    // (inside, so the turn it makes to measure is always undone)
    const lens = tokenLens(bust, framing);
    pivot.rotation.y = TOKEN_YAW;
    scene.background = backdrop;
    scene.fog = null;
    renderer.setPixelRatio(1);
    renderer.setSize(size, size, false);
    renderer.render(scene, lens);
    // (read back at once, in the same task as the render, before the canvas is cleared for the next frame)
    framed = frameToken(canvas, size);
  } finally {
    scene.background = saved.background;
    scene.fog = saved.fog;
    pivot.rotation.y = saved.yaw;
    if (printView) printView.group.visible = saved.print ?? true;
    bust.visible = saved.figure;
    if (base) base.visible = saved.base ?? true;
    if (saved.clay) painter?.apply(bust, current!.params, true);
    renderer.setPixelRatio(saved.ratio);
    resize();
    backdrop.dispose();
  }
  const blob = await new Promise<Blob | null>((resolve) => framed.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("the browser could not make the picture");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `effigy-${asked.race}-${asked.body}-token-${size}.png`;
  link.click();
  URL.revokeObjectURL(link.href);
  const edited = current?.params !== asked ? " (of the character as it was when you asked: it has changed since)" : "";
  say(`Saved a ${size} x ${size} px token of the ${asked.race}${edited} (${Math.round(blob.size / 1024)} KB).`);
}

const paintPanel = mountPaint(
  paint,
  (next) => {
    paint = next;
    painter?.setPaint(paint);
  },
  saveToken,
  loadBackdrops(),
);
// (after the Character section, where the race and styles are chosen)
panel.querySelector("section")!.after(paintPanel.section, ...(paintPanel.tokenSection ? [paintPanel.tokenSection] : []));
resize();
frame();

loadAssets()
  .then((loaded) => {
    assets = loaded;
    show(initial);
  })
  .catch((error) => {
    console.error(error);
    stage.insertAdjacentHTML("beforeend", '<p class="hint">Could not load the head model</p>');
  });
