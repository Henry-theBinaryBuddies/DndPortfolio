import * as THREE from "three";
import "./style.css";
import { buildBust, disposeObject, pedestalGeometry } from "./builder";
import { MM, PRINT } from "./print";
import { loadAssets, type Assets } from "./assets";
import { defaultParams, type Params } from "./params";
import { exportStl, describe } from "./exportStl";
import { mountPanel } from "./ui";

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
scene.fog = new THREE.Fog(0x14110f, 5, 10);

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
function placeCamera() {
  const face = faceDistance();
  const t = Math.min(1, Math.max(0, (BUST_DISTANCE - distance) / (BUST_DISTANCE - face))); // 0 = full bust, 1 = the face
  const targetY = 1.2 + ((faceTop + chinY) / 2 - 1.2) * t;
  camera.position.set(0, targetY + 0.5 - 0.5 * t, distance);
  camera.lookAt(0, targetY, 0);
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

// Rebuilds the bust from the current settings. The sculpt is a deformed copy of a real head mesh, so
// this is fast enough to run on every slider movement.
let settle: number | undefined;

function swap(params: Params, detail: boolean) {
  if (!assets) return;
  if (figure) {
    pivot.remove(figure);
    disposeObject(figure);
  }
  figure = buildBust(params, assets, detail);
  pivot.add(figure);
  if (base) {
    pivot.remove(base);
    base.geometry.dispose();
  }
  base = new THREE.Mesh(pedestalGeometry(figure.userData.reach, -PRINT.baseHeight * MM, (figure.userData.flatCut + PRINT.baseOverlap) * MM), baseMaterial);
  pivot.add(base); // (it turns with the bust, so the flare under the bust stays under it)
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
  swap(params, false);
  window.clearTimeout(settle);
  settle = window.setTimeout(() => swap(params, true), 160);
}

function resize() {
  const { clientWidth: w, clientHeight: h } = stage;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
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
mountPanel(panel, initial, show, async (params, say, partial) => {
  if (!assets) throw new Error("the head model has not loaded");
  say(describe(await exportStl(params, assets, say, partial)));
});
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
