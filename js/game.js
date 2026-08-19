export class ChessGame {
  constructor() {
    this.board = [];
    this.turn = 'w';
    this.moveHistory = [];
    this.stateHistory = [];
    this.reset();
  }

  reset() {
    this.board = this.getInitialBoard();
    this.turn = 'w';
    this.moveHistory = [];
    this.stateHistory = [];
  }

  getInitialBoard() {
    const board = Array(8).fill(null).map(() => Array(8).fill(null));
    
    // Set up back ranks
    const backRank = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
    for (let col = 0; col < 8; col++) {
      board[0][col] = { type: backRank[col], color: 'b' };
      board[7][col] = { type: backRank[col], color: 'w' };
    }
    
    // Set up pawns
    for (let col = 0; col < 8; col++) {
      board[1][col] = { type: 'p', color: 'b' };
      board[6][col] = { type: 'p', color: 'w' };
    }
    
    return board;
  }

  parseSquare(sq) {
    if (!sq || sq.length < 2) return null;
    const file = sq.charCodeAt(0) - 97; // 'a' is 97
    const rank = parseInt(sq.charAt(1), 10);
    const row = 8 - rank;
    const col = file;
    return { row, col };
  }

  getSquareName(row, col) {
    if (row < 0 || row > 7 || col < 0 || col > 7) return '';
    const file = String.fromCharCode(97 + col);
    const rank = 8 - row;
    return `${file}${rank}`;
  }

  getPieceAt(row, col) {
    if (row < 0 || row > 7 || col < 0 || col > 7) return null;
    return this.board[row][col];
  }

  setPieceAt(row, col, piece) {
    if (row >= 0 && row < 8 && col >= 0 && col < 8) {
      this.board[row][col] = piece;
    }
  }

  makeMove(fromStr, toStr) {
    const from = this.parseSquare(fromStr);
    const to = this.parseSquare(toStr);
    if (!from || !to) return null;

    const piece = this.getPieceAt(from.row, from.col);
    if (!piece) return null;

    // Snapshot state for undo
    this.stateHistory.push({
      board: this.board.map(row => row.map(p => p ? { ...p } : null)),
      turn: this.turn
    });

    const targetPiece = this.getPieceAt(to.row, to.col);
    const isCapture = targetPiece !== null;
    
    let castled = false;
    let rookMove = null;

    // Check for castling
    if (piece.type === 'k') {
      // White Kingside
      if (fromStr === 'e1' && toStr === 'g1') {
        const rook = this.getPieceAt(7, 7);
        this.setPieceAt(7, 5, rook);
        this.setPieceAt(7, 7, null);
        castled = true;
        rookMove = { from: 'h1', to: 'f1' };
      }
      // White Queenside
      else if (fromStr === 'e1' && toStr === 'c1') {
        const rook = this.getPieceAt(7, 0);
        this.setPieceAt(7, 3, rook);
        this.setPieceAt(7, 0, null);
        castled = true;
        rookMove = { from: 'a1', to: 'd1' };
      }
      // Black Kingside
      else if (fromStr === 'e8' && toStr === 'g8') {
        const rook = this.getPieceAt(0, 7);
        this.setPieceAt(0, 5, rook);
        this.setPieceAt(0, 7, null);
        castled = true;
        rookMove = { from: 'h8', to: 'f8' };
      }
      // Black Queenside
      else if (fromStr === 'e8' && toStr === 'c8') {
        const rook = this.getPieceAt(0, 0);
        this.setPieceAt(0, 3, rook);
        this.setPieceAt(0, 0, null);
        castled = true;
        rookMove = { from: 'a8', to: 'd8' };
      }
    }

    // Move piece
    this.setPieceAt(to.row, to.col, piece);
    this.setPieceAt(from.row, from.col, null);

    // Pawn promotion (auto-promote to Queen for simplicity)
    if (piece.type === 'p' && (to.row === 0 || to.row === 7)) {
      this.setPieceAt(to.row, to.col, { type: 'q', color: piece.color });
    }

    // Toggle turn
    this.turn = this.turn === 'w' ? 'b' : 'w';

    const moveInfo = {
      from: fromStr,
      to: toStr,
      piece: piece,
      captured: isCapture,
      castled: castled,
      rookMove: rookMove
    };

    this.moveHistory.push(moveInfo);
    return moveInfo;
  }

  undoLastMove() {
    const snap = this.stateHistory.pop();
    if (!snap) return false;
    this.board = snap.board;
    this.turn = snap.turn;
    this.moveHistory.pop();
    return true;
  }

  /* ── Attack / legal-move detection (for live board editing) ── */

  isSquareAttacked(row, col, byColor) {
    if (row < 0 || row > 7 || col < 0 || col > 7) return false;

    // Pawn attacks
    const pawnDir = byColor === 'w' ? -1 : 1;
    for (const dc of [-1, 1]) {
      const p = this.getPieceAt(row + pawnDir, col + dc);
      if (p && p.type === 'p' && p.color === byColor) return true;
    }

    // Knight attacks
    const knightMoves = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
    for (const [dr, dc] of knightMoves) {
      const p = this.getPieceAt(row + dr, col + dc);
      if (p && p.type === 'n' && p.color === byColor) return true;
    }

    // King attacks
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        const p = this.getPieceAt(row + dr, col + dc);
        if (p && p.type === 'k' && p.color === byColor) return true;
      }

    // Sliding pieces: diagonals (bishop/queen)
    for (const [dr, dc] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
      let rr = row + dr, cc = col + dc;
      while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) {
        const p = this.getPieceAt(rr, cc);
        if (p) {
          if (p.color === byColor && (p.type === 'b' || p.type === 'q')) return true;
          break;
        }
        rr += dr; cc += dc;
      }
    }

    // Sliding pieces: straights (rook/queen)
    for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
      let rr = row + dr, cc = col + dc;
      while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) {
        const p = this.getPieceAt(rr, cc);
        if (p) {
          if (p.color === byColor && (p.type === 'r' || p.type === 'q')) return true;
          break;
        }
        rr += dr; cc += dc;
      }
    }

    return false;
  }

  isInCheck(color) {
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++) {
        const p = this.getPieceAt(r, c);
        if (p && p.type === 'k' && p.color === color) {
          return this.isSquareAttacked(r, c, color === 'w' ? 'b' : 'w');
        }
      }
    return false;
  }

  getPieceMoves(row, col) {
    const piece = this.getPieceAt(row, col);
    if (!piece) return [];
    const moves = [];
    const add = (r, c) => {
      if (r < 0 || r > 7 || c < 0 || c > 7) return false;
      const target = this.getPieceAt(r, c);
      if (target) {
        if (target.color !== piece.color) moves.push([r, c]);
        return false;
      }
      moves.push([r, c]);
      return true;
    };

    if (piece.type === 'p') {
      const dir = piece.color === 'w' ? -1 : 1;
      const startRow = piece.color === 'w' ? 6 : 1;
      if (!this.getPieceAt(row + dir, col)) {
        moves.push([row + dir, col]);
        if (row === startRow && !this.getPieceAt(row + 2 * dir, col)) moves.push([row + 2 * dir, col]);
      }
      for (const dc of [-1, 1]) {
        const t = this.getPieceAt(row + dir, col + dc);
        if (t && t.color !== piece.color) moves.push([row + dir, col + dc]);
      }
    } else if (piece.type === 'n') {
      for (const [dr, dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
        const r2 = row + dr, c2 = col + dc;
        if (r2 < 0 || r2 > 7 || c2 < 0 || c2 > 7) continue;
        const t = this.getPieceAt(r2, c2);
        if (!t || t.color !== piece.color) moves.push([r2, c2]);
      }
    } else if (piece.type === 'k') {
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const r2 = row + dr, c2 = col + dc;
          if (r2 < 0 || r2 > 7 || c2 < 0 || c2 > 7) continue;
          const t = this.getPieceAt(r2, c2);
          if (!t || t.color !== piece.color) moves.push([r2, c2]);
        }
    } else {
      const dirs = piece.type === 'b'
        ? [[-1,-1],[-1,1],[1,-1],[1,1]]
        : piece.type === 'r'
          ? [[-1,0],[1,0],[0,-1],[0,1]]
          : [[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]];
      for (const [dr, dc] of dirs) {
        let r2 = row + dr, c2 = col + dc;
        while (r2 >= 0 && r2 < 8 && c2 >= 0 && c2 < 8) {
          if (!add(r2, c2)) break;
          r2 += dr; c2 += dc;
        }
      }
    }
    return moves;
  }

  canCastleKS(color) {
    const r = color === 'w' ? 7 : 0;
    const enemy = color === 'w' ? 'b' : 'w';
    if (this.getPieceAt(r, 4)?.type !== 'k') return false;
    if (this.getPieceAt(r, 5) || this.getPieceAt(r, 6)) return false;
    if (this.getPieceAt(r, 7)?.type !== 'r') return false;
    return !this.isSquareAttacked(r, 4, enemy)
        && !this.isSquareAttacked(r, 5, enemy)
        && !this.isSquareAttacked(r, 6, enemy);
  }

  canCastleQS(color) {
    const r = color === 'w' ? 7 : 0;
    const enemy = color === 'w' ? 'b' : 'w';
    if (this.getPieceAt(r, 4)?.type !== 'k') return false;
    if (this.getPieceAt(r, 3) || this.getPieceAt(r, 2) || this.getPieceAt(r, 1)) return false;
    if (this.getPieceAt(r, 0)?.type !== 'r') return false;
    return !this.isSquareAttacked(r, 4, enemy)
        && !this.isSquareAttacked(r, 3, enemy)
        && !this.isSquareAttacked(r, 2, enemy);
  }

  isMoveSafe(fromR, fromC, toR, toC, color) {
    const fromPiece = this.getPieceAt(fromR, fromC);
    const toPiece = this.getPieceAt(toR, toC);
    this.setPieceAt(toR, toC, fromPiece);
    this.setPieceAt(fromR, fromC, null);
    const safe = !this.isInCheck(color);
    this.setPieceAt(fromR, fromC, fromPiece);
    this.setPieceAt(toR, toC, toPiece);
    return safe;
  }

  getLegalMoves(color) {
    const side = color || this.turn;
    const legal = [];
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++) {
        const p = this.getPieceAt(r, c);
        if (!p || p.color !== side) continue;
        for (const [tr, tc] of this.getPieceMoves(r, c)) {
          if (this.isMoveSafe(r, c, tr, tc, side)) {
            legal.push({ from: this.getSquareName(r, c), to: this.getSquareName(tr, tc) });
          }
        }
      }
    const rank = side === 'w' ? 7 : 0;
    const kingSq = this.getSquareName(rank, 4);
    if (this.getPieceAt(rank, 4)?.type === 'k') {
      if (this.canCastleKS(side)) legal.push({ from: kingSq, to: this.getSquareName(rank, 6) });
      if (this.canCastleQS(side)) legal.push({ from: kingSq, to: this.getSquareName(rank, 2) });
    }
    return legal;
  }

  isLegalMove(fromSq, toSq) {
    const moves = this.getLegalMoves(this.turn);
    return moves.some(m => m.from === fromSq && m.to === toSq);
  }

  isCheckmate(color) {
    if (!this.isInCheck(color)) return false;
    return this.getLegalMoves(color).length === 0;
  }
}
