import { TRICKS } from './tricks.js?v=19';
import { sounds } from './sound.js?v=19';
import { ChessGame } from './game.js?v=19';
import { ChessBoard } from './board.js?v=19';
import { connectFirestore, saveTrickToCloud, deleteTrickFromCloud } from './firestore.js?v=19';

/* ──────────────────────────────────────────────
   TrickCardController – one per visible card
────────────────────────────────────────────── */
class TrickCardController {
  constructor(trick, getSoundEnabled, onActivate) {
    this.trick = trick;
    this.getSoundEnabled = getSoundEnabled;
    this.onActivate = onActivate;
    this.game = new ChessGame();
    this.board = new ChessBoard(`board-container-${this.trick.id}`, {
      interactive: false,
      orientation: this.trick.side === 'White' ? 'w' : 'b'
    });
    this.board.setGame(this.game);
    this.moveIndex = 0;
    this.isPlaying = false;
    this.timer = null;
    this.speed = 1000;
    this.initDOM();
    this.reset();
  }

  initDOM() {
    this.cardEl = document.getElementById(`card-${this.trick.id}`);
    this.boardEl = document.getElementById(`board-container-${this.trick.id}`);
    this.btnPlay = this.cardEl.querySelector('.btn-play');
    this.btnPrev = this.cardEl.querySelector('.btn-prev');
    this.btnNext = this.cardEl.querySelector('.btn-next');
    this.btnReset = this.cardEl.querySelector('.btn-reset');
    this.moveLabel = this.cardEl.querySelector('.card-move-san');
    this.moveCount = this.cardEl.querySelector('.card-move-count');

    // Touching the board makes this the one card that plays.
    this.boardEl.addEventListener('click', () => this.touchToPlay());
    // On PC, hovering the card also starts it; leaving pauses it.
    if (window.matchMedia('(hover: hover)').matches) {
      this.cardEl.addEventListener('mouseenter', () => this.touchToPlay());
      this.cardEl.addEventListener('mouseleave', () => this.pause());
    }
    this.btnPlay.addEventListener('click', () => this.pause());
    this.btnPrev.addEventListener('click', () => { this.touchActivate(); this.pause(); this.stepBackward(); });
    this.btnNext.addEventListener('click', () => { this.touchActivate(); this.pause(); this.stepForward(); });
    this.btnReset.addEventListener('click', () => { this.touchActivate(); this.pause(); this.reset(); });
  }

  // Make this card the only active one, pausing every other card.
  touchActivate() {
    if (this.onActivate) this.onActivate(this.trick.id);
  }

  // Touch on board/play: activate, then start from the beginning.
  touchToPlay() {
    this.touchActivate();
    this.reset();
    this.play();
  }

  togglePlay() { this.isPlaying ? this.pause() : this.play(); }

  play() {
    if (this.isPlaying) return;
    this.isPlaying = true;
    this.btnPlay.innerHTML = '<span class="material-icons">pause</span>';
    const tick = () => {
      if (!this.isPlaying) return;
      if (this.moveIndex < this.trick.moves.length) {
        this.stepForward();
        this.timer = setTimeout(tick, this.speed);
      } else {
        this.timer = setTimeout(() => { this.reset(); this.timer = setTimeout(tick, this.speed); }, 3000);
      }
    };
    this.timer = setTimeout(tick, this.speed);
  }

