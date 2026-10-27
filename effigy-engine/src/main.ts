import * as THREE from "three";
import "./style.css";
import { buildBust, disposeObject } from "./builder";
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
camera.position.set(0, 1.5, 4.6);
camera.lookAt(0, 0.95, 0);

// Newer Three.js uses physical light units, so intensities need a ~PI boost to match older looks.
scene.add(new THREE.HemisphereLight(0x6a5860, 0x1a1412, 1.1 * Math.PI));
const key = new THREE.DirectionalLight(0xffc9a0, 1.7 * Math.PI);
key.position.set(-3.5, 2, 2);
scene.add(key);
const rim = new THREE.DirectionalLight(0x4a70c0, 1.4 * Math.PI);
rim.position.set(3, 2, -3);
scene.add(rim);

// The miniature's base: 25 mm in print terms, and the footprint a token ring wraps around.
const base = new THREE.Mesh(
  new THREE.CylinderGeometry(1.1, 1.2, 0.1, 12),
  new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 0.95, flatShading: true }),
);
base.position.y = -0.05;
scene.add(base);

const pivot = new THREE.Group();
scene.add(pivot);

let figure: THREE.Group | null = null;
function show(params: Params) {
  if (figure) {
    pivot.remove(figure);
    disposeObject(figure);
  }
  figure = buildBust(params);
  pivot.add(figure);
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
canvas.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  yaw += (e.clientX - lastX) * 0.012;
  lastX = e.clientX;
});

function frame() {
  requestAnimationFrame(frame);
  if (!dragging) yaw += 0.003;
  pivot.rotation.y = yaw;
  renderer.render(scene, camera);
}

const initial = defaultParams();
show(initial);
mountPanel(panel, initial, show);
resize();
frame();
