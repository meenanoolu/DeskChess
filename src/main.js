import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Chess } from 'chess.js';
import { XRDevice, metaQuest3 } from 'iwer';
import { DevUI } from '@iwer/devui';

const hud = document.getElementById('hud');
const setHud = (t) => { if (hud) hud.textContent = t; };

async function supports(mode) {
  if (!navigator.xr?.isSessionSupported) return false;
  try { return await navigator.xr.isSessionSupported(mode); }
  catch { return false; }
}

const native = (await supports('immersive-ar')) || (await supports('immersive-vr'));
if (!native) {
  const xrDevice = new XRDevice(metaQuest3, { stereoEnabled: false });
  xrDevice.primaryInputMode = 'hand';
  xrDevice.position.set(0, 1.35, 0.15);
  xrDevice.hands.right.position.set(0.16, 1.02, -0.42);
  xrDevice.hands.left.position.set(-0.18, 1.05, -0.38);
  xrDevice.installRuntime({ forceInstall: true });
  new DevUI(xrDevice);
}

const chess = new Chess();
const S = 0.055;
const boardPos = new THREE.Vector3(0, 0.9, -0.62);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x000000, 0);
renderer.shadowMap.enabled = true;
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x24180f);
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.01, 20);
camera.position.set(0.15, 1.55, 0.28);

scene.add(new THREE.HemisphereLight(0xfff6ea, 0x3a2414, 1.15));
const sun = new THREE.DirectionalLight(0xfff1d0, 1.7);
sun.position.set(0.4, 2.2, 0.2);
sun.castShadow = true;
scene.add(sun);

const root = new THREE.Group();
root.position.copy(boardPos);
scene.add(root);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(boardPos);
controls.enableDamping = true;
controls.mouseButtons.LEFT = null;
controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
controls.update();

const table = new THREE.Mesh(
  new THREE.CylinderGeometry(0.42, 0.42, 0.025, 48),
  new THREE.MeshStandardMaterial({ color: 0x6a4328, roughness: 0.72 }),
);
table.position.y = -0.02;
table.receiveShadow = true;
root.add(table);

const dark = new THREE.MeshStandardMaterial({ color: 0x8d5a32, roughness: 0.62 });
const light = new THREE.MeshStandardMaterial({ color: 0xf0ddc0, roughness: 0.5 });
const frame = new THREE.Mesh(
  new THREE.BoxGeometry(S * 10, 0.016, S * 10),
  new THREE.MeshStandardMaterial({ color: 0x3b2616, roughness: 0.7 }),
);
frame.receiveShadow = true;
root.add(frame);

for (let r = 0; r < 8; r++) {
  for (let c = 0; c < 8; c++) {
    const id = String.fromCharCode(97 + c) + (8 - r);
    const sq = new THREE.Mesh(
      new THREE.BoxGeometry(S * 0.98, 0.008, S * 0.98),
      (r + c) % 2 === 0 ? light : dark,
    );
    sq.position.set((c - 3.5) * S, 0.01, (r - 3.5) * S);
    sq.receiveShadow = true;
    sq.userData.square = id;
    root.add(sq);
  }
}

function lathe(pts, mat) {
  const mesh = new THREE.Mesh(new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), 18), mat);
  mesh.castShadow = true;
  return mesh;
}
const PROFILES = {
  p: [[0.018, 0], [0.02, 0.008], [0.012, 0.02], [0.014, 0.036], [0.008, 0.048], [0.012, 0.056], [0, 0.056]],
  r: [[0.02, 0], [0.022, 0.01], [0.014, 0.018], [0.015, 0.05], [0.02, 0.058], [0.02, 0.066], [0, 0.066]],
  n: [[0.02, 0], [0.022, 0.01], [0.012, 0.02], [0.01, 0.05], [0.014, 0.062], [0, 0.062]],
  b: [[0.02, 0], [0.022, 0.01], [0.01, 0.028], [0.012, 0.055], [0.006, 0.07], [0.01, 0.078], [0, 0.078]],
  q: [[0.022, 0], [0.024, 0.01], [0.01, 0.03], [0.014, 0.07], [0.018, 0.082], [0.008, 0.092], [0, 0.092]],
  k: [[0.022, 0], [0.024, 0.01], [0.011, 0.03], [0.014, 0.075], [0.018, 0.088], [0.006, 0.1], [0, 0.1]],
};

function pieceMesh(type, color) {
  const mat = new THREE.MeshStandardMaterial({
    color: color === 'w' ? 0xf4efe4 : 0xc4212a,
    metalness: color === 'w' ? 0.55 : 0.25,
    roughness: 0.32,
  });
  const g = new THREE.Group();
  g.add(lathe(PROFILES[type] || PROFILES.p, mat));
  if (type === 'n') {
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 10), mat);
    head.position.set(0.008, 0.058, 0.006);
    g.add(head);
  }
  return g;
}

const pieces = new Map();
const hints = new THREE.Group();
root.add(hints);
const hintMat = new THREE.MeshBasicMaterial({ color: 0x39e07a, transparent: true, opacity: 0.85 });

function clearHints() {
  while (hints.children.length) hints.remove(hints.children[0]);
}
function showHints(from) {
  clearHints();
  for (const move of chess.moves({ square: from, verbose: true })) {
    const c = move.to.charCodeAt(0) - 97;
    const r = 8 - Number(move.to[1]);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(move.captured ? 0.012 : 0.008, 12, 12), hintMat);
    dot.position.set((c - 3.5) * S, 0.03, (r - 3.5) * S);
    dot.userData.square = move.to;
    hints.add(dot);
  }
}

