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
// Scrolling zooms. Close in, the camera aims at the face instead of the whole bust.
let distance = 7.4;
function placeCamera() {
  const t = Math.min(1, Math.max(0, (7.4 - distance) / 4.4)); // 0 = full bust, 1 = close on the face
  const targetY = 1.2 + 0.65 * t;
  camera.position.set(0, targetY + 0.5 - 0.35 * t, distance);
  camera.lookAt(0, targetY, 0);
}
placeCamera();

// Newer Three.js uses physical light units, so intensities need a ~PI boost to match older looks.
scene.add(new THREE.HemisphereLight(0x6a5860, 0x1a1412, 1.1 * Math.PI));
const key = new THREE.DirectionalLight(0xffc9a0, 1.7 * Math.PI);
key.position.set(-3.5, 2, 2);
scene.add(key);
// A soft fill from the front keeps the shadowed side of the face readable
const fill = new THREE.DirectionalLight(0xb8c4e0, 0.55 * Math.PI);
fill.position.set(2.5, 1.2, 4);
scene.add(fill);
const rim = new THREE.DirectionalLight(0x4a70c0, 1.4 * Math.PI);
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
  if (!dragging && performance.now() > hold) yaw += 0.003;
  pivot.rotation.y = yaw;
  renderer.render(scene, camera);
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
