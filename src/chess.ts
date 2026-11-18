import {
  createSystem,
  Entity,
  Grabbed,
  GrabSystem,
  OneHandGrabbable,
  Vector3,
} from '@iwsdk/core';
import { Chess, type Square } from 'chess.js';
import {
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  RepeatWrapping,
  SphereGeometry,
  Vector2,
} from 'three';
import { Piece } from './piece.js';

const S = 0.06;

const GOLD = new MeshStandardMaterial({
  color: 0xe7d7b4,
  metalness: 0.82,
  roughness: 0.22,
});
const RED = new MeshStandardMaterial({
  color: 0xc41722,
  metalness: 0.28,
  roughness: 0.32,
});

function lathe(pts: number[][], mat: MeshStandardMaterial) {
  const mesh = new Mesh(
    new LatheGeometry(pts.map(([x, y]) => new Vector2(x, y)), 20),
    mat,
  );
  mesh.castShadow = true;
  return mesh;
}

const PROFILES: Record<string, number[][]> = {
  p: [[0.018, 0], [0.02, 0.008], [0.012, 0.02], [0.013, 0.04], [0.008, 0.05], [0.014, 0.06], [0.01, 0.066], [0, 0.066]],
  r: [[0.02, 0], [0.022, 0.01], [0.014, 0.02], [0.015, 0.055], [0.02, 0.066], [0.014, 0.07], [0.02, 0.078], [0, 0.078]],
  b: [[0.02, 0], [0.022, 0.01], [0.01, 0.03], [0.014, 0.062], [0.008, 0.078], [0.012, 0.088], [0.006, 0.096], [0, 0.096]],
  q: [[0.022, 0], [0.024, 0.01], [0.012, 0.03], [0.015, 0.078], [0.02, 0.092], [0.008, 0.104], [0.012, 0.112], [0, 0.112]],
  k: [[0.022, 0], [0.024, 0.01], [0.012, 0.032], [0.016, 0.086], [0.02, 0.1], [0.008, 0.112], [0.004, 0.128], [0, 0.128]],
};

function knight(mat: MeshStandardMaterial) {
  const group = new Group();
  group.add(lathe([[0.02, 0], [0.022, 0.01], [0.014, 0.018], [0.012, 0.03], [0, 0.03]], mat));
  const neck = new Mesh(new CylinderGeometry(0.012, 0.016, 0.05, 10), mat);
  neck.position.set(0, 0.05, 0.004);
  neck.rotation.x = -0.5;
  neck.castShadow = true;
  group.add(neck);
  const head = new Mesh(new SphereGeometry(0.016, 12, 10), mat);
  head.scale.set(1.1, 0.8, 1.5);
  head.position.set(0, 0.072, 0.02);
  head.castShadow = true;
  group.add(head);
  const muzzle = new Mesh(new SphereGeometry(0.009, 10, 8), mat);
  muzzle.position.set(0, 0.066, 0.034);
  group.add(muzzle);
  const ear = new Mesh(new CylinderGeometry(0, 0.004, 0.016, 6), mat);
  ear.position.set(0.006, 0.086, 0.012);
  group.add(ear);
  return group;
}

function pieceObject(type: string, color: 'w' | 'b') {
  const mat = color === 'w' ? GOLD : RED;
  if (type === 'n') {
    const horse = knight(mat);
    if (color === 'b') horse.rotation.y = Math.PI;
    return horse;
  }
  const group = new Group();
  group.add(lathe(PROFILES[type] ?? PROFILES.p, mat));
  if (type === 'k') {
    const bar = new Mesh(new BoxGeometry(0.016, 0.004, 0.004), mat);
    bar.position.y = 0.122;
    group.add(bar);
  }
  if (type === 'q') {
    const crown = new Mesh(new SphereGeometry(0.006, 8, 8), mat);
    crown.position.y = 0.108;
    group.add(crown);
  }
  return group;
}

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
  private tmp = new Vector3();

  init() {
    this.board = new Group();
    this.board.name = 'Chess Board';
    this.board.position.set(0, 0.74, -0.72);
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

    this.labelCanvas = document.createElement('canvas');
    this.labelCanvas.width = 1280;
    this.labelCanvas.height = 160;
    this.label = new Mesh(
      new BoxGeometry(0.72, 0.09, 0.004),
      new MeshBasicMaterial({ map: new CanvasTexture(this.labelCanvas) }),
    );
    this.label.position.set(0, 0.08, S * 6.3);
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
    resetEntity.addComponent(Piece, { square: 'reset' });

    this.layout();
    this.queries.held.subscribe('qualify', (entity: Entity) => {
      const square = entity.getValue(Piece, 'square');
      if (square === 'reset') return;
      const home = square ? this.homes.get(entity) : undefined;
      const piece = square ? this.chess.get(square as Square) : null;
      if (!home || !piece || piece.color !== this.chess.turn()) {
        this.world.getSystem(GrabSystem)?.forceRelease(entity);
        this.status(' Not your piece.');
        return;
      }
      this.showHints(square as string);
    });
    this.queries.held.subscribe('disqualify', (entity: Entity) => {
      this.pending.push(entity);
    });
  }

  update() {
    if (this.pending.length === 0) return;
    const batch = this.pending.splice(0);
    for (const entity of batch) this.release(entity);
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
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.fillRect(0, 0, 1280, 160);
    ctx.fillStyle = '#f7f4ee';
    ctx.font = '600 42px sans-serif';
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
    const king = this.chess.board().flat().find((piece) => piece?.type === 'k' && piece.color === this.chess.turn());
    if (!king) return;
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
      const dot = new Mesh(new CylinderGeometry(move.captured ? S * 0.28 : S * 0.16, move.captured ? S * 0.28 : S * 0.16, 0.006, 20), mat);
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
    const rows = this.chess.board();
    for (let row = 0; row < 8; row += 1) {
      for (let col = 0; col < 8; col += 1) {
        const piece = rows[row][col];
        if (!piece) continue;
        const id = String.fromCharCode(97 + col) + (8 - row);
        const mesh = pieceObject(piece.type, piece.color);
        mesh.name = `Piece ${id}`;
        const entity = this.world.createTransformEntity(mesh, this.boardEntity);
        const home = squareAt(col, row);
        mesh.position.copy(home);
        entity.addComponent(OneHandGrabbable, { rotate: false });
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