  pause() {
    this.isPlaying = false;
    this.btnPlay.innerHTML = '<span class="material-icons">play_arrow</span>';
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  reset() {
    this.game.reset();
    this.moveIndex = 0;
    this.board.clearHighlights();
    this.board.setHighlight('lastMove', null);
    this.updateMoveBar();
    this.board.render();
  }

  stepForward() { if (this.moveIndex < this.trick.moves.length) this.goToMove(this.moveIndex + 1); }
  stepBackward() { if (this.moveIndex > 0) this.goToMove(this.moveIndex - 1); }

  goToMove(targetIndex) {
    this.game.reset();
    this.board.clearHighlights();
    let lastMoveInfo = null;
    for (let i = 0; i < targetIndex; i++) {
      const coords = this.trick.moves[i].move.split('-');
      lastMoveInfo = this.game.makeMove(coords[0], coords[1]);
    }
    this.moveIndex = targetIndex;

    // King-square red glow on check/checkmate
    const san = this.trick.moves[targetIndex - 1]?.san ?? '';
    if (san.includes('+') || san.includes('#')) {
      const kc = this.game.turn;
      let ks = null;
      outer: for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
        const p = this.game.getPieceAt(r, c);
        if (p && p.type === 'k' && p.color === kc) { ks = this.game.getSquareName(r, c); break outer; }
      }
      if (ks) this.board.setHighlight('check', ks);
    }

    this.updateMoveBar();

    if (lastMoveInfo) {
      this.board.setHighlight('lastMove', { from: lastMoveInfo.from, to: lastMoveInfo.to });
      this.playSoundForMove(lastMoveInfo, this.trick.moves[targetIndex - 1]);
    } else {
      this.board.setHighlight('lastMove', null);
    }
    this.board.render();
  }

  playSoundForMove(moveInfo, trickMove) {
    if (!this.getSoundEnabled()) return;
    const isCheck = trickMove?.san.includes('+') || trickMove?.san.includes('#');
    if (isCheck) sounds.playCheck();
    else if (moveInfo.captured) sounds.playCapture();
    else sounds.playMove();
  }

  updateMoveBar() {
    if (!this.moveLabel || !this.moveCount) return;
    const cur = this.trick.moves[this.moveIndex - 1];
    this.moveLabel.textContent = cur?.san ?? '—';
    this.moveCount.textContent = `${this.moveIndex} / ${this.trick.moves.length}`;
  }

  destroy() { this.pause(); }
}

/* ──────────────────────────────────────────────
   App – main controller
────────────────────────────────────────────── */
class App {
  constructor() {
    this.tricks = [];
    this.cloudMode = false;
    this.controllers = new Map();
    this.activeFilter = 'all';
    this.soundEnabled = true;
    this.editingTrickId = null; // null = adding new
    this.recordedMoves = [];
    this.redoStack = [];
    this.modalOpen = false;
    this.unlocked = false;

    this.initDOM();
    this.initObserver();
    this.initLock();
    this.initData();
  }

  /* ── Data source: cloud (real-time) with local fallback ── */
  async initData() {
    let received = false;
    const connected = await connectFirestore({
      onData: (list) => {
        received = true;
        this.cloudMode = true;
        this.tricks = list;
        this.renderFeed();
      },
      onError: (err) => {
        if (!received) {
          // Could not reach the cloud (no key set / bad rules / offline) →
          // fall back to this device's local storage.
          this.cloudMode = false;
          this.tricks = this.loadTricksLocal();
          this.renderFeed();
        } else {
          this.showToast('Sync problem: ' + err.message, true);
        }
      }
    });

    if (!connected) {
      this.cloudMode = false;
      this.tricks = this.loadTricksLocal();
      this.renderFeed();
    } else {
      this.showToast('Live sync is on — tricks are shared in real time.');
    }
  }

  /* ── Simple password lock (one-time per device) ── */
  initLock() {
    if (localStorage.getItem('trickmaster-unlocked') === '1') {
      this.unlocked = true;
      this.lockScreen.classList.add('hidden');
      return;
    }
    this.lockScreen.classList.remove('hidden');
    this.lockPassword.focus();
  }

  tryUnlock() {
    if (this.lockPassword.value === 'knight4') {
      this.unlocked = true;
      localStorage.setItem('trickmaster-unlocked', '1');
      this.lockScreen.classList.add('hidden');
      this.lockPassword.value = '';
      this.lockError.textContent = '';
      this.showToast('Welcome!');
    } else {
      this.lockPassword.value = '';
      this.lockPassword.focus();
      this.lockError.textContent = 'Wrong password, try again.';
    }
  }

