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
  RepeatWrapping,
  Vector2,
} from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { Piece } from './piece.js';

const S = 0.06;
const PIECE_SCALE = 0.00092;

const GOLD = new MeshStandardMaterial({
  color: 0xe4d3a1,
  metalness: 0.88,
  roughness: 0.22,
});
const RED = new MeshStandardMaterial({
  color: 0xc41722,
  metalness: 0.42,
  roughness: 0.28,
});

const FILES: Record<string, string> = {
  p: 'Pawn.stl',
  r: 'Rook.stl',
  n: 'Knight.stl',
  b: 'Bishop.stl',
  q: 'Queen.stl',
  k: 'King.stl',
};

function woodTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new CanvasTexture(canvas);
  ctx.fillStyle = '#a56a32';
  ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 90; i += 1) {
    ctx.strokeStyle = i % 2 === 0 ? 'rgba(92,48,18,0.35)' : 'rgba(232,196,140,0.18)';
    ctx.lineWidth = 1 + (i % 4);
    ctx.beginPath();
    const y = (i * 37) % 512;
    ctx.moveTo(0, y);
    ctx.bezierCurveTo(140, y + 18, 280, y - 14, 512, y + 6);
    ctx.stroke();
  }
  const texture = new CanvasTexture(canvas);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(2, 2);
  return texture;
}

function squareAt(col: number, row: number) {
  return new Vector3((col - 3.5) * S, 0.045, (row - 3.5) * S);
}

