import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';
import { Chess } from 'chess.js';

const hud = document.getElementById('hud');
const setHud = (t) => { if (hud) hud.textContent = t; };

const chess = new Chess();
const S = 0.07;

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x1a120c, 1);
renderer.shadowMap.enabled = true;
renderer.xr.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.01, 20);
camera.position.set(0, 0.62, 0.78);
camera.lookAt(0, 0, 0);

scene.add(new THREE.HemisphereLight(0xfff4e5, 0x3a2a1a, 1.1));
const sun = new THREE.DirectionalLight(0xfff1d6, 1.6);
sun.position.set(0.6, 1.4, 0.8);
sun.castShadow = true;
scene.add(sun);

const root = new THREE.Group();
scene.add(root);

const table = new THREE.Mesh(
  new THREE.CylinderGeometry(0.55, 0.55, 0.03, 48),
  new THREE.MeshStandardMaterial({ color: 0x5c3a24, roughness: 0.8 }),
);
table.position.y = -0.02;
table.receiveShadow = true;
root.add(table);

const dark = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.65 });
const light = new THREE.MeshStandardMaterial({ color: 0xe6d3b1, roughness: 0.55 });
const frameMat = new THREE.MeshStandardMaterial({ color: 0x3e2918, roughness: 0.7 });
const frame = new THREE.Mesh(new THREE.BoxGeometry(S * 9.2, 0.018, S * 9.2), frameMat);
frame.position.y = -0.004;
frame.receiveShadow = true;
root.add(frame);

for (let r = 0; r < 8; r++) {
  for (let c = 0; c < 8; c++) {
    const sq = new THREE.Mesh(
      new THREE.BoxGeometry(S * 0.98, 0.01, S * 0.98),
      (r + c) % 2 === 0 ? light : dark,
    );
    sq.position.set((c - 3.5) * S, 0.006, (r - 3.5) * S);
    sq.receiveShadow = true;
    sq.userData.square = String.fromCharCode(97 + c) + (8 - r);
    root.add(sq);
  }
}

function pieceMesh(type, color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: color === 'w' ? 0xf3e6c8 : 0xb42323,
    metalness: color === 'w' ? 0.45 : 0.15,
    roughness: 0.35,
  });
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.012, 16), mat));
  let body;
  if (type === 'p') body = new THREE.Mesh(new THREE.SphereGeometry(0.016, 12, 12), mat);
  else if (type === 'r') body = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.018, 0.042, 8), mat);
  else if (type === 'n') body = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.05, 6), mat);
  else if (type === 'b') body = new THREE.Mesh(new THREE.SphereGeometry(0.018, 12, 12), mat);
  else if (type === 'q') body = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.02, 0.055, 10), mat);
  else body = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.022, 0.06, 10), mat);
  body.position.y = 0.03;
  body.castShadow = true;
  g.add(body);
  if (type === 'q' || type === 'k') {
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.01, 8, 8), mat);
    top.position.y = type === 'k' ? 0.07 : 0.062;
    g.add(top);
  }
  return g;
}

const pieces = new Map();
function layout() {
  for (const obj of pieces.values()) root.remove(obj);
  pieces.clear();
  const board = chess.board();
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p) continue;
      const mesh = pieceMesh(p.type, p.color);
      const sq = String.fromCharCode(97 + c) + (8 - r);
      mesh.userData.square = sq;
      mesh.position.set((c - 3.5) * S, 0.02, (r - 3.5) * S);
      root.add(mesh);
      pieces.set(sq, mesh);
    }
  }
}
layout();

function squareAt(worldPos) {
  const local = root.worldToLocal(worldPos.clone());
  const c = Math.round(local.x / S + 3.5);
  const r = Math.round(local.z / S + 3.5);
  if (c < 0 || c > 7 || r < 0 || r > 7) return null;
  return String.fromCharCode(97 + c) + (8 - r);
}
function localOf(sq) {
  const c = sq.charCodeAt(0) - 97;
  const r = 8 - Number(sq[1]);
  return new THREE.Vector3((c - 3.5) * S, 0.02, (r - 3.5) * S);
}
function turnText() {
  const who = chess.turn() === 'w' ? 'White' : 'Black';
  const extra = chess.isCheckmate() ? ' — checkmate' : chess.inCheck() ? ' — check' : '';
  return `${who} to move${extra}. Click a piece, then a square. On Quest: Enter AR and pinch.`;
}
setHud(turnText());

function tryMove(from, to) {
  const move = chess.move({ from, to, promotion: 'q' });
  if (!move) return false;
  layout();
  setHud(turnText() + (move.captured ? ' Capture.' : ''));
  return true;
}

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let selected = null;
function onPointer(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(root.children, true);
  if (!hits.length) return;
  let obj = hits[0].object;
  while (obj && !obj.userData.square && obj.parent) obj = obj.parent;
  const sq = obj?.userData?.square;
  if (!sq) return;
  if (!selected) {
    if (pieces.has(sq)) {
      selected = sq;
      setHud(`Selected ${sq}. Click a destination square.`);
    }
    return;
  }
  if (sq === selected) {
    selected = null;
    setHud(turnText());
    return;
  }
  if (!tryMove(selected, sq)) setHud(`Illegal move ${selected} → ${sq}. ${turnText()}`);
  selected = null;
}
renderer.domElement.addEventListener('pointerdown', onPointer);

const factory = new XRHandModelFactory();
const handState = [null, null];
for (let i = 0; i < 2; i++) {
  const hand = renderer.xr.getHand(i);
  hand.add(factory.createHandModel(hand, 'spheres'));
  scene.add(hand);
}

function pinchPoint(hand) {
  const index = hand.joints?.['index-finger-tip'];
  const thumb = hand.joints?.['thumb-tip'];
  if (!index || !thumb) return null;
  if (index.position.distanceTo(thumb.position) > 0.028) return null;
  return index.position.clone().lerp(thumb.position, 0.5);
}

function updateHands() {
  for (let i = 0; i < 2; i++) {
    const hand = renderer.xr.getHand(i);
    const point = pinchPoint(hand);
    const state = handState[i];
    if (point && !state) {
      let best = null;
      let bestD = 0.07;
      for (const [sq, mesh] of pieces) {
        const d = mesh.getWorldPosition(new THREE.Vector3()).distanceTo(point);
        if (d < bestD) { bestD = d; best = { sq, mesh }; }
      }
      if (best) handState[i] = { from: best.sq, mesh: best.mesh };
    } else if (point && state) {
      const local = root.worldToLocal(point.clone());
      state.mesh.position.set(local.x, 0.05, local.z);
    } else if (!point && state) {
      const target = squareAt(state.mesh.getWorldPosition(new THREE.Vector3()));
      if (!target || !tryMove(state.from, target)) state.mesh.position.copy(localOf(state.from));
      handState[i] = null;
    }
  }
}

document.body.appendChild(ARButton.createButton(renderer, {
  requiredFeatures: ['hit-test'],
  optionalFeatures: ['hand-tracking', 'dom-overlay', 'local-floor'],
  domOverlay: { root: document.body },
}));

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

renderer.setAnimationLoop(() => {
  updateHands();
  renderer.render(scene, camera);
});

setHud(turnText());
