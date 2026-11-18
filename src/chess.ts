import {
  createSystem,
  Entity,
  Grabbed,
  GrabSystem,
  Hovered,
  OneHandGrabbable,
  Pressed,
  RayInteractable,
  Vector3,
} from '@iwsdk/core';
import { Chess, type Square } from 'chess.js';
import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  TorusGeometry,
} from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { Piece } from './piece.js';
import {
  chooseMove,
  forcesMateInTwo,
  PUZZLES,
  restYaw,
  squareFromLocal,
  statusLine,
  tryMove,
} from './play.js';

const S = 0.055;
const PIECE_SCALE = 0.00084;
const COFFEE = { x: 0, y: 0.438, z: -1.95 };
const BUTTONS = new Set(['place', 'match', 'mate', 'reset']);

const IVORY = new MeshStandardMaterial({ color: 0xfff4e4, metalness: 0.05, roughness: 0.38 });
const EBONY = new MeshStandardMaterial({ color: 0x161311, metalness: 0.22, roughness: 0.34 });
const DISC = new MeshStandardMaterial({ color: 0x1a120c, roughness: 0.7 });
const HINT = new MeshBasicMaterial({ color: 0x39e07a, transparent: true, opacity: 0.9 });
const QUIET = new CylinderGeometry(S * 0.16, S * 0.16, 0.004, 20);
const CAPTURE = new CylinderGeometry(S * 0.28, S * 0.28, 0.004, 20);
const FOOT = new CylinderGeometry(S * 0.32, S * 0.32, 0.003, 20);
const RING_GEO = new TorusGeometry(0.045, 0.004, 10, 28);

const FILES: Record<string, string> = {
  p: 'Pawn.stl',
  r: 'Rook.stl',
  n: 'Knight.stl',
  b: 'Bishop.stl',
  q: 'Queen.stl',
  k: 'King.stl',
};

function squareAt(col: number, row: number) {
  return new Vector3((col - 3.5) * S, 0.02, (row - 3.5) * S);
}

function paint(canvas: HTMLCanvasElement, mesh: Mesh, text: string, bg: string, fg: string) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = fg;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = Math.floor(canvas.height * 0.42);
  do {
    ctx.font = `600 ${size}px sans-serif`;
    size -= 2;
  } while (ctx.measureText(text).width > canvas.width - 36 && size > 16);
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  const mat = mesh.material as MeshBasicMaterial;
  if (mat.map) mat.map.needsUpdate = true;
}

function plaque(w: number, h: number, text: string, bg: string, fg: string) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = Math.max(96, Math.round(512 * (h / w)));
  const mesh = new Mesh(
    new BoxGeometry(w, h, 0.008),
    new MeshBasicMaterial({ map: new CanvasTexture(canvas), side: DoubleSide }),
  );
  paint(canvas, mesh, text, bg, fg);
  return { mesh, canvas };
}

