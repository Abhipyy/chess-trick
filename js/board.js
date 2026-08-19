export class ChessBoard {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      throw new Error(`Container element #${containerId} not found.`);
    }

    this.onMove = options.onMove || (() => {});
    this.interactive = options.interactive !== undefined ? options.interactive : true;
    this.orientation = options.orientation || 'w'; // 'w' or 'b'
    
    this.game = null;
    this.selectedSquare = null;
    this.draggingPiece = null;
    this.dragStartX = 0;
    this.dragStartY = 0;
    
    this.highlights = {
      selected: null,
      lastMove: null, // { from, to }
      check: null,    // squareName
      hint: null,     // { from, to }
      error: null     // squareName
    };

    this.initDOM();
    this.setupEvents();
  }

  setGame(game) {
    this.game = game;
    this.render();
  }

  setOrientation(side) {
    this.orientation = side;
    this.render();
  }

  setInteractive(bool) {
    this.interactive = bool;
  }

  initDOM() {
    this.container.innerHTML = '';
    this.container.classList.add('chessboard-wrapper');

    // Create the board grid container
    this.boardEl = document.createElement('div');
    this.boardEl.className = 'chessboard-grid';
    this.container.appendChild(this.boardEl);

    // Create coords overlay
    this.coordsEl = document.createElement('div');
    this.coordsEl.className = 'chessboard-coordinates';
    this.container.appendChild(this.coordsEl);
  }

  setupEvents() {
    // Mouse and Touch events for click-to-move & drag-and-drop
    this.boardEl.addEventListener('mousedown', this.handleStart.bind(this));
    this.boardEl.addEventListener('touchstart', this.handleStart.bind(this), { passive: false });

    window.addEventListener('mousemove', this.handleMove.bind(this));
    window.addEventListener('touchmove', this.handleMove.bind(this), { passive: false });

    window.addEventListener('mouseup', this.handleEnd.bind(this));
    window.addEventListener('touchend', this.handleEnd.bind(this));

    // Suppress the ghost mouse events mobile browsers fire after a touch,
    // otherwise a single tap can trigger two moves / phantom errors.
    const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (isTouch) {
      this.boardEl.addEventListener('click', e => {
        if (Date.now() - (this._lastTouchTime || 0) < 800) e.preventDefault();
      }, true);
    }
  }

  _markTouch(e) {
    if (e.type.startsWith('touch')) this._lastTouchTime = Date.now();
  }

  _isGhostMouse(e) {
    if (!e.type.startsWith('touch') && this._lastTouchTime && Date.now() - this._lastTouchTime < 800) {
      return true;
    }
    return false;
  }

  // Clear visual highlights
  clearHighlights() {
    this.highlights.selected = null;
    this.highlights.check = null;
    this.highlights.hint = null;
    this.highlights.error = null;
    this.clearMoveHints();
    this.updateHighlights();
  }

  clearMoveHints() {
    if (this._hintSquares) {
      this._hintSquares.forEach(sq => {
        const el = this.getSquareEl(sq);
        if (el) el.classList.remove('move-hint', 'move-hint-capture');
      });
    }
    this._hintSquares = null;
  }

  showLegalMoves(fromSq) {
    this.clearMoveHints();
    if (!this.game || !this.game.getLegalMoves) return;
    const legal = this.game.getLegalMoves(this.game.turn);
    const targets = legal.filter(m => m.from === fromSq).map(m => m.to);
    this._hintSquares = targets;
    targets.forEach(sq => {
      const el = this.getSquareEl(sq);
      if (!el) return;
      const coords = this.game.parseSquare(sq);
      const hasPiece = this.game.getPieceAt(coords.row, coords.col) !== null;
      el.classList.add('move-hint');
      if (hasPiece) el.classList.add('move-hint-capture');
    });
  }

  flashError(squareName) {
    this.setHighlight('error', squareName);
    this.container.classList.add('shake');
    setTimeout(() => {
      this.container.classList.remove('shake');
      if (this.highlights.error === squareName) this.setHighlight('error', null);
    }, 400);
  }

  setHighlight(type, value) {
    this.highlights[type] = value;
    this.updateHighlights();
  }

  updateHighlights() {
    // Remove old highlight classes
    this.boardEl.querySelectorAll('.square').forEach(sq => {
      sq.classList.remove('highlight-selected', 'highlight-check', 'highlight-hint', 'highlight-error', 'highlight-last-from', 'highlight-last-to');
    });

    if (this.highlights.selected) {
      const sqEl = this.getSquareEl(this.highlights.selected);
      if (sqEl) sqEl.classList.add('highlight-selected');
    }

    if (this.highlights.check) {
      const sqEl = this.getSquareEl(this.highlights.check);
      if (sqEl) sqEl.classList.add('highlight-check');
    }

    if (this.highlights.error) {
      const sqEl = this.getSquareEl(this.highlights.error);
      if (sqEl) sqEl.classList.add('highlight-error');
    }

    if (this.highlights.hint) {
      const fromEl = this.getSquareEl(this.highlights.hint.from);
      const toEl = this.getSquareEl(this.highlights.hint.to);
      if (fromEl) fromEl.classList.add('highlight-hint');
      if (toEl) toEl.classList.add('highlight-hint');
    }

    if (this.highlights.lastMove) {
      const fromEl = this.getSquareEl(this.highlights.lastMove.from);
      const toEl = this.getSquareEl(this.highlights.lastMove.to);
      if (fromEl) fromEl.classList.add('highlight-last-from');
      if (toEl) toEl.classList.add('highlight-last-to');
    }
  }

  getSquareEl(squareName) {
    if (!this.game) return null;
    const coords = this.game.parseSquare(squareName);
    if (!coords) return null;
    
    // Map to element
    const visualRow = this.orientation === 'w' ? coords.row : 7 - coords.row;
    const visualCol = this.orientation === 'w' ? coords.col : 7 - coords.col;
    const idx = visualRow * 8 + visualCol;
    return this.boardEl.children[idx];
  }

  render() {
    if (!this.game) return;
    this.clearMoveHints();

    this.boardEl.innerHTML = '';
    
    // Draw squares
    for (let r = 0; r < 8; r++) {
      const row = this.orientation === 'w' ? r : 7 - r;
      for (let c = 0; c < 8; c++) {
        const col = this.orientation === 'w' ? c : 7 - c;
        
        const squareEl = document.createElement('div');
        const isDark = (row + col) % 2 === 1;
        squareEl.className = `square ${isDark ? 'dark-square' : 'light-square'}`;
        squareEl.dataset.row = row;
        squareEl.dataset.col = col;
        squareEl.dataset.name = this.game.getSquareName(row, col);

        this.boardEl.appendChild(squareEl);
      }
    }

    // Render coordinates (ranks 1-8 and files a-h)
    this.renderCoordinates();

    // Render pieces
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const piece = this.game.getPieceAt(row, col);
        if (piece) {
          this.createPieceEl(row, col, piece);
        }
      }
    }

    this.updateHighlights();
  }

  renderCoordinates() {
    this.coordsEl.innerHTML = '';
    const boardRect = this.boardEl.getBoundingClientRect();
    const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const ranks = ['1', '2', '3', '4', '5', '6', '7', '8'];

    const activeFiles = this.orientation === 'w' ? files : [...files].reverse();
    const activeRanks = this.orientation === 'w' ? [...ranks].reverse() : ranks;

    // We render coordinate tags as absolute overlay elements
    for (let i = 0; i < 8; i++) {
      // File labels (bottom)
      const fileLabel = document.createElement('span');
      fileLabel.className = 'coord-label file-label';
      fileLabel.textContent = activeFiles[i];
      fileLabel.style.left = `calc(${i * 12.5}% + 4px)`;
      fileLabel.style.bottom = `4px`;
      this.coordsEl.appendChild(fileLabel);

      // Rank labels (left)
      const rankLabel = document.createElement('span');
      rankLabel.className = 'coord-label rank-label';
      rankLabel.textContent = activeRanks[i];
      rankLabel.style.top = `calc(${i * 12.5}% + 4px)`;
      rankLabel.style.left = `4px`;
      this.coordsEl.appendChild(rankLabel);
    }
  }

  createPieceEl(row, col, piece) {
    const pieceEl = document.createElement('div');
    pieceEl.className = `piece ${piece.color === 'w' ? 'white-piece' : 'black-piece'}`;
    pieceEl.dataset.row = row;
    pieceEl.dataset.col = col;
    pieceEl.dataset.type = piece.type;
    pieceEl.dataset.color = piece.color;

    // Set image content (Neo style loaded locally)
    const imgUrl = `./images/pieces/${piece.color}${piece.type}.png`;
    pieceEl.innerHTML = `<img src="${imgUrl}" alt="${piece.color}${piece.type}" draggable="false" />`;

    // Position piece
    this.positionPieceEl(pieceEl, row, col);
    this.boardEl.appendChild(pieceEl);
  }

  positionPieceEl(el, row, col) {
    const visualRow = this.orientation === 'w' ? row : 7 - row;
    const visualCol = this.orientation === 'w' ? col : 7 - col;

    el.style.left = `calc(${visualCol} * 12.5%)`;
    el.style.top = `calc(${visualRow} * 12.5%)`;
    el.style.transform = 'translate(0px, 0px)';
  }

  // Get Client XY for mouse or touch
  getEventXY(e) {
    if (e.touches && e.touches.length > 0) {
      return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
    return { x: e.clientX, y: e.clientY };
  }

  // Interaction handlers
  handleStart(e) {
    if (!this.interactive || !this.game) return;

    this._markTouch(e);
    if (this._isGhostMouse(e)) return;

    // Dismiss any focused input (e.g. trick-name field) so the mobile
    // keyboard doesn't stay open over the board.
    if (document.activeElement && document.activeElement.blur) {
      document.activeElement.blur();
    }

    // Legal destinations of the currently selected piece (if any).
    const legalTargets = this.selectedSquare
      ? this.game.getLegalMoves(this.game.turn).filter(m => m.from === this.selectedSquare).map(m => m.to)
      : [];

    // Identify if clicking/dragging a piece
    const target = e.target.closest('.piece');
    if (!target) {
      // Clicking a square: if a piece is selected and this square is a
      // legal target, try tap-to-move.
      const square = e.target.closest('.square');
      if (square && this.selectedSquare && this.selectedSquare !== square.dataset.name && legalTargets.includes(square.dataset.name)) {
        const done = this.executeTapMove(square.dataset.name);
        if (done) return;
      }
      // Clear selection if clicking empty square
      if (this.selectedSquare) {
        this.selectedSquare = null;
        this.setHighlight('selected', null);
      }
      this.clearMoveHints();
      return;
    }

    const row = parseInt(target.dataset.row, 10);
    const col = parseInt(target.dataset.col, 10);
    const sqName = this.game.getSquareName(row, col);
    const tappedColor = target.dataset.color;

    // If a piece is already selected:
    if (this.selectedSquare && this.selectedSquare !== sqName) {
      if (legalTargets.includes(sqName)) {
        // This is a legal destination (e.g. capturing an opponent piece) → move.
        const done = this.executeTapMove(sqName);
        if (done) return;
      }
      if (tappedColor !== this.game.turn) {
        // Tapped an opponent piece that can't be captured: keep selection, no error.
        return;
      }
      // Otherwise it's our own piece → fall through to re-select it.
    }

    e.preventDefault();

    // Set selection
    this.selectedSquare = sqName;
    this.setHighlight('selected', sqName);
    this.showLegalMoves(sqName);

    // Setup dragging
    this.draggingPiece = target;
    target.classList.add('dragging');
    
    const coords = this.getEventXY(e);
    this.dragStartX = coords.x;
    this.dragStartY = coords.y;
  }

  handleMove(e) {
    if (!this.draggingPiece) return;

    this._markTouch(e);
    if (this._isGhostMouse(e)) return;
    
    e.preventDefault();
    const coords = this.getEventXY(e);
    const dx = coords.x - this.dragStartX;
    const dy = coords.y - this.dragStartY;

    this.draggingPiece.style.transform = `translate(${dx}px, ${dy}px)`;
  }

  handleEnd(e) {
    if (!this.draggingPiece) return;

    this._markTouch(e);
    if (this._isGhostMouse(e)) return;

    const pieceEl = this.draggingPiece;
    this.draggingPiece = null;
    pieceEl.classList.remove('dragging');

    // Calculate which square it was dropped on
    const boardRect = this.boardEl.getBoundingClientRect();
    const eventCoords = e.changedTouches && e.changedTouches.length > 0 
      ? { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY }
      : this.getEventXY(e);

    const relX = eventCoords.x - boardRect.left;
    const relY = eventCoords.y - boardRect.top;

    const sqSize = boardRect.width / 8;
    const visualCol = Math.floor(relX / sqSize);
    const visualRow = Math.floor(relY / sqSize);

    const row = this.orientation === 'w' ? visualRow : 7 - visualRow;
    const col = this.orientation === 'w' ? visualCol : 7 - visualCol;

    const sourceRow = parseInt(pieceEl.dataset.row, 10);
    const sourceCol = parseInt(pieceEl.dataset.col, 10);

    const fromSq = this.game.getSquareName(sourceRow, sourceCol);
    const toSq = this.game.getSquareName(row, col);

    let moveSuccessful = false;

    // If within bounds and not dragging back to the same square
    if (row >= 0 && row < 8 && col >= 0 && col < 8 && (fromSq !== toSq)) {
      // Trigger move validation event
      moveSuccessful = this.onMove(fromSq, toSq);
    }

    if (moveSuccessful) {
      // Success is handled by re-rendering from app state,
      // but let's clear the selected square
      this.selectedSquare = null;
      this.clearMoveHints();
      this.setHighlight('selected', null);
    } else {
      // Snap piece back to its original location
      this.positionPieceEl(pieceEl, sourceRow, sourceCol);
      
      // Also check if this was just a tap selection instead of a drag
      const dragDistance = Math.hypot(
        eventCoords.x - this.dragStartX,
        eventCoords.y - this.dragStartY
      );
      
      if (dragDistance < 5) {
        // Yes, it was just a tap. Keep selection and listen for target click.
        // If there was a previously selected square and this is not the piece itself, 
        // we might try to execute the tap-to-move.
      } else {
        // Drag failed. Clear selection.
        this.selectedSquare = null;
        this.clearMoveHints();
        this.setHighlight('selected', null);
      }
    }
  }

  // Handle a click on a destination square for tap-to-move
  executeTapMove(toSq) {
    if (!this.selectedSquare || this.selectedSquare === toSq) return false;
    
    const success = this.onMove(this.selectedSquare, toSq);
    if (success) {
      this.selectedSquare = null;
      this.setHighlight('selected', null);
    }
    return success;
  }
}