function layout() {
  for (const obj of pieces.values()) root.remove(obj);
  pieces.clear();
  const board = chess.board();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p) continue;
      const mesh = pieceMesh(p.type, p.color);
      const id = String.fromCharCode(97 + c) + (8 - r);
      mesh.userData.square = id;
      mesh.userData.piece = true;
      mesh.position.set((c - 3.5) * S, 0.014, (r - 3.5) * S);
      root.add(mesh);
      pieces.set(id, mesh);
    }
  }
}
layout();

let selected = null;
function turnLine() {
  if (chess.isCheckmate()) return (chess.turn() === 'w' ? 'Black' : 'White') + ' wins by checkmate.';
  if (chess.isDraw()) return 'Draw.';
  const who = chess.turn() === 'w' ? 'White' : 'Black';
  return who + ' to move' + (chess.inCheck() ? ' — check' : '') + '.';
}
function helpLine() {
  return native
    ? 'Click a piece, then a green square. On Quest, Enter AR and pinch.'
    : 'Click a piece, then a green square. Enter AR opens a Quest 3 emulator — use its hand controls and pinch.';
}
function refreshHud(extra = '') { setHud(turnLine() + ' ' + helpLine() + extra); }
refreshHud();

function select(id) {
  selected = id;
  showHints(id);
  refreshHud(' Holding ' + id + '.');
}
function finishMove(from, to) {
  const move = chess.move({ from, to, promotion: 'q' });
  selected = null;
  clearHints();
  if (!move) {
    const mesh = pieces.get(from);
    if (mesh) {
      const c = from.charCodeAt(0) - 97;
      const r = 8 - Number(from[1]);
      mesh.position.set((c - 3.5) * S, 0.014, (r - 3.5) * S);
    }
    refreshHud(' Illegal.');
    return false;
  }
  layout();
  refreshHud(move.captured ? ' Captured.' : '');
  return true;
}

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
function hitSquare(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(root.children, true);
  for (const hit of hits) {
    let obj = hit.object;
    while (obj && obj !== root) {
      if (obj.userData.square) return obj.userData.square;
      obj = obj.parent;
    }
  }
  return null;
}
renderer.domElement.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || renderer.xr.isPresenting) return;
  const id = hitSquare(event);
  if (!id) return;
  if (selected) {
    const legal = chess.moves({ square: selected, verbose: true }).some((m) => m.to === id);
    if (legal) { finishMove(selected, id); return; }
    if (id === selected) { selected = null; clearHints(); refreshHud(); return; }
  }
  const occupant = chess.get(id);
  if (occupant && occupant.color === chess.turn()) select(id);
});

const factory = new XRHandModelFactory();
const grabbing = [null, null];
for (let i = 0; i < 2; i++) {
  const hand = renderer.xr.getHand(i);
  hand.add(factory.createHandModel(hand, 'mesh'));
  scene.add(hand);
  hand.addEventListener('pinchstart', () => {
    const tip = hand.joints?.['index-finger-tip'];
    if (!tip) return;
    const point = new THREE.Vector3().setFromMatrixPosition(tip.matrixWorld);
    let best = null;
    let bestD = 0.06;
    for (const [id, mesh] of pieces) {
      const d = mesh.getWorldPosition(new THREE.Vector3()).distanceTo(point);
      const occ = chess.get(id);
      if (occ && occ.color === chess.turn() && d < bestD) { bestD = d; best = id; }
    }
    if (best) grabbing[i] = best;
  });
  hand.addEventListener('pinchend', () => {
    const from = grabbing[i];
    grabbing[i] = null;
    if (!from) return;
    const mesh = pieces.get(from);
    if (!mesh) return;
    const local = root.worldToLocal(mesh.getWorldPosition(new THREE.Vector3()));
    const c = Math.round(local.x / S + 3.5);
    const r = Math.round(local.z / S + 3.5);
    const to = (c >= 0 && c < 8 && r >= 0 && r < 8) ? String.fromCharCode(97 + c) + (8 - r) : null;
    if (!to || !finishMove(from, to)) {
      const meshNow = pieces.get(from);
      if (meshNow) {
        const cc = from.charCodeAt(0) - 97;
        const rr = 8 - Number(from[1]);
        meshNow.position.set((cc - 3.5) * S, 0.014, (rr - 3.5) * S);
      }
    }
  });
}

document.body.appendChild(ARButton.createButton(renderer, {
  requiredFeatures: ['hand-tracking'],
  optionalFeatures: ['hit-test', 'local-floor'],
}));

renderer.xr.addEventListener('sessionstart', () => { controls.enabled = false; });
renderer.xr.addEventListener('sessionend', () => { controls.enabled = true; });

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

renderer.setAnimationLoop(() => {
  for (let i = 0; i < 2; i++) {
    const from = grabbing[i];
    if (!from) continue;
    const hand = renderer.xr.getHand(i);
    const tip = hand.joints?.['index-finger-tip'];
    const mesh = pieces.get(from);
    if (!tip || !mesh) continue;
    const point = new THREE.Vector3().setFromMatrixPosition(tip.matrixWorld);
    const local = root.worldToLocal(point);
    mesh.position.set(local.x, 0.04, local.z);
  }
  controls.update();
  renderer.render(scene, camera);
});
