import {
  createSystem,
  Entity,
  Grabbed,
  OneHandGrabbable,
  Vector3,
} from '@iwsdk/core';
import { Chess } from 'chess.js';
import {
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SphereGeometry,
  Vector2,
} from 'three';
import { Piece } from './piece.js';

const S = 0.052;

function lathe(pts: number[][], mat: MeshStandardMaterial) {
  const mesh = new Mesh(
    new LatheGeometry(pts.map(([x, y]) => new Vector2(x, y)), 16),
    mat,
  );
  mesh.castShadow = true;
  return mesh;
}

const PROFILES: Record<string, number[][]> = {
  p: [[0.016, 0], [0.018, 0.008], [0.011, 0.02], [0.012, 0.034], [0.007, 0.044], [0.011, 0.052], [0, 0.052]],
  r: [[0.018, 0], [0.02, 0.01], [0.013, 0.018], [0.014, 0.046], [0.018, 0.054], [0.018, 0.062], [0, 0.062]],
  n: [[0.018, 0], [0.02, 0.01], [0.011, 0.02], [0.009, 0.046], [0.013, 0.058], [0, 0.058]],
  b: [[0.018, 0], [0.02, 0.01], [0.009, 0.026], [0.011, 0.05], [0.006, 0.064], [0.009, 0.072], [0, 0.072]],
  q: [[0.02, 0], [0.022, 0.01], [0.01, 0.028], [0.013, 0.064], [0.016, 0.076], [0.007, 0.086], [0, 0.086]],
  k: [[0.02, 0], [0.022, 0.01], [0.01, 0.028], [0.013, 0.07], [0.016, 0.082], [0.006, 0.094], [0, 0.094]],
};

function pieceObject(type: string, color: 'w' | 'b') {
  const mat = new MeshStandardMaterial({
    color: color === 'w' ? 0xf4efe4 : 0xc4212a,
    metalness: color === 'w' ? 0.45 : 0.2,
    roughness: 0.35,
  });
  const group = new Group();
  group.add(lathe(PROFILES[type] ?? PROFILES.p, mat));
  if (type === 'n') {
    const head = new Mesh(new SphereGeometry(0.011, 10, 10), mat);
    head.position.set(0.008, 0.054, 0.006);
    group.add(head);
  }
  return group;
}

function squareAt(col: number, row: number) {
  return new Vector3((col - 3.5) * S, 0.02, (row - 3.5) * S);
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
  private tmp = new Vector3();

  init() {
    this.board = new Group();
    this.board.name = 'Chess Board';
    this.board.position.set(0, 0.78, -0.62);
    this.boardEntity = this.world.createTransformEntity(this.board);

    const desk = new Mesh(
      new CylinderGeometry(0.55, 0.55, 0.04, 40),
      new MeshStandardMaterial({ color: 0x6a4328, roughness: 0.7 }),
    );
    desk.position.y = -0.03;
    desk.receiveShadow = true;
    this.board.add(desk);

    const frame = new Mesh(
      new BoxGeometry(S * 10, 0.02, S * 10),
      new MeshStandardMaterial({ color: 0x3b2616, roughness: 0.65 }),
    );
    frame.receiveShadow = true;
    this.board.add(frame);

    const lightMat = new MeshStandardMaterial({ color: 0xf0ddc0, roughness: 0.5 });
    const darkMat = new MeshStandardMaterial({ color: 0x8d5a32, roughness: 0.62 });
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const sq = new Mesh(
          new BoxGeometry(S * 0.96, 0.008, S * 0.96),
          (row + col) % 2 === 0 ? lightMat : darkMat,
        );
        sq.position.copy(squareAt(col, row));
        sq.position.y = 0.012;
        sq.receiveShadow = true;
        this.board.add(sq);
      }
    }

    this.hints = new Group();
    this.board.add(this.hints);

    this.labelCanvas = document.createElement('canvas');
    this.labelCanvas.width = 1024;
    this.labelCanvas.height = 128;
    this.label = new Mesh(
      new BoxGeometry(0.46, 0.07, 0.002),
      new MeshBasicMaterial({ map: new CanvasTexture(this.labelCanvas) }),
    );
    this.label.position.set(0, 0.16, -S * 5.2);
    this.board.add(this.label);

    this.layout();
    this.queries.held.subscribe('qualify', (entity: Entity) => {
      const square = entity.getValue(Piece, 'square');
      if (this.homes.has(entity) && square) this.showHints(square);
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

  private paint(text: string) {
    const ctx = this.labelCanvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 1024, 128);
    ctx.fillStyle = '#1a120c';
    ctx.fillRect(0, 0, 1024, 128);
    ctx.fillStyle = '#f4efe4';
    ctx.font = '600 36px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 512, 64);
    const mat = this.label.material as MeshBasicMaterial;
    if (mat.map) mat.map.needsUpdate = true;
  }

  private status(extra = '') {
    if (this.chess.isCheckmate()) {
      const winner = this.chess.turn() === 'w' ? 'Black' : 'White';
      this.paint(`${winner} wins by checkmate.${extra}`);
      return;
    }
    if (this.chess.isDraw()) {
      this.paint(`Draw.${extra}`);
      return;
    }
    const who = this.chess.turn() === 'w' ? 'White' : 'Black';
    const check = this.chess.inCheck() ? ' Check.' : '';
    this.paint(`${who} to move.${check} Pinch a piece onto a green square.${extra}`);
  }

  private clearHints() {
    while (this.hints.children.length) this.hints.remove(this.hints.children[0]);
  }

  private showHints(from: string) {
    this.clearHints();
    const mat = new MeshBasicMaterial({ color: 0x39e07a });
    for (const move of this.chess.moves({ square: from as 'a2', verbose: true })) {
      const col = move.to.charCodeAt(0) - 97;
      const row = 8 - Number(move.to[1]);
      const dot = new Mesh(new SphereGeometry(move.captured ? 0.012 : 0.008, 10, 10), mat);
      dot.position.copy(squareAt(col, row));
      dot.position.y = 0.03;
      this.hints.add(dot);
    }
  }

  private layout() {
    for (const entity of this.homes.keys()) entity.dispose();
    this.homes.clear();
    this.pending.length = 0;
    this.clearHints();
    const rows = this.chess.board();
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
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
    const home = this.homes.get(entity);
    const obj = entity.object3D;
    if (!home || !obj || !this.homes.has(entity)) return;
    const from = entity.getValue(Piece, 'square');
    if (!from) return;
    this.board.updateWorldMatrix(true, false);
    obj.updateWorldMatrix(true, false);
    const local = this.board.worldToLocal(this.tmp.copy(obj.getWorldPosition(this.tmp)));
    const col = Math.round(local.x / S + 3.5);
    const row = Math.round(local.z / S + 3.5);
    const to = col >= 0 && col < 8 && row >= 0 && row < 8
      ? String.fromCharCode(97 + col) + (8 - row)
      : '';
    const occupant = to ? this.chess.get(to as 'a2') : null;
    if (to && occupant && occupant.color === this.chess.turn() && to !== from) {
      obj.position.copy(home);
      obj.quaternion.identity();
      this.showHints(to);
      this.status(` Holding ${to}.`);
      return;
    }
    const move = to ? this.chess.move({ from: from as 'a2', to: to as 'a2', promotion: 'q' }) : null;
    if (!move) {
      obj.position.copy(home);
      obj.quaternion.identity();
      this.status(' Illegal drop.');
      return;
    }
    this.layout();
    this.status(move.captured ? ' Captured.' : '');
  }
}