export class ChessSystem extends createSystem({
  held: { required: [Piece, Grabbed] },
  looked: { required: [Piece, Hovered] },
  pressed: { required: [Piece, Pressed] },
  planes: { required: [XRPlane] },
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
  private geos = new Map<string, BufferGeometry>();
  private started = false;
  private ready = false;
  private placed = false;
  private anchored = false;
  private selected: Square | null = null;
  private tmp = new Vector3();
  private leftHand = new Vector3();
  private rightHand = new Vector3();
  private headPos = new Vector3();

  init() {
    this.board = new Group();
    this.board.name = 'Chess Board';
    this.board.position.set(0, 0.72, -0.4);
    this.board.visible = false;
    this.boardEntity = this.world.createTransformEntity(this.board);

    const wood = new MeshStandardMaterial({
      map: woodTexture(),
      color: 0xc48a45,
      roughness: 0.62,
      metalness: 0.04,
    });
    const table = new Mesh(new BoxGeometry(1.28, 0.07, 1.28), wood);
    table.position.y = -0.02;
    table.receiveShadow = true;
    table.castShadow = true;
    this.board.add(table);

    const frame = new Mesh(
      new BoxGeometry(S * 10.4, 0.028, S * 10.4),
      new MeshStandardMaterial({ color: 0xefe6d4, roughness: 0.45 }),
    );
    frame.position.y = 0.028;
    frame.receiveShadow = true;
    this.board.add(frame);

    const lightMat = new MeshStandardMaterial({ color: 0xf4efe4, roughness: 0.55 });
    const darkMat = new MeshStandardMaterial({ color: 0xc49255, roughness: 0.62 });
    for (let row = 0; row < 8; row += 1) {
      for (let col = 0; col < 8; col += 1) {
        const sq = new Mesh(
          new BoxGeometry(S * 0.98, 0.01, S * 0.98),
          (row + col) % 2 === 0 ? lightMat : darkMat,
        );
        sq.position.copy(squareAt(col, row));
        sq.receiveShadow = true;
        this.board.add(sq);
      }
    }
    this.addCoordinates();

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
    this.labelCanvas.width = 1280;
    this.labelCanvas.height = 160;
    this.label = new Mesh(
      new BoxGeometry(0.9, 0.11, 0.004),
      new MeshBasicMaterial({ map: new CanvasTexture(this.labelCanvas) }),
    );
    this.label.position.set(0, 0.12, S * 6.3);
    this.label.rotation.x = -0.6;
    this.board.add(this.label);

    const reset = new Mesh(
      new CylinderGeometry(0.045, 0.045, 0.02, 24),
      new MeshStandardMaterial({ color: 0x2a2118, roughness: 0.5 }),
    );
    reset.name = 'Reset';
    reset.position.set(-0.5, 0.04, S * 6.1);
    const resetEntity = this.world.createTransformEntity(reset, this.boardEntity);
    resetEntity.addComponent(OneHandGrabbable, { rotate: false, translate: false });
    resetEntity.addComponent(RayInteractable);
    resetEntity.addComponent(Piece, { square: 'reset' });

    this.paint('Loading the pieces.');
    this.board.visible = true;
    void this.loadPieces();

    this.queries.held.subscribe('qualify', (entity: Entity) => {
      const square = entity.getValue(Piece, 'square');
      if (!square || square === 'reset') return;
      const piece = this.chess.get(square as Square);
      if (!piece || piece.color !== this.chess.turn()) {
        this.world.getSystem(GrabSystem)?.forceRelease(entity);
        this.status(' Not your piece.');
        return;
      }
      this.selected = square as Square;
      this.showHints(square);
    });
    this.queries.held.subscribe('disqualify', (entity: Entity) => {
      this.pending.push(entity);
    });
    this.queries.pressed.subscribe('qualify', (entity: Entity) => {
      const square = entity.getValue(Piece, 'square');
      if (!square || square === 'reset' || this.homes.has(entity) === false) return;
      const piece = this.chess.get(square as Square);
      if (!piece || piece.color !== this.chess.turn()) return;
      this.selected = square as Square;
      this.showHints(square);
      this.status(' Look at a green square and pinch.');
    });
  }

  update() {
    if (this.ready && !this.placed) this.placeInFront();
    if (!this.anchored) this.tryTable();
    this.hoverRing.visible = false;
    for (const entity of this.queries.looked.entities) {
      const obj = entity.object3D;
      if (!obj) continue;
      obj.getWorldPosition(this.tmp);
      this.hoverRing.position.copy(this.board.worldToLocal(this.tmp));
      this.hoverRing.position.y = 0.058;
      this.hoverRing.visible = true;
      break;
    }
    if (this.pending.length === 0) return;
    const batch = this.pending.splice(0);
    for (const entity of batch) this.release(entity);
  }

  private async loadPieces() {
    const loader = new STLLoader();
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
    this.ready = true;
    this.layout();
    this.paint("It's White's turn. Pinch a gold piece, drop it on green.");
  }

  private placeInFront() {
    this.player.head.getWorldPosition(this.headPos);
    if (this.headPos.lengthSq() < 0.01) return;
    const dir = new Vector3();
    this.player.head.getWorldDirection(dir);
    dir.y = 0;
    if (dir.lengthSq() < 0.001) dir.set(0, 0, -1);
    dir.normalize();
    this.board.position.copy(this.headPos).addScaledVector(dir, 0.62);
    this.board.position.y = Math.max(0.42, this.headPos.y - 0.62);
    this.board.rotation.y = Math.atan2(dir.x, dir.z);
    this.placed = true;
    this.started = true;
  }

  private tryTable() {
    this.player.head.getWorldPosition(this.headPos);
    const dir = new Vector3();
    this.player.head.getWorldDirection(dir);
    dir.y = 0;
    let bestY = -1;
    let best: Vector3 | null = null;
    for (const entity of this.queries.planes.entities) {
      const obj = entity.object3D;
      if (!obj) continue;
      obj.getWorldPosition(this.tmp);
      if (this.tmp.y < 0.35 || this.tmp.y > 0.9) continue;
      const toward = this.tmp.clone().sub(this.headPos);
      toward.y = 0;
      if (dir.lengthSq() > 0.001 && toward.dot(dir) < 0.2) continue;
      if (this.tmp.y > bestY) {
        bestY = this.tmp.y;
        best = this.tmp.clone();
      }
    }
    if (!best) return;
    this.board.position.set(best.x, best.y, best.z);
    const flat = new Vector2(this.headPos.x - best.x, this.headPos.z - best.z);
    if (flat.lengthSq() > 0.01) this.board.rotation.y = Math.atan2(flat.x, flat.y);
    this.anchored = true;
    this.placed = true;
    this.started = true;
  }

  private watchHands() {
    this.player.indexTipSpaces.left.getWorldPosition(this.leftHand);
    this.player.indexTipSpaces.right.getWorldPosition(this.rightHand);
    this.player.head.getWorldPosition(this.headPos);
    const apart = this.leftHand.distanceTo(this.rightHand);
    const sameHeight = Math.abs(this.leftHand.y - this.rightHand.y) < 0.05;
    const below = this.leftHand.y < this.headPos.y - 0.28 && this.rightHand.y < this.headPos.y - 0.28;
    if (!sameHeight || !below || apart < 0.08 || apart > 0.55) return;
    this.board.position.set(
      (this.leftHand.x + this.rightHand.x) / 2,
      Math.min(this.leftHand.y, this.rightHand.y) - 0.05,
      (this.leftHand.z + this.rightHand.z) / 2,
    );
    const flat = new Vector2(this.headPos.x - this.board.position.x, this.headPos.z - this.board.position.z);
    this.board.rotation.y = Math.atan2(flat.x, flat.y);
    this.started = true;
    this.layout();
  }

  private pieceMesh(type: string, color: 'w' | 'b') {
    const geometry = this.geos.get(type) ?? this.geos.get('p');
    const mesh = new Mesh(geometry, color === 'w' ? GOLD : RED);
    mesh.castShadow = true;
    if (type === 'n') mesh.rotation.y = color === 'w' ? Math.PI / 2 : -Math.PI / 2;
    if (color === 'b' && type !== 'n') mesh.rotation.y = Math.PI;
    return mesh;
  }

  private addCoordinates() {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 1024;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 1024, 1024);
    ctx.fillStyle = '#1a120c';
    ctx.font = '700 64px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const files = 'ABCDEFGH';
    for (let i = 0; i < 8; i += 1) {
      const x = 160 + i * 96;
      ctx.fillText(files[i], x, 70);
      ctx.fillText(files[i], x, 954);
      ctx.fillText(String(i + 1), 70, 900 - i * 96);
      ctx.fillText(String(i + 1), 954, 900 - i * 96);
    }
    const plane = new Mesh(
      new BoxGeometry(S * 10.2, 0.002, S * 10.2),
      new MeshBasicMaterial({ map: new CanvasTexture(canvas), transparent: true }),
    );
    plane.position.y = 0.044;
    this.board.add(plane);
  }

  private paint(text: string) {
    const ctx = this.labelCanvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 1280, 160);
    ctx.fillStyle = '#14110e';
    ctx.fillRect(0, 0, 1280, 160);
    ctx.fillStyle = '#f7f4ee';
    ctx.font = '600 40px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 640, 80);
    const mat = this.label.material as MeshBasicMaterial;
    if (mat.map) mat.map.needsUpdate = true;
  }

  private status(extra = '') {
    if (this.chess.isCheckmate()) {
      const winner = this.chess.turn() === 'w' ? 'Black' : 'White';
      this.paint(`${winner} wins. Pinch RESET for a new game.`);
      return;
    }
    if (this.chess.isDraw()) {
      this.paint('Draw. Pinch RESET for a new game.');
      return;
    }
    const who = this.chess.turn() === 'w' ? 'White' : 'Black';
    const check = this.chess.inCheck() ? ' Check.' : '';
    this.paint(`It's ${who}'s turn.${check} Pinch a piece, drop it on green.${extra}`);
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
          this.checkRing.position.y = 0.055;
          this.checkRing.visible = true;
        }
      }
    }
  }

  private clearHints() {
    while (this.hints.children.length) this.hints.remove(this.hints.children[0]);
  }

  private showHints(from: string) {
    this.clearHints();
    const mat = new MeshBasicMaterial({ color: 0x39e07a, transparent: true, opacity: 0.85 });
    for (const move of this.chess.moves({ square: from as Square, verbose: true })) {
      const col = move.to.charCodeAt(0) - 97;
      const row = 8 - Number(move.to[1]);
      const dot = new Mesh(
        new CylinderGeometry(move.captured ? S * 0.28 : S * 0.16, move.captured ? S * 0.28 : S * 0.16, 0.006, 20),
        mat,
      );
      dot.position.copy(squareAt(col, row));
      dot.position.y = 0.056;
      this.hints.add(dot);
    }
  }

  private layout() {
    for (const entity of this.homes.keys()) entity.dispose();
    this.homes.clear();
    this.pending.length = 0;
    this.clearHints();
    this.selected = null;
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
    this.status();
  }

  private release(entity: Entity) {
    const square = entity.getValue(Piece, 'square');
    if (square === 'reset') {
      const obj = entity.object3D;
      if (obj) {
        obj.position.set(-0.5, 0.04, S * 6.1);
        obj.quaternion.identity();
      }
      this.chess.reset();
      this.layout();
      return;
    }
    const home = this.homes.get(entity);
    const obj = entity.object3D;
    if (!home || !obj || !square) return;
    this.board.updateWorldMatrix(true, false);
    obj.updateWorldMatrix(true, false);
    const local = this.board.worldToLocal(this.tmp.copy(obj.getWorldPosition(this.tmp)));
    const col = Math.round(local.x / S + 3.5);
    const row = Math.round(local.z / S + 3.5);
    const to = col >= 0 && col < 8 && row >= 0 && row < 8
      ? String.fromCharCode(97 + col) + (8 - row)
      : '';
    const move = to ? this.chess.move({ from: square as Square, to: to as Square, promotion: 'q' }) : null;
    if (!move) {
      obj.position.copy(home);
      obj.quaternion.identity();
      this.clearHints();
      this.status(' Illegal drop.');
      return;
    }
    this.layout();
    this.status(move.captured ? ' Captured.' : '');
  }
}