  /* ── Storage (local fallback mode) ── */
  loadTricksLocal() {
    try {
      const stored = localStorage.getItem('chessmaster-tricks-v2');
      if (stored) {
        const list = JSON.parse(stored);
        // Ensure any repo-baked custom tricks are present on this device.
        const byId = new Map(list.map(t => [t.id, t]));
        TRICKS.forEach(t => { if (t.isCustom && !byId.has(t.id)) byId.set(t.id, t); });
        const out = Array.from(byId.values());
        this.saveTricks(out);
        return out;
      }
    } catch (e) {}
    // First run – seed from built-in
    const seeded = TRICKS.map(t => ({ ...t, isBuiltIn: !t.isCustom }));
    this.saveTricks(seeded);
    return seeded;
  }

  saveTricks(list) {
    localStorage.setItem('chessmaster-tricks-v2', JSON.stringify(list ?? this.tricks));
  }

  /* ── DOM init ── */
  initDOM() {
    this.feedEl        = document.getElementById('tricks-feed');
    this.searchBar     = document.getElementById('search-tricks');
    this.soundToggle   = document.getElementById('sound-toggle');
    this.filterTabs    = document.querySelector('.filter-tabs');

    // Modal elements
    this.modal         = document.getElementById('trick-modal');
    this.modalTitle    = document.getElementById('modal-title');
    this.modalOverlay  = document.getElementById('modal-overlay');
    this.formName      = document.getElementById('form-name');
    this.formOpening   = document.getElementById('form-opening');
    this.formSide      = document.getElementById('form-side');
    this.formMovesList = document.getElementById('form-moves-list');
    this.movesEmptyEl  = document.getElementById('modal-moves-empty');
    this.btnSave       = document.getElementById('btn-save-trick');
    this.btnCancel     = document.getElementById('btn-cancel-modal');
    this.btnAddTrick   = document.getElementById('btn-add-trick');
    this.btnUndoMove   = document.getElementById('btn-undo-move');
    this.btnRedoMove   = document.getElementById('btn-redo-move');
    this.btnResetBoard = document.getElementById('btn-reset-board');
    this.toastEl       = document.getElementById('toast');
    this.lockScreen    = document.getElementById('lock-screen');
    this.lockPassword  = document.getElementById('lock-password');
    this.lockError     = document.getElementById('lock-error');
    this.btnUnlock     = document.getElementById('btn-unlock');

    // Live modal chessboard for recording moves
    this.modalGame = new ChessGame();
    this.modalBoard = new ChessBoard('modal-board', {
      interactive: true,
      onMove: (from, to) => this.handleModalMove(from, to)
    });
    this.modalBoard.setGame(this.modalGame);

    this.setupEvents();
  }

  setupEvents() {
    this.searchBar.addEventListener('input', () => this.renderFeed());
    this.filterTabs.addEventListener('click', e => {
      const btn = e.target.closest('.filter-btn');
      if (!btn) return;
      this.filterTabs.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      this.activeFilter = btn.dataset.filter;
      this.renderFeed();
    });
    this.soundToggle.addEventListener('click', () => {
      this.soundEnabled = !this.soundEnabled;
      const icon = this.soundToggle.querySelector('.material-icons');
      if (icon) icon.textContent = this.soundEnabled ? 'volume_up' : 'volume_off';
      this.soundToggle.classList.toggle('muted', !this.soundEnabled);
    });

    // Add trick button
    this.btnAddTrick.addEventListener('click', () => this.openModal(null));

    // Modal actions
    this.formSide.addEventListener('change', () => {
      this.modalBoard.setOrientation(this.formSide.value === 'White' ? 'w' : 'b');
    });
    this.btnUndoMove.addEventListener('click', () => this.undoModalMove());
    this.btnRedoMove.addEventListener('click', () => this.redoModalMove());
    this.btnResetBoard.addEventListener('click', () => this.resetModalBoard());
    this.btnSave.addEventListener('click', () => this.saveTrick());
    this.btnCancel.addEventListener('click', () => this.closeModal());
    document.getElementById('btn-cancel-modal-footer')?.addEventListener('click', () => this.closeModal());
    this.modalOverlay.addEventListener('click', () => this.closeModal());

    // Lock screen
    this.btnUnlock.addEventListener('click', () => this.tryUnlock());
    this.lockPassword.addEventListener('keydown', e => {
      if (e.key === 'Enter') this.tryUnlock();
    });
  }

