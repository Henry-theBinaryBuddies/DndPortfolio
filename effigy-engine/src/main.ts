import * as THREE from "three";
import "./style.css";
import { buildBust, disposeObject } from "./builder";
import { loadAssets, type Assets } from "./assets";
import { defaultParams, type Params } from "./params";
import { mountPanel } from "./ui";

const stage = document.getElementById("stage") as HTMLElement;
const canvas = document.getElementById("view") as HTMLCanvasElement;
const panel = document.getElementById("panel") as HTMLElement;

// Three.js needs three things to draw: a scene (the world), a camera (the eye)
// and a renderer (which paints the camera's view onto the canvas).
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x14110f);
scene.fog = new THREE.Fog(0x14110f, 5, 10);

const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
// Scrolling zooms. Close in, the camera aims at the face instead of the whole bust. "Face" framing fits
// everything from the chin to the highest point of the head (the skull, horns or a mohawk), so it is
// worked out from each new bust.
const faceButton = document.querySelector<HTMLButtonElement>('#framing [data-distance="face"]')!;
const BUST_DISTANCE = 7.4;
const CHIN_Y = 1.4; // just under the chin, as a height above the plinth
let faceTop = 2.7;
let distance = BUST_DISTANCE;
function faceDistance() {
  // (with room to spare: the face sits in front of the turntable's centre, so it looks bigger than it is)
  const halfHeight = ((faceTop - CHIN_Y) / 2) * 1.5;
  return Math.min(BUST_DISTANCE - 1, Math.max(2.6, halfHeight / Math.tan(THREE.MathUtils.degToRad(16))));
}
function placeCamera() {
  const face = faceDistance();
  const t = Math.min(1, Math.max(0, (BUST_DISTANCE - distance) / (BUST_DISTANCE - face))); // 0 = full bust, 1 = the face
  const targetY = 1.2 + ((faceTop + CHIN_Y) / 2 - 1.2) * t;
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

// The miniature's base: 25 mm in print terms, and the footprint a token ring wraps around.
const base = new THREE.Mesh(
  new THREE.CylinderGeometry(1.75, 1.9, 0.1, 18),
  new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.95, flatShading: true }),
);
base.position.y = -0.05;
scene.add(base);

const pivot = new THREE.Group();
scene.add(pivot);

let figure: THREE.Group | null = null;
let assets: Assets | null = null;

// Rebuilds the bust from the current settings. The sculpt is a deformed copy of a real head mesh, so
// this is fast enough to run on every slider movement.
let settle: number | undefined;

function swap(params: Params, full: boolean) {
  if (!assets) return;
  if (figure) {
    pivot.remove(figure);
    disposeObject(figure);
  }
  figure = buildBust(params, assets, full);
  pivot.add(figure);
  // Refit the face framing to this bust's height (keeping the camera where it was if it is framing the face)
  const framingFace = Math.abs(distance - faceDistance()) < 0.01;
  faceTop = new THREE.Box3().setFromObject(figure).max.y;
  faceButton.dataset.distance = String(faceDistance());
  if (framingFace) distance = faceDistance();
  placeCamera();
}

// Every edit shows a quick draft (shape and shading only), and the full paint replaces it once the
// controls have been still for a moment.
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

// Clay shows the bare form in one plain grey material: no paint, no skin detail, no garment
const clay = new THREE.MeshStandardMaterial({ color: 0x9c9a96, roughness: 0.75 });
let clayOn = false;

function draw() {
  pivot.rotation.y = yaw;
  scene.overrideMaterial = clayOn ? clay : null;
  // Clay shows the bare form: the clear corneas (which would turn solid grey and hide the eyes), hair,
  // brows and lashes are left out
  const hidden: THREE.Object3D[] = [];
  if (clayOn) {
    pivot.traverse((o) => {
      if (o instanceof THREE.Mesh && o.visible && (((o.material as THREE.Material).transparent && !o.userData.form) || o.userData.strands)) {
        o.visible = false;
        hidden.push(o);
      }
    });
  }
  renderer.render(scene, camera);
  for (const o of hidden) o.visible = true;
}

// The viewport toolbar: fixed views for comparing shapes at matching angles, bust or face framing, the
// turntable and the clay view
const toolbar = document.getElementById("toolbar") as HTMLElement;
const rotateButton = document.getElementById("rotate") as HTMLButtonElement;
const clayButton = document.getElementById("clay") as HTMLButtonElement;
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
clayButton.addEventListener("click", () => {
  clayOn = !clayOn;
  clayButton.setAttribute("aria-pressed", String(clayOn));
});

// In development, a page script can render a frame on demand and read it back (for checking the look
// from a script even when the page is in a background tab and animation frames are paused)
if (import.meta.env.DEV) {
  (window as unknown as { effigy: unknown }).effigy = {
    scene,
    render(view?: { yaw?: number; clay?: boolean; distance?: number }) {
      if (view?.yaw !== undefined) yaw = view.yaw;
      if (view?.clay !== undefined) clayOn = view.clay;
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
mountPanel(panel, initial, show);
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
