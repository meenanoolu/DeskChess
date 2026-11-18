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
  XRMesh,
  XRPlane,
} from '@iwsdk/core';
import { Chess, type Square } from 'chess.js';
import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
} from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { Piece } from './piece.js';
import { chooseMove, restYaw, squareFromLocal, statusLine, tryMove } from './play.js';

const S = 0.055;
const PIECE_SCALE = 0.00084;
// Coffee table in the built-in sunlit living room (viewer at the origin, facing -Z).
const COFFEE = { x: 0, y: 0.438, z: -1.95 };

const GOLD = new MeshStandardMaterial({ color: 0xd7c08a, metalness: 0.72, roughness: 0.32 });
const RED = new MeshStandardMaterial({ color: 0xc41722, metalness: 0.4, roughness: 0.3 });
const DISC = new MeshStandardMaterial({ color: 0x1c140e, roughness: 0.7 });
const HINT = new MeshBasicMaterial({ color: 0x39e07a, transparent: true, opacity: 0.9 });
const QUIET = new CylinderGeometry(S * 0.16, S * 0.16, 0.004, 20);
const CAPTURE = new CylinderGeometry(S * 0.28, S * 0.28, 0.004, 20);
const FOOT = new CylinderGeometry(S * 0.32, S * 0.32, 0.003, 20);

const FILES: Record<string, string> = {
  p: 'Pawn.stl',
  r: 'Rook.stl',
  n: 'Knight.stl',
  b: 'Bishop.stl',
  q: 'Queen.stl',
  k: 'King.stl',
};

type PlaneData = {
  orientation?: string;
  polygon?: Array<{ x: number; z: number }>;
};

function squareAt(col: number, row: number) {
  return new Vector3((col - 3.5) * S, 0.02, (row - 3.5) * S);
}