  initObserver() {
    this.observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        const c = this.controllers.get(entry.target.dataset.id);
        if (!c) return;
        // Never simulate behind the lock screen or modal.
        if (!this.unlocked || this.modalOpen) { c.pause(); return; }
        // Pause cards that scroll out of view; playback itself is
        // touch-driven, not scroll-driven.
        if (!entry.isIntersecting) c.pause();
      });
    }, { threshold: 0.3 });
  }

  // Called when a card is touched: pause every other card.
  activateCard(id) {
    this.controllers.forEach(c => { if (c.trick.id !== id) c.pause(); });
  }

  /* ── Feed rendering ── */
  renderFeed() {
    this.controllers.forEach(c => c.destroy());
    this.controllers.clear();
    this.observer.disconnect();
    this.feedEl.innerHTML = '';

    const q = this.searchBar.value.toLowerCase();
    const filtered = this.tricks.filter(t => {
      const matchSearch = t.name.toLowerCase().includes(q) || t.opening.toLowerCase().includes(q);
      const matchFilter = this.activeFilter === 'all' || t.side === this.activeFilter;
      return matchSearch && matchFilter;
    });

    if (!filtered.length) {
      this.feedEl.innerHTML = `<div class="no-results">No traps found.</div>`;
      return;
    }

    filtered.forEach(trick => {
      const card = document.createElement('div');
      card.className = 'trick-card';
      card.id = `card-${trick.id}`;
      card.dataset.id = trick.id;

      card.innerHTML = `
        <div class="card-header-info">
          <h3 class="card-title">${trick.name}</h3>
          <div class="card-actions">
            <button class="btn-icon btn-edit" title="Edit trick">
              <span class="material-icons">edit</span>
            </button>
            <button class="btn-icon btn-delete" title="Delete trick">
              <span class="material-icons">delete</span>
            </button>
          </div>
        </div>

        <div class="card-board-wrapper">
          <div id="board-container-${trick.id}"></div>
        </div>

        <div class="card-movebar">
          <span class="card-move-san" id="card-san-${trick.id}">—</span>
          <span class="card-move-count" id="card-count-${trick.id}">0 / ${trick.moves.length}</span>
        </div>

        <div class="card-controls">
          <button class="btn-card btn-reset" title="Reset">
            <span class="material-icons" style="font-size:1.15rem">restart_alt</span>
          </button>
          <button class="btn-card btn-prev" title="Previous">
            <span class="material-icons" style="font-size:1.15rem">navigate_before</span>
          </button>
          <button class="btn-card primary-btn btn-play" title="Play">
            <span class="material-icons">play_arrow</span>
          </button>
          <button class="btn-card btn-next" title="Next">
            <span class="material-icons" style="font-size:1.15rem">navigate_next</span>
          </button>
        </div>
      `;

      // Edit / Delete handlers
      card.querySelector('.btn-edit').addEventListener('click', () => this.openModal(trick.id));
      card.querySelector('.btn-delete').addEventListener('click', () => this.deleteTrick(trick.id));

      this.feedEl.appendChild(card);

      const ctrl = new TrickCardController(trick, () => this.soundEnabled, (id) => this.activateCard(id));
      this.controllers.set(trick.id, ctrl);
      this.observer.observe(card);
    });
  }

  /* ── Delete ── */
  async deleteTrick(id) {
    if (!confirm('Delete this trick?')) return;
    const ctrl = this.controllers.get(id);
    if (ctrl) { ctrl.destroy(); this.controllers.delete(id); }
    if (this.cloudMode) {
      try {
        await deleteTrickFromCloud(id); // live update reaches everyone
      } catch (e) {
        this.showToast('Delete failed: ' + e.message, true);
      }
    } else {
      this.tricks = this.tricks.filter(t => t.id !== id);
      this.saveTricks();
      this.renderFeed();
    }
  }

  /* ── Modal: open ── */
  openModal(trickId) {
    this.editingTrickId = trickId;
    this.recordedMoves = [];
    this.redoStack = [];
    this.modalGame.reset();

    if (trickId) {
      const t = this.tricks.find(t => t.id === trickId);
      this.modalTitle.textContent = 'Edit Trick';
      this.formName.value    = t.name;
      this.formOpening.value = t.opening;
      this.formSide.value    = t.side;
      t.moves.forEach(m => {
        const [f, to] = m.move.split('-');
        this.modalGame.makeMove(f, to);
        this.recordedMoves.push({ move: m.move, san: m.san || '' });
      });
    } else {
      this.modalTitle.textContent = 'Add New Trick';
      this.formName.value    = '';
      this.formOpening.value = '';
      this.formSide.value    = 'White';
    }

    this.modalBoard.setOrientation(this.formSide.value === 'White' ? 'w' : 'b');
    this.modalBoard.render();
    this.renderMoveList();
    this.modal.classList.add('open');
    this.modalOverlay.classList.add('open');
    this.modalOpen = true;
    this.pauseAllControllers();
    setTimeout(() => this.formName.focus(), 300);
  }

  /* ── Modal: close ── */
  closeModal() {
    this.modal.classList.remove('open');
    this.modalOverlay.classList.remove('open');
    this.editingTrickId = null;
    this.recordedMoves = [];
    this.redoStack = [];
    this.modalOpen = false;
    this.renderFeed();
  }

  pauseAllControllers() {
    this.controllers.forEach(c => c.pause());
  }

  /* ── Live board move recording ── */
  handleModalMove(from, to) {
    if (!this.modalGame.isLegalMove(from, to)) {
      this.modalBoard.flashError(to);
      return false;
    }
    const info = this.modalGame.makeMove(from, to);
    if (!info) return false;
    this.recordedMoves.push({ move: `${from}-${to}`, san: this.generateSAN(info) });
    this.redoStack = []; // clear redo on new move
    this.modalBoard.render();
    this.renderMoveList();
    return true;
  }

  generateSAN(moveInfo) {
    const fromSq = moveInfo.from;
    const toSq = moveInfo.to;
    const piece = moveInfo.piece;

    if (moveInfo.castled) {
      return (fromSq === 'e1' && toSq === 'g1') || (fromSq === 'e8' && toSq === 'g8') ? 'O-O' : 'O-O-O';
    }

    let san = '';
    if (piece.type === 'p') {
      san = moveInfo.captured ? `${fromSq[0]}x${toSq}` : toSq;
    } else {
      const letters = { n: 'N', b: 'B', r: 'R', q: 'Q', k: 'K' };
      san = letters[piece.type] + (moveInfo.captured ? 'x' : '') + toSq;
    }

    const from = this.modalGame.parseSquare(fromSq);
    const to = this.modalGame.parseSquare(toSq);
    if (piece.type === 'p' && (to.row === 0 || to.row === 7)) san += '=Q';

    const oppColor = piece.color === 'w' ? 'b' : 'w';
    if (this.modalGame.isCheckmate(oppColor)) san += '#';
    else if (this.modalGame.isInCheck(oppColor)) san += '+';
    return san;
  }

  replayRecordedMoves() {
    this.modalGame.reset();
    for (const m of this.recordedMoves) {
      const [f, to] = m.move.split('-');
      this.modalGame.makeMove(f, to);
    }
    this.modalBoard.render();
  }

  undoModalMove() {
    if (!this.recordedMoves.length) return;
    const undone = this.recordedMoves.pop();
    this.redoStack.push(undone);
    this.modalGame.undoLastMove();
    this.modalBoard.render();
    this.renderMoveList();
  }

  redoModalMove() {
    if (!this.redoStack.length) return;
    const redone = this.redoStack.pop();
    this.recordedMoves.push(redone);
    const [f, to] = redone.move.split('-');
    this.modalGame.makeMove(f, to);
    this.modalBoard.render();
    this.renderMoveList();
  }

  removeModalMove(index) {
    this.recordedMoves.splice(index);
    this.redoStack = [];
    this.replayRecordedMoves();
    this.renderMoveList();
  }

  resetModalBoard() {
    this.recordedMoves = [];
    this.redoStack = [];
    this.modalGame.reset();
    this.modalBoard.render();
    this.renderMoveList();
  }

  renderMoveList() {
    this.formMovesList.innerHTML = '';
    const hasMoves = this.recordedMoves.length > 0;
    this.movesEmptyEl.style.display = hasMoves ? 'none' : 'block';
    this.btnUndoMove.disabled = !hasMoves;
    this.btnRedoMove.disabled = this.redoStack.length === 0;
    this.btnResetBoard.disabled = !hasMoves;

    this.recordedMoves.forEach((m, i) => {
      const row = document.createElement('div');
      row.className = 'modal-move-row';
      row.innerHTML = `
        <span class="modal-move-index">${i + 1}.</span>
        <span class="modal-move-san">${m.san || m.move.replace('-', '→')}</span>
        <button class="btn-icon btn-remove-move" title="Remove this move and everything after">
          <span class="material-icons">close</span>
        </button>
      `;
      row.querySelector('.btn-remove-move').addEventListener('click', () => this.removeModalMove(i));
      this.formMovesList.appendChild(row);
    });
  }

  showToast(msg, isError = false) {
    const t = this.toastEl;
    t.textContent = msg;
    t.classList.toggle('error', isError);
    t.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
  }

  /* ── Save ── */
  async saveTrick() {
    const name    = this.formName.value.trim();
    const opening = this.formOpening.value.trim() || 'Custom';
    const side    = this.formSide.value;

    if (!name) { this.showToast('Please enter a trick name.', true); return; }
    if (!this.recordedMoves.length) { this.showToast('Make at least one move on the board.', true); return; }

    const moves = this.recordedMoves.map(m => ({ move: m.move, san: m.san, comment: '' }));

    if (this.cloudMode) {
      const existing = this.editingTrickId
        ? this.tricks.find(t => t.id === this.editingTrickId)
        : null;
      const trick = {
        id: existing?.id || `custom-${Date.now()}`,
        name, opening, side,
        tags: existing?.tags || [],
        description: existing?.description || '',
        moves,
        isCustom: true,
        createdAt: existing?.createdAt ?? Date.now()
      };
      try {
        await saveTrickToCloud(trick); // live update reaches everyone
      } catch (e) {
        this.showToast('Save failed: ' + e.message, true);
        return;
      }
    } else if (this.editingTrickId) {
      // Update existing
      const idx = this.tricks.findIndex(t => t.id === this.editingTrickId);
      if (idx !== -1) {
        this.tricks[idx] = { ...this.tricks[idx], name, opening, side, moves };
      }
    } else {
      // Add new
      const id = `custom-${Date.now()}`;
      this.tricks.push({
        id, name, opening, side,
        tags: [],
        description: '',
        moves,
        isCustom: true
      });
    }

    if (!this.cloudMode) this.saveTricks();
    this.closeModal();
  }
}

/* ── Boot ── */
function initApp() { window.chessApp = new App(); }
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', initApp);
} else {
  initApp();
}