export class ChessSystem extends createSystem({
  held: { required: [Piece, Grabbed] },
  looked: { required: [Piece, Hovered] },
  pressed: { required: [Piece, Pressed] },
}) {
  private chess = new Chess();
  private mode: 'match' | 'mate' = 'match';
  private puzzle = 0;
  private matePly = 0;
  private board!: Group;
  private boardEntity!: Entity;
  private homes = new Map<Entity, Vector3>();
  private hints!: Group;
  private label!: Mesh;
  private labelCanvas!: HTMLCanvasElement;
  private hud!: Group;
  private calib!: Group;
  private calibCanvas!: HTMLCanvasElement;
  private calibMesh!: Mesh;
  private matchCanvas!: HTMLCanvasElement;
  private mateCanvas!: HTMLCanvasElement;
  private matchMesh!: Mesh;
  private mateMesh!: Mesh;
  private mateRim!: Mesh;
  private resetObj!: Mesh;
  private ringL!: Mesh;
  private ringR!: Mesh;
  private pending: Entity[] = [];
  private checkRing!: Mesh;
  private hoverRing!: Mesh;
  private geos = new Map<string, BufferGeometry>();
  private placed = false;
  private aiWait = 0;
  private noteLeft = 0;
  private celebrate = 0;
  private buttonLock = 0;
  private palm = 0;
  private tmp = new Vector3();
  private headPos = new Vector3();
  private forward = new Vector3();
  private tipL = new Vector3();
  private tipR = new Vector3();
  private prevL = new Vector3(9, 9, 9);
  private prevR = new Vector3(9, 9, 9);

  init() {
    this.board = new Group();
    this.board.name = 'Chess Board';
    this.board.visible = false;
    this.boardEntity = this.world.createTransformEntity(this.board);

    const frame = new Mesh(
      new BoxGeometry(S * 10.2, 0.012, S * 10.2),
      new MeshStandardMaterial({ color: 0x3a2416, roughness: 0.55 }),
    );
    frame.position.y = 0.006;
    frame.receiveShadow = true;
    this.board.add(frame);

    const lightMat = new MeshStandardMaterial({ color: 0xe4d0ac, roughness: 0.58 });
    const darkMat = new MeshStandardMaterial({ color: 0x5c3b22, roughness: 0.64 });
    for (let row = 0; row < 8; row += 1) {
      for (let col = 0; col < 8; col += 1) {
        const sq = new Mesh(
          new BoxGeometry(S * 0.98, 0.008, S * 0.98),
          (row + col) % 2 === 0 ? lightMat : darkMat,
        );
        sq.position.copy(squareAt(col, row));
        sq.receiveShadow = true;
        this.board.add(sq);
      }
    }

    this.hints = new Group();
    this.board.add(this.hints);
    this.checkRing = new Mesh(
      new CylinderGeometry(S * 0.42, S * 0.42, 0.004, 24),
      new MeshBasicMaterial({ color: 0xff3344 }),
    );
    this.checkRing.visible = false;
    this.board.add(this.checkRing);
    this.hoverRing = new Mesh(
      new CylinderGeometry(S * 0.46, S * 0.46, 0.003, 24),
      new MeshBasicMaterial({ color: 0xffe08a }),
    );
    this.hoverRing.visible = false;
    this.board.add(this.hoverRing);

    this.hud = new Group();
    this.hud.position.set(0, 0.02, 0.34);
    this.hud.rotation.x = -0.61;
    this.board.add(this.hud);

    this.labelCanvas = document.createElement('canvas');
    this.labelCanvas.width = 512;
    this.labelCanvas.height = 128;
    this.label = new Mesh(
      new BoxGeometry(0.36, 0.048, 0.006),
      new MeshBasicMaterial({ map: new CanvasTexture(this.labelCanvas), side: DoubleSide }),
    );
    this.label.position.set(0, 0.058, 0);
    this.hud.add(this.label);

    const match = plaque(0.145, 0.046, 'Full Match', '#2a2118', '#f4efe6');
    this.matchMesh = match.mesh;
    this.matchCanvas = match.canvas;
    this.attachButton(this.matchMesh, 'match', this.hud, -0.115, 0, 0.006);

    this.mateRim = new Mesh(
      new BoxGeometry(0.162, 0.056, 0.006),
      new MeshStandardMaterial({ color: 0xd7b56a, roughness: 0.4, metalness: 0.35 }),
    );
    this.mateRim.position.set(0.045, 0, 0);
    this.hud.add(this.mateRim);

    const mate = plaque(0.15, 0.046, 'Mate in 2', '#f0d48a', '#2a2118');
    this.mateMesh = mate.mesh;
    this.mateCanvas = mate.canvas;
    this.attachButton(this.mateMesh, 'mate', this.hud, 0.045, 0, 0.008);

    const reset = plaque(0.078, 0.046, 'Reset', '#2a2118', '#f4efe6');
    this.resetObj = reset.mesh;
    this.resetObj.name = 'Reset';
    this.attachButton(this.resetObj, 'reset', this.hud, 0.175, 0, 0.006);

    this.calib = new Group();
    this.calib.position.set(0, 0.62, -1.38);
    this.calib.rotation.x = -0.55;
    this.world.createTransformEntity(this.calib);
    this.calibCanvas = document.createElement('canvas');
    this.calibCanvas.width = 640;
    this.calibCanvas.height = 280;
    this.calibMesh = new Mesh(
      new BoxGeometry(0.48, 0.2, 0.008),
      new MeshBasicMaterial({ map: new CanvasTexture(this.calibCanvas), side: DoubleSide }),
    );
    this.calib.add(this.calibMesh);
    this.paintCalib();
    const place = plaque(0.28, 0.05, 'Place Board Here', '#f4efe6', '#1b1612');
    this.attachButton(place.mesh, 'place', this.calib, 0, -0.055, 0.01);

    const ringMat = () => new MeshBasicMaterial({ color: 0xffe08a, side: DoubleSide });
    this.ringL = new Mesh(RING_GEO, ringMat());
    this.ringR = new Mesh(RING_GEO, ringMat());
    this.ringL.rotation.x = Math.PI / 2;
    this.ringR.rotation.x = Math.PI / 2;
    this.ringL.visible = false;
    this.ringR.visible = false;
    this.world.createTransformEntity(this.ringL);
    this.world.createTransformEntity(this.ringR);

    this.paintStatus('Place the board');
    void this.loadPieces();

    this.queries.held.subscribe('qualify', (entity: Entity) => {
      const square = entity.getValue(Piece, 'square');
      if (!square || BUTTONS.has(square)) return;
      if (!this.placed || this.chess.isGameOver() || this.aiWait > 0 || this.celebrate > 0) {
        this.world.getSystem(GrabSystem)?.forceRelease(entity);
        return;
      }
      const piece = this.chess.get(square as Square);
      if (!piece || piece.color !== this.chess.turn() || piece.color !== 'w') {
        this.world.getSystem(GrabSystem)?.forceRelease(entity);
        this.say(piece?.color === 'b' ? 'Bot plays black' : 'Not your piece');
        return;
      }
      this.showHints(square);
    });
    this.queries.held.subscribe('disqualify', (entity: Entity) => {
      this.pending.push(entity);
    });
    this.queries.pressed.subscribe('qualify', (entity: Entity) => {
      const square = entity.getValue(Piece, 'square');
      if (!square) return;
      if (BUTTONS.has(square)) {
        this.pressButton(square);
        return;
      }
      if (!this.homes.has(entity)) return;
      if (!this.placed || this.chess.isGameOver() || this.aiWait > 0 || this.celebrate > 0) return;
      const piece = this.chess.get(square as Square);
      if (!piece || piece.color !== 'w' || piece.color !== this.chess.turn()) return;
      this.showHints(square);
    });
  }

  update(delta: number, time: number) {
    if (this.buttonLock > 0) this.buttonLock -= delta;
    if (!this.placed) this.trackPalms(delta);
    else if (this.mode === 'match') {
      const pulse = 1 + Math.sin(time * 3) * 0.035;
      this.mateMesh.scale.setScalar(pulse);
      this.mateRim.scale.set(pulse, pulse, 1);
    }
    this.hover();
    if (this.noteLeft > 0) {
      this.noteLeft -= delta;
      if (this.noteLeft <= 0) this.refreshStatus();
    }
    if (this.celebrate > 0) {
      this.celebrate -= delta;
      if (this.celebrate <= 0) this.advancePuzzle();
    }
    if (this.aiWait > 0 && this.celebrate <= 0) {
      this.aiWait -= delta;
      if (this.aiWait <= 0) this.playBlack();
    }
    if (this.pending.length === 0) return;
    const batch = this.pending.splice(0);
    for (const entity of batch) this.release(entity);
  }

  private attachButton(mesh: Mesh, square: string, parent: Group, x: number, y: number, z: number) {
    const entity = this.world.createTransformEntity(mesh);
    parent.attach(mesh);
    mesh.position.set(x, y, z);
    mesh.rotation.set(0, 0, 0);
    entity.addComponent(OneHandGrabbable, { rotate: false, translate: false });
    entity.addComponent(RayInteractable);
    entity.addComponent(Piece, { square });
  }

  private hover() {
    this.hoverRing.visible = false;
    if (!this.placed) return;
    for (const entity of this.queries.looked.entities) {
      if (!this.homes.has(entity)) continue;
      const obj = entity.object3D;
      if (!obj) continue;
      obj.getWorldPosition(this.tmp);
      this.hoverRing.position.copy(this.board.worldToLocal(this.tmp));
      this.hoverRing.position.y = 0.03;
      this.hoverRing.visible = true;
      break;
    }
  }

  private trackPalms(delta: number) {
    const leftOk = this.readTip(this.player.indexTipSpaces.left, this.tipL);
    const rightOk = this.readTip(this.player.indexTipSpaces.right, this.tipR);
    if (!leftOk || !rightOk) {
      this.palm = Math.max(0, this.palm - delta);
      this.ringL.visible = false;
      this.ringR.visible = false;
      this.paintCalib();
      return;
    }
    this.ringL.visible = true;
    this.ringR.visible = true;
    this.ringL.position.copy(this.tipL);
    this.ringR.position.copy(this.tipR);
    const sep = this.tipL.distanceTo(this.tipR);
    const level = Math.abs(this.tipL.y - this.tipR.y) < 0.045;
    const y = (this.tipL.y + this.tipR.y) * 0.5;
    const desk = y > 0.32 && y < 0.82;
    this.player.head.getWorldPosition(this.headPos);
    this.player.head.getWorldDirection(this.forward);
    this.forward.y = 0;
    if (this.forward.lengthSq() < 1e-4) this.forward.set(0, 0, -1);
    this.forward.normalize();
    this.tmp.set((this.tipL.x + this.tipR.x) * 0.5, this.headPos.y, (this.tipL.z + this.tipR.z) * 0.5);
    const ahead = this.tmp.sub(this.headPos);
    const dist = Math.hypot(ahead.x, ahead.z);
    const facing = dist > 0.05 ? ahead.setY(0).normalize().dot(this.forward) > 0.35 : false;
    const still =
      this.tipL.distanceTo(this.prevL) < 0.018 && this.tipR.distanceTo(this.prevR) < 0.018;
    this.prevL.copy(this.tipL);
    this.prevR.copy(this.tipR);
    if (sep > 0.16 && sep < 0.55 && level && desk && facing && dist > 0.35 && dist < 1.8 && still) {
      this.palm += delta;
    } else {
      this.palm = Math.max(0, this.palm - delta * 0.85);
    }
    const fill = Math.min(1, this.palm);
    const color = fill > 0.05 ? 0x39e07a : 0xffe08a;
    (this.ringL.material as MeshBasicMaterial).color.set(color);
    (this.ringR.material as MeshBasicMaterial).color.set(color);
    this.ringL.scale.setScalar(0.75 + fill * 0.35);
    this.ringR.scale.setScalar(0.75 + fill * 0.35);
    this.paintCalib();
    if (this.palm >= 1.05) {
      this.placeBoard((this.tipL.x + this.tipR.x) * 0.5, y, (this.tipL.z + this.tipR.z) * 0.5);
    }
  }

  private readTip(space: Group, out: Vector3) {
    space.getWorldPosition(out);
    if (out.lengthSq() < 0.04) return false;
    this.player.head.getWorldPosition(this.headPos);
    return out.distanceTo(this.headPos) > 0.2;
  }

  private placeBoard(x: number, y: number, z: number) {
    if (this.placed) return;
    this.board.position.set(x, y + 0.002, z);
    this.player.head.getWorldPosition(this.headPos);
    const dx = this.headPos.x - x;
    const dz = this.headPos.z - z;
    this.board.rotation.y = dx * dx + dz * dz > 0.0025 ? Math.atan2(dx, dz) : 0;
    this.board.visible = true;
    this.placed = true;
    this.calib.visible = false;
    this.ringL.visible = false;
    this.ringR.visible = false;
    if (Math.hypot(x, z + 1.95) < 0.55) this.stepTowardCoffee(x, z);
    if (this.geos.size === Object.keys(FILES).length) this.startMatch();
    else this.paintStatus('Loading pieces');
  }

  /** Emulator spawn is the room origin. Step up to the coffee table so hands can reach. */
  private stepTowardCoffee(x: number, z: number) {
    this.player.head.getWorldPosition(this.headPos);
    if (Math.hypot(this.headPos.x, this.headPos.z) > 0.85) return;
    this.player.position.z -= 1.05;
    this.player.updateWorldMatrix(true, true);
    this.camera.position.set(0, 1.42, 0);
    this.camera.lookAt(0, 0.5, -1.95);
    this.player.head.getWorldPosition(this.headPos);
    const dx = this.headPos.x - x;
    const dz = this.headPos.z - z;
    if (dx * dx + dz * dz > 0.0025) this.board.rotation.y = Math.atan2(dx, dz);
  }

  private pressButton(square: string) {
    if (this.buttonLock > 0) return;
    if (square === 'place') {
      if (this.placed) return;
      this.buttonLock = 0.4;
      this.placeBoard(COFFEE.x, COFFEE.y, COFFEE.z);
      return;
    }
    if (!this.placed || this.geos.size !== Object.keys(FILES).length) return;
    this.buttonLock = 0.4;
    if (square === 'match') this.startMatch();
    else if (square === 'mate') this.startMate();
    else if (square === 'reset') {
      if (this.mode === 'mate') this.startMate();
      else this.startMatch();
    }
  }

  private startMatch() {
    this.mode = 'match';
    this.matePly = 0;
    this.aiWait = 0;
    this.celebrate = 0;
    this.noteLeft = 0;
    this.chess.reset();
    this.paintButtons();
    this.layout();
  }

  private startMate() {
    this.mode = 'mate';
    this.puzzle = 0;
    this.matePly = 0;
    this.aiWait = 0;
    this.celebrate = 0;
    this.noteLeft = 0;
    this.chess.load(PUZZLES[0].fen);
    this.paintButtons();
    this.layout();
  }

  private advancePuzzle() {
    const wrapped = this.puzzle + 1 >= PUZZLES.length;
    this.puzzle = (this.puzzle + 1) % PUZZLES.length;
    this.matePly = 0;
    this.chess.load(PUZZLES[this.puzzle].fen);
    this.layout();
    if (wrapped) this.say('Solved');
  }

  private async loadPieces() {
    const loader = new STLLoader();
    try {
      await Promise.all(
        Object.entries(FILES).map(
          ([key, file]) =>
            new Promise<void>((resolve, reject) => {
              loader.load(
                `${import.meta.env.BASE_URL}pieces/${file}`,
                (geometry) => {
                  geometry.computeBoundingBox();
                  const box = geometry.boundingBox;
                  if (box) {
                    geometry.translate(
                      -((box.min.x + box.max.x) / 2),
                      -box.min.y,
                      -((box.min.z + box.max.z) / 2),
                    );
                  }
                  geometry.scale(PIECE_SCALE, PIECE_SCALE, PIECE_SCALE);
                  this.geos.set(key, geometry);
                  resolve();
                },
                undefined,
                () => reject(new Error(file)),
              );
            }),
        ),
      );
    } catch {
      this.paintStatus('Pieces failed to load');
      return;
    }
    if (this.placed) this.startMatch();
  }

  private pieceMesh(type: string, color: 'w' | 'b') {
    const mesh = new Mesh(this.geos.get(type) ?? this.geos.get('p'), color === 'w' ? IVORY : EBONY);
    mesh.castShadow = true;
    mesh.rotation.y = restYaw(type, color);
    const foot = new Mesh(FOOT, DISC);
    foot.position.y = 0.002;
    mesh.add(foot);
    return mesh;
  }

  private paintStatus(text: string) {
    paint(this.labelCanvas, this.label, text, '#1b1612', '#f4efe6');
  }

  private paintCalib() {
    const ctx = this.calibCanvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 640, 280);
    ctx.fillStyle = '#1b1612';
    ctx.fillRect(0, 0, 640, 280);
    ctx.fillStyle = '#f4efe6';
    ctx.textAlign = 'center';
    ctx.font = '600 42px sans-serif';
    ctx.fillText(this.palm > 0.08 ? 'Hold both palms still' : 'Palms down on the table', 320, 78);
    const fill = Math.min(1, this.palm);
    for (const x of [230, 410]) {
      ctx.beginPath();
      ctx.arc(x, 168, 36, 0, Math.PI * 2);
      ctx.strokeStyle = fill > 0.05 ? '#39e07a' : '#ffe08a';
      ctx.lineWidth = 8;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, 168, 22, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * fill);
      ctx.strokeStyle = '#39e07a';
      ctx.lineWidth = 6;
      ctx.stroke();
    }
    const mat = this.calibMesh.material as MeshBasicMaterial;
    if (mat.map) mat.map.needsUpdate = true;
  }

  private paintButtons() {
    if (this.mode === 'match') {
      paint(this.matchCanvas, this.matchMesh, 'Full Match', '#f4efe6', '#1b1612');
      paint(this.mateCanvas, this.mateMesh, 'Mate in 2', '#f0d48a', '#2a2118');
      this.mateMesh.scale.setScalar(1);
      this.mateRim.scale.set(1, 1, 1);
    } else {
      paint(this.matchCanvas, this.matchMesh, 'Full Match', '#2a2118', '#f4efe6');
      paint(this.mateCanvas, this.mateMesh, 'Mate in 2', '#fff4d2', '#1b1612');
      this.mateMesh.scale.setScalar(1);
      this.mateRim.scale.set(1, 1, 1);
    }
  }

  private say(text: string) {
    this.noteLeft = 1.3;
    this.paintStatus(text);
  }

  private refreshStatus() {
    if (this.celebrate > 0) {
      this.paintStatus('Checkmate');
      this.placeCheckRing();
      return;
    }
    if (this.mode === 'mate') {
      const n = `${this.puzzle + 1}/${PUZZLES.length}`;
      this.paintStatus(this.matePly === 0 ? `Mate in 2  ${n}` : 'Finish it');
      this.placeCheckRing();
      return;
    }
    if (this.aiWait > 0 && !this.chess.isGameOver()) {
      this.paintStatus('Bot is thinking');
      this.placeCheckRing();
      return;
    }
    const line = statusLine(this.chess);
    this.paintStatus(this.chess.isGameOver() ? `${line} — reset` : `${line} · vs Bot`);
    this.placeCheckRing();
  }

  private placeCheckRing() {
    if (!this.chess.inCheck()) {
      this.checkRing.visible = false;
      return;
    }
    const squares = this.chess.board();
    for (let row = 0; row < 8; row += 1) {
      for (let col = 0; col < 8; col += 1) {
        const piece = squares[row][col];
        if (piece?.type === 'k' && piece.color === this.chess.turn()) {
          this.checkRing.position.copy(squareAt(col, row));
          this.checkRing.position.y = 0.028;
          this.checkRing.visible = true;
        }
      }
    }
  }

  private clearHints() {
    for (const child of [...this.hints.children]) this.hints.remove(child);
  }

  private showHints(from: string) {
    this.clearHints();
    for (const move of this.chess.moves({ square: from as Square, verbose: true })) {
      const col = move.to.charCodeAt(0) - 97;
      const row = 8 - Number(move.to[1]);
      const dot = new Mesh(move.captured ? CAPTURE : QUIET, HINT);
      dot.position.copy(squareAt(col, row));
      dot.position.y = 0.028;
      this.hints.add(dot);
    }
  }

  private layout() {
    for (const entity of this.homes.keys()) entity.dispose({ disposeResources: false });
    this.homes.clear();
    this.pending.length = 0;
    this.clearHints();
    const rows = this.chess.board();
    for (let row = 0; row < 8; row += 1) {
      for (let col = 0; col < 8; col += 1) {
        const piece = rows[row][col];
        if (!piece) continue;
        const id = (String.fromCharCode(97 + col) + (8 - row)) as Square;
        const mesh = this.pieceMesh(piece.type, piece.color);
        mesh.name = `Piece ${id}`;
        const entity = this.world.createTransformEntity(mesh, this.boardEntity);
        const home = squareAt(col, row);
        mesh.position.copy(home);
        entity.addComponent(OneHandGrabbable, { rotate: false });
        entity.addComponent(RayInteractable);
        entity.addComponent(Piece, { square: id });
        this.homes.set(entity, home);
      }
    }
    this.refreshStatus();
  }

  private snapHome(obj: Mesh, home: Vector3, square: string) {
    if (obj.parent !== this.board) this.board.attach(obj);
    obj.position.copy(home);
    const piece = this.chess.get(square as Square);
    obj.rotation.set(0, piece ? restYaw(piece.type, piece.color) : 0, 0);
  }

  private snapControl(obj: Mesh) {
    const square = obj === this.resetObj ? 'reset' : obj === this.matchMesh ? 'match' : obj === this.mateMesh ? 'mate' : 'place';
    const parent = square === 'place' ? this.calib : this.hud;
    if (obj.parent !== parent) parent.attach(obj);
    obj.rotation.set(0, 0, 0);
    if (square === 'match') obj.position.set(-0.115, 0, 0.006);
    else if (square === 'mate') obj.position.set(0.045, 0, 0.008);
    else if (square === 'reset') obj.position.set(0.175, 0, 0.006);
    else obj.position.set(0, -0.055, 0.01);
  }

  private release(entity: Entity) {
    const square = entity.getValue(Piece, 'square');
    const obj = entity.object3D as Mesh | null;
    if (!square || !obj) return;
    if (BUTTONS.has(square)) {
      this.snapControl(obj);
      this.pressButton(square);
      return;
    }
    const home = this.homes.get(entity);
    if (!home || !this.placed || this.celebrate > 0) {
      if (home) this.snapHome(obj, home, square);
      this.clearHints();
      return;
    }
    if (this.chess.isGameOver() || this.aiWait > 0) {
      this.snapHome(obj, home, square);
      this.clearHints();
      return;
    }
    this.board.updateWorldMatrix(true, false);
    obj.updateWorldMatrix(true, false);
    const local = this.board.worldToLocal(obj.getWorldPosition(this.tmp));
    const to = squareFromLocal(local.x, local.z, S);
    const before = this.chess.fen();
    const played = tryMove(this.chess, square, to);
    if (!played) {
      this.snapHome(obj, home, square);
      this.clearHints();
      if (to && to !== square) this.say('Illegal move');
      else this.refreshStatus();
      return;
    }
    if (this.mode === 'mate') {
      if (this.chess.isCheckmate()) {
        this.celebrate = 1.5;
        this.matePly = 0;
        this.layout();
        return;
      }
      if (this.matePly === 0 && forcesMateInTwo(before, square, to)) {
        this.matePly = 1;
        this.aiWait = 0.45;
        this.layout();
        return;
      }
      this.chess.undo();
      this.layout();
      this.say(this.matePly === 0 ? 'Not that move' : 'Look again');
      return;
    }
    if (!this.chess.isGameOver() && this.chess.turn() === 'b') this.aiWait = 0.55;
    this.layout();
  }

  private playBlack() {
    this.aiWait = 0;
    if (this.chess.turn() !== 'b' || this.chess.isGameOver()) {
      this.refreshStatus();
      return;
    }
    for (const _entity of this.queries.held.entities) {
      this.aiWait = 0.25;
      return;
    }
    const choice = chooseMove(this.chess, this.mode === 'mate' ? 1 : 2);
    if (!choice || !tryMove(this.chess, choice.from, choice.to)) {
      this.refreshStatus();
      return;
    }
    this.layout();
  }
}
