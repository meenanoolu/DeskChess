import { Chess } from 'chess.js';
import * as THREE from 'three';
import { createSystem, World } from '@iwsdk/core';

export class ChessSystem extends createSystem({}) {
  private chess = new Chess();
  private boardGroup = new THREE.Group();
  private pieces: Map<string, THREE.Object3D> = new Map();
  private squareSize = 0.06;
  private turnSprite: THREE.Sprite | null = null;
  private selectedPiece: THREE.Object3D | null = null;
  private selectedFrom: string | null = null;
  private boardPlaced = false;

  init(world: World) {
    this.createBoard();
    this.createPieces();
    this.createTurnIndicator();
    this.boardGroup.position.set(0, 0.75, -0.6);
    this.boardGroup.visible = false;
    world.scene.add(this.boardGroup);
    this.updateTurnText("Pinch on your desk to place the board");
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
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 36px Arial';
    ctx.fillText("Pinch desk to place", 10, 70);
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
    this.turnSprite = new THREE.Sprite(mat);
    this.turnSprite.scale.set(0.45, 0.11, 1);
    this.turnSprite.position.set(0, 0.2, 0);
    this.boardGroup.add(this.turnSprite);
  }

  private coordsToSquare(row: number, col: number): string {
    return String.fromCharCode(97 + col) + (8 - row);
  }

  private squareToLocal(sq: string): THREE.Vector3 {
    const col = sq.charCodeAt(0) - 97;
    const row = 8 - parseInt(sq[1]);
    return new THREE.Vector3((col - 3.5) * this.squareSize, 0.02, (row - 3.5) * this.squareSize);
  }

  private worldToNearestSquare(worldPos: THREE.Vector3): string | null {
    const local = this.boardGroup.worldToLocal(worldPos.clone());
    const c = Math.round(local.x / this.squareSize + 3.5);
    const r = Math.round(local.z / this.squareSize + 3.5);
    if (c < 0 || c > 7 || r < 0 || r > 7) return null;
    return this.coordsToSquare(r, c);
  }

  private updateTurnText(msg: string) {
    if (!this.turnSprite) return;
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 36px Arial';
    ctx.fillText(msg, 10, 70);
    const tex = new THREE.CanvasTexture(canvas);
    (this.turnSprite.material as THREE.SpriteMaterial).map = tex;
    (this.turnSprite.material as THREE.SpriteMaterial).needsUpdate = true;
  }

  update(world: World) {
    const hands = (world as any).input?.xr?.hands;
    if (!hands) return;

    if (!this.boardPlaced) {
      for (const hand of [hands.left, hands.right]) {
        if (hand?.pinch?.pressed) {
          this.boardGroup.visible = true;
          this.boardPlaced = true;
          this.updateTurnText("White's turn — Pinch a piece");
          break;
        }
      }
      return;
    }

    for (const hand of [hands.left, hands.right]) {
      if (!hand) continue;
      const pinching = hand.pinch?.pressed;
      const pos = hand.pinch?.position || hand.grip?.position;
      if (!pos) continue;

      if (pinching && !this.selectedPiece) {
        let closest: THREE.Object3D | null = null;
        let minDist = 0.08;
        this.pieces.forEach((piece) => {
          const d = piece.getWorldPosition(new THREE.Vector3()).distanceTo(pos);
          if (d < minDist) {
            minDist = d;
            closest = piece;
          }
        });
        if (closest) {
          this.selectedPiece = closest;
          this.selectedFrom = closest.userData.square;
        }
      }

      if (this.selectedPiece && pinching) {
        const local = this.boardGroup.worldToLocal(pos.clone());
        this.selectedPiece.position.set(local.x, 0.04, local.z);
      }

      if (this.selectedPiece && !pinching && this.selectedFrom) {
        const targetSq = this.worldToNearestSquare(pos);
        if (targetSq && targetSq !== this.selectedFrom) {
          this.tryMove(this.selectedFrom, targetSq);
        } else {
          const back = this.squareToLocal(this.selectedFrom);
          this.selectedPiece.position.copy(back);
        }
        this.selectedPiece = null;
        this.selectedFrom = null;
      }
    }
  }

  tryMove(from: string, to: string) {
    const move = this.chess.move({ from, to, promotion: 'q' });
    if (move) {
      this.refreshPieces();
      const reaction = this.chess.turn() === 'w' ? "White's turn" : "Black's turn — Nice move!";
      this.updateTurnText(reaction);
    }
  }

  private refreshPieces() {
    this.pieces.forEach((obj) => this.boardGroup.remove(obj));
    this.pieces.clear();
    this.createPieces();
  }
}
