/* board.js — компонент доски: отрисовка, плавная анимация фигур, перетаскивание и клики, подсказки ходов. */
const glyph = (p, set = 'neo') => PIECES.svg(p, set);

class Board {
  constructor(root, { hints = true } = {}) {
    this.root = root; this.hints = hints; this.onMove = () => {}; this.onSelect = () => {}; this.suggest = null;
    this.orientation = 'w'; this.state = null; this.last = null;
    this.els = new Map();            // клетка -> элемент фигуры
    this.interactive = null;         // цвет, которым можно ходить (или null)
    this.legal = []; this.sel = null; this.targets = []; this.drag = null; this.promoting = false;
    root.innerHTML = '<div class="grid"></div><div class="pieces"></div>';
    [this.grid, this.layer] = root.children;
    for (let i = 0; i < 64; i++) { const sq = document.createElement('div'); sq.innerHTML = '<span class="move-dot"></span><span class="capture-ring"></span>'; this.grid.appendChild(sq); }
    root.addEventListener('pointerdown', e => this._down(e));
    root.addEventListener('pointermove', e => this._move(e));
    root.addEventListener('pointerup', e => this._up(e));
    root.addEventListener('pointercancel', () => this._cancel());   // системный жест прервал касание
  }

  /* ---------- публичное API ---------- */
  setPosition(state, { orientation = this.orientation, last = null } = {}) {
    this.state = state; this.orientation = orientation; this.last = last;
    this.sel = null; this.targets = []; this.suggest = null;
    this.layer.innerHTML = ''; this.els.clear();
    state.b.forEach((p, sq) => { if (p) this._spawn(p, sq); });
    this._refresh();
  }

  /** Анимированно выполняет ход; state — позиция ПОСЛЕ хода. */
  applyMove(state, m) {
    const mover = this.els.get(m.from);
    const capSq = m.ep ? m.to + (m.piece === 'P' ? 8 : -8) : m.to;
    const victim = this.els.get(capSq);
    if (victim && victim !== mover) { victim.classList.add('captured'); setTimeout(() => victim.remove(), 250); this.els.delete(capSq); }
    this.els.delete(m.from); this.els.set(m.to, mover);
    mover.classList.remove('drag');
    this._place(mover, m.to);
    if (m.promo) mover.innerHTML = glyph(Chess.colorOf(m.piece) === 'w' ? m.promo.toUpperCase() : m.promo, this.root.dataset.pieces || 'neo');
    if (m.castle) {
      const row = m.from & ~7, kingside = m.to > m.from, rook = this.els.get(row + (kingside ? 7 : 0));
      this.els.delete(row + (kingside ? 7 : 0)); this.els.set(row + (kingside ? 5 : 3), rook);
      this._place(rook, row + (kingside ? 5 : 3));
    }
    this.state = state; this.last = m; this.sel = null; this.targets = []; this.suggest = null;
    this._refresh();
  }

  setInteractive(color) { this.interactive = color; this.sel = null; this.targets = []; this._refresh(); }
  setAppearance({ pieceSet = 'neo', theme = 'green', coords = true } = {}) {
    this.root.dataset.pieces = pieceSet; this.root.dataset.theme = theme; this.root.classList.toggle('no-coords', !coords);
    if (this.state) this.setPosition(this.state, { orientation: this.orientation, last: this.last });
  }
  /** Подсвечивает рекомендуемый ход синим. */
  showSuggestion(m) { this.suggest = m; this._paint(); }
  flip() { this.orientation = this.orientation === 'w' ? 'b' : 'w'; this.els.forEach((el, sq) => this._place(el, sq)); this._paint(); }

