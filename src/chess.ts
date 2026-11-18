import { Chess } from 'chess.js';
import * as THREE from 'three';
import { createSystem, World } from '@iwsdk/core';

export class ChessSystem extends createSystem({}) {
  private chess = new Chess();
  private boardGroup = new THREE.Group();
  private pieces: Map<string, THREE.Object3D> = new Map();
  private squareSize = 0.06;
  private turnSprite: THREE.Sprite | null = null;

  init(world: World) {
    this.createBoard();
    this.createPieces();
    this.createTurnIndicator();
    this.boardGroup.position.set(0, 0.75, -0.6);
    world.scene.add(this.boardGroup);
  }

  private createBoard() {
    const board = new THREE.Group();
    const woodDark = new THREE.MeshStandardMaterial({ color: 0x8B5A2B, roughness: 0.7 });
    const woodLight = new THREE.MeshStandardMaterial({ color: 0xD2B48C, roughness: 0.6 });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x5C4033 });
    const frame = new THREE.Mesh(new THREE.BoxGeometry(this.squareSize * 9, 0.02, this.squareSize * 9), frameMat);
    frame.position.y = -0.01;
    board.add(frame);
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const square = new THREE.Mesh(
          new THREE.BoxGeometry(this.squareSize * 0.98, 0.008, this.squareSize * 0.98),
          (r + c) % 2 === 0 ? woodLight : woodDark
        );
        square.position.set((c - 3.5) * this.squareSize, 0, (r - 3.5) * this.squareSize);
        board.add(square);
      }
    }
    this.boardGroup.add(board);
  }

  private createPieceMesh(type: string, color: 'w' | 'b'): THREE.Group {
    const group = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: color === 'w' ? 0xE8D5B5 : 0xB22222,
      metalness: 0.3,
      roughness: 0.4,
    });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.01, 12), mat);
    group.add(base);
    let body: THREE.Mesh | null = null;
    switch (type) {
      case 'p': body = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 8), mat); body.position.y = 0.02; break;
      case 'r': body = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.035, 8), mat); body.position.y = 0.025; break;
      case 'n': body = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.04, 6), mat); body.position.y = 0.03; break;
      case 'b': body = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 8), mat); body.position.y = 0.03; break;
      case 'q': body = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.016, 0.045, 8), mat); body.position.y = 0.03; const crown = new THREE.Mesh(new THREE.SphereGeometry(0.008, 6, 6), mat); crown.position.y = 0.055; group.add(crown); break;
      case 'k': body = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.018, 0.05, 8), mat); body.position.y = 0.032; const cross = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.02, 0.004), mat); cross.position.y = 0.06; group.add(cross); break;
      default: body = new THREE.Mesh(new THREE.SphereGeometry(0.015, 8, 8), mat);
    }
    if (body) group.add(body);
    return group;
  }

  private createPieces() {
    const board = this.chess.board();
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = board[r][c];
        if (!p) continue;
        const mesh = this.createPieceMesh(p.type, p.color);
        mesh.userData = { square: this.coordsToSquare(r, c) };
        mesh.position.set((c - 3.5) * this.squareSize, 0.02, (r - 3.5) * this.squareSize);
        this.boardGroup.add(mesh);
        this.pieces.set(this.coordsToSquare(r, c), mesh);
      }
    }
  }

  private createTurnIndicator() {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 48px Arial';
    ctx.fillText("White's turn — Pinch a piece", 10, 70);
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
    this.turnSprite = new THREE.Sprite(mat);
    this.turnSprite.scale.set(0.4, 0.1, 1);
    this.turnSprite.position.set(0, 0.18, 0);
    this.boardGroup.add(this.turnSprite);
  }

  private coordsToSquare(row: number, col: number): string {
    return String.fromCharCode(97 + col) + (8 - row);
  }

  update() {}

  tryMove(from: string, to: string) {
    const move = this.chess.move({ from, to, promotion: 'q' });
    if (move) {
      this.refreshPieces();
      this.updateTurn();
    }
  }

  private refreshPieces() {
    this.pieces.forEach((obj) => this.boardGroup.remove(obj));
    this.pieces.clear();
    this.createPieces();
  }

  private updateTurn() {
    if (!this.turnSprite) return;
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 42px Arial';
    const text = this.chess.turn() === 'w' ? "White's turn" : "Black's turn — Nice move!";
    ctx.fillText(text, 10, 70);
    const tex = new THREE.CanvasTexture(canvas);
    (this.turnSprite.material as THREE.SpriteMaterial).map = tex;
    (this.turnSprite.material as THREE.SpriteMaterial).needsUpdate = true;
  }
}