export class ChessSystem extends createSystem({
  held: { required: [Piece, Grabbed] },
  looked: { required: [Piece, Hovered] },
  pressed: { required: [Piece, Pressed] },
  planes: { required: [XRPlane] },
  meshes: { required: [XRMesh] },
}) {
  private chess = new Chess();
  private board!: Group;
  private boardEntity!: Entity;
  private homes = new Map<Entity, Vector3>();
  private hints!: Group;
  private label!: Mesh;
  private labelCanvas!: HTMLCanvasElement;
  private pending: Entity[] = [];
  private checkRing!: Mesh;
  private hoverRing!: Mesh;
  private resetObj!: Mesh;
  private geos = new Map<string, BufferGeometry>();
  private placed = false;
  private locked = false;
  private stepped = false;
  private aiWait = 0;
  private noteLeft = 0;
  private tmp = new Vector3();
  private headPos = new Vector3();
  private forward = new Vector3();

  init() {
    this.board = new Group();
    this.board.name = 'Chess Board';
    this.board.visible = false;
    this.boardEntity = this.world.createTransformEntity(this.board);

    const frame = new Mesh(
      new BoxGeometry(S * 10.2, 0.012, S * 10.2),
      new MeshStandardMaterial({ color: 0xe9dcc4, roughness: 0.55 }),
    );
    frame.position.y = 0.006;
    frame.receiveShadow = true;
    this.board.add(frame);

    const lightMat = new MeshStandardMaterial({ color: 0xf4efe4, roughness: 0.62 });
    const darkMat = new MeshStandardMaterial({ color: 0x8a5a32, roughness: 0.7 });
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

    this.labelCanvas = document.createElement('canvas');
    this.labelCanvas.width = 512;
    this.labelCanvas.height = 128;
    this.label = new Mesh(
      new BoxGeometry(0.32, 0.052, 0.006),
      new MeshBasicMaterial({ map: new CanvasTexture(this.labelCanvas) }),
    );
    this.label.position.set(0, 0.08, 0.24);
    this.label.rotation.x = -0.85;
    this.board.add(this.label);

    this.resetObj = new Mesh(
      new CylinderGeometry(0.028, 0.028, 0.012, 24),
      new MeshStandardMaterial({ color: 0x2a2118, roughness: 0.5 }),
    );
    this.resetObj.name = 'Reset';
    this.resetObj.position.set(0.22, 0.016, 0.24);
    const resetEntity = this.world.createTransformEntity(this.resetObj, this.boardEntity);
    resetEntity.addComponent(OneHandGrabbable, { rotate: false, translate: false });
    resetEntity.addComponent(RayInteractable);
    resetEntity.addComponent(Piece, { square: 'reset' });

    this.paint('Loading pieces');
    void this.loadPieces();

    this.queries.held.subscribe('qualify', (entity: Entity) => {
      const square = entity.getValue(Piece, 'square');
      if (!square || square === 'reset') return;
      if (this.chess.isGameOver() || this.aiWait > 0) {
        this.world.getSystem(GrabSystem)?.forceRelease(entity);
        return;
      }
      const piece = this.chess.get(square as Square);
      if (!piece || piece.color !== this.chess.turn()) {
        this.world.getSystem(GrabSystem)?.forceRelease(entity);
        this.say('Not your piece');
        return;
      }
      this.showHints(square);
    });
    this.queries.held.subscribe('disqualify', (entity: Entity) => {
      this.pending.push(entity);
    });
    this.queries.pressed.subscribe('qualify', (entity: Entity) => {
      const square = entity.getValue(Piece, 'square');
      if (!square || square === 'reset' || !this.homes.has(entity)) return;
      if (this.chess.isGameOver() || this.aiWait > 0) return;
      const piece = this.chess.get(square as Square);
      if (!piece || piece.color !== this.chess.turn()) return;
      this.showHints(square);
    });
  }

  update(delta: number, time: number) {
    if (!this.locked) this.seekTable(time);
    this.hover();
    if (this.noteLeft > 0) {
      this.noteLeft -= delta;
      if (this.noteLeft <= 0) this.refreshStatus();
    }
    if (this.aiWait > 0) {
      this.aiWait -= delta;
      if (this.aiWait <= 0) this.playBlack();
    }
    if (this.pending.length === 0) return;
    const batch = this.pending.splice(0);
    for (const entity of batch) this.release(entity);
  }

  private hover() {
    this.hoverRing.visible = false;
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

  private seekTable(time: number) {
    const found = this.findTable(time > 1.2);
    if (found && Math.hypot(found.x - COFFEE.x, found.z - COFFEE.z) < 0.45) {
      this.seat(found.x, found.y, found.z);
      this.locked = true;
      return;
    }
    if (!this.placed) this.seat(COFFEE.x, COFFEE.y, COFFEE.z);
    if (time > 2.5) this.locked = true;
  }

  private findTable(allowPlanes: boolean): { x: number; y: number; z: number } | null {
    this.player.head.getWorldPosition(this.headPos);
    this.player.head.getWorldDirection(this.forward);
    this.forward.y = 0;
    if (this.forward.lengthSq() < 1e-4) this.forward.set(0, 0, -1);
    this.forward.normalize();

    let bestScore = -Infinity;
    let best: { x: number; y: number; z: number } | null = null;
    const consider = (x: number, y: number, z: number, foot: number) => {
      this.tmp.set(x, this.headPos.y, z);
      const dist = this.tmp.distanceTo(this.headPos);
      if (dist < 0.25 || dist > 3.2) return;
      this.tmp.sub(this.headPos).setY(0);
      if (this.tmp.lengthSq() < 1e-6) return;
      const align = this.tmp.normalize().dot(this.forward);
      if (align < 0.2) return;
      const score = align * 3 - dist + foot;
      if (score <= bestScore) return;
      bestScore = score;
      best = { x, y, z };
    };

    for (const entity of this.queries.meshes.entities) {
      if (!entity.getValue(XRMesh, 'isBounded3D')) continue;
      if (entity.getValue(XRMesh, 'semanticLabel') !== 'table') continue;
      const obj = entity.object3D;
      if (!obj) continue;
      const dims = entity.getVectorView(XRMesh, 'dimensions');
      const max = entity.getVectorView(XRMesh, 'max');
      const foot = Math.min(dims[0], dims[2]);
      const span = Math.max(dims[0], dims[2]);
      if (foot < 0.45 || span > 2.4) continue;
      obj.getWorldPosition(this.tmp);
      const top = this.tmp.y + max[1];
      if (top < 0.28 || top > 1.05) continue;
      consider(this.tmp.x, top, this.tmp.z, foot);
    }
    if (best || !allowPlanes) return best;

    for (const entity of this.queries.planes.entities) {
      const raw = entity.getValue(XRPlane, '_plane') as PlaneData | undefined;
      if (!raw || raw.orientation !== 'horizontal' || !raw.polygon?.length) continue;
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (const point of raw.polygon) {
        minX = Math.min(minX, point.x);
        maxX = Math.max(maxX, point.x);
        minZ = Math.min(minZ, point.z);
        maxZ = Math.max(maxZ, point.z);
      }
      const foot = Math.min(maxX - minX, maxZ - minZ);
      const span = Math.max(maxX - minX, maxZ - minZ);
      if (foot < 0.45 || span > 1.7) continue;
      const obj = entity.object3D;
      if (!obj) continue;
      obj.getWorldPosition(this.tmp);
      if (this.tmp.y < 0.28 || this.tmp.y > 1.05) continue;
      consider(this.tmp.x, this.tmp.y, this.tmp.z, foot);
    }
    return best;
  }

  private seat(x: number, y: number, z: number) {
    this.board.position.set(x, y + 0.002, z);
    this.player.head.getWorldPosition(this.headPos);
    const dx = this.headPos.x - x;
    const dz = this.headPos.z - z;
    this.board.rotation.y = dx * dx + dz * dz > 0.0025 ? Math.atan2(dx, dz) : 0;
    this.board.visible = true;
    this.placed = true;
    this.stepTowardCoffee(x, z);
  }

  /** Emulator spawn is the room origin. Step up to the coffee table so hands can reach. */
  private stepTowardCoffee(x: number, z: number) {
    if (this.stepped) return;
    if (Math.hypot(x, z + 1.95) > 0.45) return;
    this.player.head.getWorldPosition(this.headPos);
    if (Math.hypot(this.headPos.x, this.headPos.z) > 0.85) return;
    this.stepped = true;
    this.player.position.z -= 1.05;
    this.player.updateWorldMatrix(true, true);
    this.camera.position.set(0, 1.42, 0);
    this.camera.lookAt(0, 0.5, -1.95);
    this.player.head.getWorldPosition(this.headPos);
    const dx = this.headPos.x - x;
    const dz = this.headPos.z - z;
    if (dx * dx + dz * dz > 0.0025) this.board.rotation.y = Math.atan2(dx, dz);
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
      this.paint('Pieces failed to load');
      return;
    }
    this.layout();
  }

  private pieceMesh(type: string, color: 'w' | 'b') {
    const mesh = new Mesh(this.geos.get(type) ?? this.geos.get('p'), color === 'w' ? GOLD : RED);
    mesh.castShadow = true;
    mesh.rotation.y = restYaw(type, color);
    const foot = new Mesh(FOOT, DISC);
    foot.position.y = 0.002;
    mesh.add(foot);
    return mesh;
  }

  private paint(text: string) {
    const ctx = this.labelCanvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 512, 128);
    ctx.fillStyle = '#1b1612';
    ctx.fillRect(0, 0, 512, 128);
    ctx.fillStyle = '#f4efe6';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let size = 44;
    do {
      ctx.font = `600 ${size}px sans-serif`;
      size -= 2;
    } while (ctx.measureText(text).width > 470 && size > 18);
    ctx.fillText(text, 256, 64);
    const mat = this.label.material as MeshBasicMaterial;
    if (mat.map) mat.map.needsUpdate = true;
  }

  private say(text: string) {
    this.noteLeft = 1.3;
    this.paint(text);
  }

  private refreshStatus() {
    if (this.aiWait > 0 && !this.chess.isGameOver()) {
      this.paint('Black is thinking');
      this.placeCheckRing();
      return;
    }
    this.paint(statusLine(this.chess));
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
    for (const entity of this.homes.keys()) entity.dispose();
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

  private release(entity: Entity) {
    const square = entity.getValue(Piece, 'square');
    if (square === 'reset') {
      if (this.resetObj.parent !== this.board) this.board.attach(this.resetObj);
      this.resetObj.position.set(0.22, 0.016, 0.24);
      this.resetObj.rotation.set(0, 0, 0);
      this.chess.reset();
      this.aiWait = 0;
      this.noteLeft = 0;
      if (this.geos.size === FILES_COUNT) this.layout();
      else this.paint('Loading pieces');
      return;
    }
    const home = this.homes.get(entity);
    const obj = entity.object3D as Mesh | null;
    if (!home || !obj || !square || this.chess.isGameOver()) {
      if (home && obj && square) this.snapHome(obj, home, square);
      this.clearHints();
      return;
    }
    this.board.updateWorldMatrix(true, false);
    obj.updateWorldMatrix(true, false);
    const local = this.board.worldToLocal(this.tmp.copy(obj.getWorldPosition(this.tmp)));
    const to = squareFromLocal(local.x, local.z, S);
    const played = tryMove(this.chess, square, to);
    if (!played) {
      this.snapHome(obj, home, square);
      this.clearHints();
      if (to && to !== square) this.say('Illegal move');
      else if (this.noteLeft <= 0) this.refreshStatus();
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
    const choice = chooseMove(this.chess, 2);
    if (!choice || !tryMove(this.chess, choice.from, choice.to)) {
      this.refreshStatus();
      return;
    }
    this.layout();
  }
}

const FILES_COUNT = Object.keys(FILES).length;
