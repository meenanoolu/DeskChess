import { Chess, type Move, type Square } from 'chess.js';

const VALUE: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

export function restYaw(type: string, color: 'w' | 'b') {
  if (type === 'n') return color === 'w' ? Math.PI / 2 : -Math.PI / 2;
  if (color === 'b') return Math.PI;
  return 0;
}

/** Local board point to a square. Rank 1 is +z, file a is -x. */
export function squareFromLocal(x: number, z: number, squareSize: number) {
  const col = Math.round(x / squareSize + 3.5);
  const row = Math.round(z / squareSize + 3.5);
  if (col < 0 || col > 7 || row < 0 || row > 7) return '';
  return String.fromCharCode(97 + col) + (8 - row);
}

export function tryMove(chess: Chess, from: string, to: string) {
  if (!to || to === from) return null;
  try {
    return chess.move({ from: from as Square, to: to as Square, promotion: 'q' });
  } catch {
    return null;
  }
}

export function statusLine(chess: Chess) {
  if (chess.isCheckmate()) return chess.turn() === 'w' ? 'Black wins \u2014 reset' : 'White wins \u2014 reset';
  if (chess.isDraw()) return 'Draw \u2014 reset';
  if (chess.inCheck()) return chess.turn() === 'w' ? 'White is in check' : 'Black is in check';
  return chess.turn() === 'w' ? 'White to move' : 'Black to move';
}

export function evaluate(chess: Chess) {
  if (chess.isCheckmate()) return chess.turn() === 'w' ? -100000 : 100000;
  if (chess.isDraw()) return 0;
  let score = 0;
  const rows = chess.board();
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const piece = rows[row][col];
      if (!piece) continue;
      const sign = piece.color === 'w' ? 1 : -1;
      const center = 3.5 - Math.abs(col - 3.5) + (3.5 - Math.abs(row - 3.5));
      const fileCenter = 3.5 - Math.abs(col - 3.5);
      let extra = fileCenter * (piece.type === 'p' ? 10 : 3);
      if (piece.type === 'n' || piece.type === 'b') {
        const home = piece.color === 'w' ? 7 : 0;
        if (row !== home) extra += 16;
      }
      if (piece.type === 'p') {
        const travel = piece.color === 'w' ? 6 - row : row - 1;
        if ((col === 0 || col === 7) && travel > 1) extra -= 24;
        if (col >= 2 && col <= 5 && travel > 0) extra += 12;
      }
      score += sign * (VALUE[piece.type] + center * (piece.type === 'p' ? 4 : 2) + extra);
    }
  }
  if (chess.inCheck()) score += chess.turn() === 'w' ? -30 : 30;
  return score;
}

function sideScore(chess: Chess) {
  const score = evaluate(chess);
  return chess.turn() === 'w' ? score : -score;
}

function negamax(chess: Chess, depth: number, alpha: number, beta: number): number {
  if (depth === 0 || chess.isGameOver()) return sideScore(chess);
  let best = -Infinity;
  for (const move of chess.moves({ verbose: true })) {
    chess.move({ from: move.from, to: move.to, promotion: move.promotion ?? 'q' });
    const score = -negamax(chess, depth - 1, -beta, -alpha);
    chess.undo();
    if (score > best) best = score;
    if (score > alpha) alpha = score;
    if (alpha >= beta) break;
  }
  return best;
}

/** Best move for the side to move. Does not change the position. */
export function chooseMove(chess: Chess, depth = 2): Move | null {
  const moves = chess.moves({ verbose: true });
  if (moves.length === 0) return null;
  const ordered = [...moves].sort((a, b) => Number(!!b.captured) - Number(!!a.captured));
  let best = ordered[0];
  let bestScore = -Infinity;
  for (const move of ordered) {
    chess.move({ from: move.from, to: move.to, promotion: move.promotion ?? 'q' });
    const score = -negamax(chess, depth - 1, -Infinity, Infinity);
    chess.undo();
    if (score > bestScore) {
      bestScore = score;
      best = move;
    }
  }
  return best;
}