  /* ---------- отрисовка ---------- */
  _pos(sq) { const d = this.orientation === 'w' ? sq : 63 - sq; return [d & 7, d >> 3]; }
  _place(el, sq) { const [x, y] = this._pos(sq); el.style.transform = `translate(${x * 100}%,${y * 100}%)`; }
  _spawn(p, sq) {
    const el = document.createElement('div');
    el.className = 'pc ' + Chess.colorOf(p); el.innerHTML = glyph(p, this.root.dataset.pieces || 'neo');
    this._place(el, sq); this.layer.appendChild(el); this.els.set(sq, el);
  }
  _refresh() {
    this.legal = this.interactive && this.state ? Chess.legal(this.state).filter(m => Chess.colorOf(m.piece) === this.interactive) : [];
    this._paint();
  }
  _paint() {
    const s = this.state, kingSq = s && Chess.inCheck(s) ? s.b.indexOf(s.turn === 'w' ? 'K' : 'k') : -1;
    [...this.grid.children].forEach((el, d) => {
      const sq = this.orientation === 'w' ? d : 63 - d, target = this.targets.find(m => m.to === sq);
      el.className = 'sq ' + (((d >> 3) + (d & 7)) % 2 ? 'dark' : 'light')
        + (this.last && (this.last.from === sq || this.last.to === sq) ? ' last' : '')
        + (this.sel === sq ? ' sel' : '') + (this.suggest && (this.suggest.from === sq || this.suggest.to === sq) ? ' sug' : '') + (sq === kingSq ? ' check' : '')
        + (target ? (s.b[sq] || target.ep ? ' hint-cap' : ' hint') : '');
      el.dataset.file = d >= 56 ? 'abcdefgh'[sq & 7] : '';
      el.dataset.rank = (d & 7) === 0 ? 8 - (sq >> 3) : '';
    });
  }

  /* ---------- ввод: клик по фигуре и цели, либо перетаскивание ---------- */
  _sqAt(e) {
    const r = this.root.getBoundingClientRect();
    const x = Math.min(7, Math.max(0, Math.floor((e.clientX - r.left) / r.width * 8)));
    const y = Math.min(7, Math.max(0, Math.floor((e.clientY - r.top) / r.height * 8)));
    return this.orientation === 'w' ? y * 8 + x : 63 - (y * 8 + x);
  }
  _select(sq) {
    this.sel = sq; this.suggest = null;
    this.targets = sq === null ? [] : this.legal.filter(m => m.from === sq);
    this.onSelect(sq); this._paint();
  }
  _down(e) {
    if (!this.interactive || this.promoting) return;
    const sq = this._sqAt(e);
    if (this.sel !== null && this.targets.some(m => m.to === sq)) return this._try(sq);
    this._select(this.legal.some(m => m.from === sq) ? sq : null);
    if (this.sel !== null) {
      this.drag = { el: this.els.get(sq), x: e.clientX, y: e.clientY, active: false };
      this.root.setPointerCapture(e.pointerId);
    }
  }
  _move(e) {
    const d = this.drag;
    if (!d) return;
    if (!d.active && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) { d.active = true; d.el.classList.add('drag'); }
    if (d.active) {
      const r = this.root.getBoundingClientRect();
      d.el.style.transform = `translate(${((e.clientX - r.left) / r.width * 8 - 0.5) * 100}%,${((e.clientY - r.top) / r.height * 8 - 0.5) * 100}%)`;
    }
  }
  _up(e) {
    const d = this.drag; this.drag = null;
    if (!d || !d.active) return;
    d.el.classList.remove('drag');
    const to = this._sqAt(e);
    if (this.targets.some(m => m.to === to)) this._try(to); else this._place(d.el, this.sel);
  }
  _cancel() {
    const d = this.drag; this.drag = null;
    if (d) { d.el.classList.remove('drag'); if (this.sel !== null) this._place(d.el, this.sel); }
  }
  async _try(to) {
    const options = this.targets.filter(m => m.to === to);
    let move = options[0];
    if (options.length > 1) {                       // превращение пешки — выбор фигуры
      this.promoting = true;
      const promo = await this._askPromotion(Chess.colorOf(move.piece));
      this.promoting = false;
      move = options.find(m => m.promo === promo);
    }
    this._select(null);
    this.onMove(move);
  }
  _askPromotion(color) {
    return new Promise(resolve => {
      const box = document.createElement('div');
      box.className = 'promo';
      for (const p of 'qrbn') {
        const b = document.createElement('button');
        b.innerHTML = glyph(color === 'w' ? p.toUpperCase() : p, this.root.dataset.pieces || 'neo');
        b.onclick = () => { box.remove(); resolve(p); };
        box.appendChild(b);
      }
      this.root.appendChild(box);
    });
  }
}
