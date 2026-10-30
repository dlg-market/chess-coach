// 2D board. Pieces live in their own layer above the squares, so any piece
// can glide to any square without redrawing the background (works the same
// under the clinical theme or the cabin scene).
import { Chess } from '../vendor/chess.js';

const FILES = 'abcdefgh';

export class Board {
  constructor(el, { onMove = null, pieceUrl = (c, t) => `assets/pieces/${c}${t.toUpperCase()}.svg` } = {}) {
    this.el = el;
    this.onMove = onMove;
    this.pieceUrl = pieceUrl;
    this.flipped = false;
    this.fen = null;
    this.pieces = []; // {el, type, color, square}
    this.inputColor = null;
    this.selected = null;
    this.highlights = {};
    this.arrows = [];
    this.build();
  }

  build() {
    this.el.classList.add('board');
    this.el.innerHTML = '';
    this.squaresEl = document.createElement('div');
    this.squaresEl.className = 'squares';
    this.squareEls = {};
    for (let i = 0; i < 64; i++) {
      const sq = document.createElement('div');
      sq.className = 'sq';
      this.squaresEl.appendChild(sq);
    }
    this.piecesEl = document.createElement('div');
    this.piecesEl.className = 'pieces';
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.setAttribute('viewBox', '0 0 800 800');
    this.svg.classList.add('arrows');
    this.el.append(this.squaresEl, this.piecesEl, this.svg);
    this.el.addEventListener('click', (e) => this.handleClick(e));
    this.layoutSquares();
  }

  layoutSquares() {
    const cells = this.squaresEl.children;
    for (let i = 0; i < 64; i++) {
      const row = Math.floor(i / 8), col = i % 8;
      const file = this.flipped ? 7 - col : col;
      const rank = this.flipped ? row + 1 : 8 - row;
      const name = FILES[file] + rank;
      const cell = cells[i];
      cell.dataset.sq = name;
      cell.className = 'sq ' + ((file + rank) % 2 === 0 ? 'dark' : 'light');
      cell.innerHTML = '';
      if (col === 0) cell.insertAdjacentHTML('beforeend', `<span class="coord rank">${rank}</span>`);
      if (row === 7) cell.insertAdjacentHTML('beforeend', `<span class="coord file">${FILES[file]}</span>`);
      this.squareEls[name] = cell;
    }
    this.applyHighlights();
  }

  setFlipped(f) {
    if (this.flipped === f) return;
    this.flipped = f;
    this.layoutSquares();
    for (const p of this.pieces) this.placePiece(p, false);
    this.drawArrows();
  }

  xy(square) {
    const file = FILES.indexOf(square[0]), rank = +square[1];
    const col = this.flipped ? 7 - file : file;
    const row = this.flipped ? rank - 1 : 8 - rank;
    return { col, row };
  }

  placePiece(p, animate) {
    const { col, row } = this.xy(p.square);
    p.el.classList.toggle('moving', !!animate);
    p.el.style.transform = `translate(${col * 100}%, ${row * 100}%)`;
  }

  // Diff-based update: pieces that stay put are untouched, moved pieces glide.
  setPosition(fen, { lastMove = null, animate = true } = {}) {
    const chess = new Chess(fen);
    const next = [];
    for (const row of chess.board()) for (const s of row) if (s) next.push({ type: s.type, color: s.color, square: s.square });
    const old = [...this.pieces];
    const kept = [];
    const unmatchedNew = [];
    for (const n of next) {
      const i = old.findIndex((o) => o.square === n.square && o.type === n.type && o.color === n.color);
      if (i >= 0) { kept.push(old[i]); old.splice(i, 1); } else unmatchedNew.push(n);
    }
    const dist = (a, b) => Math.abs(a.charCodeAt(0) - b.charCodeAt(0)) + Math.abs(+a[1] - +b[1]);
    for (const n of unmatchedNew) {
      let best = -1, bestD = 99;
      old.forEach((o, i) => {
        if (o.type !== n.type || o.color !== n.color) return;
        const d = lastMove && o.square === lastMove.from && n.square === lastMove.to ? -1 : dist(o.square, n.square);
        if (d < bestD) { bestD = d; best = i; }
      });
      if (best >= 0) {
        const p = old.splice(best, 1)[0];
        p.square = n.square;
        kept.push(p);
        this.placePiece(p, animate);
      } else {
        const p = this.makePiece(n);
        // Promotions grow out of the promotion square.
        kept.push(p);
        this.placePiece(p, false);
        if (animate) { p.el.classList.add('appear'); requestAnimationFrame(() => p.el.classList.remove('appear')); }
      }
    }
    for (const o of old) {
      if (animate) {
        o.el.classList.add('captured');
        setTimeout(() => o.el.remove(), 260);
      } else o.el.remove();
    }
    this.pieces = kept;
    this.fen = fen;
    this.selected = null;
    const hl = {};
    if (lastMove) { hl[lastMove.from] = 'last'; hl[lastMove.to] = 'last'; }
    if (chess.inCheck()) {
      const k = next.find((p) => p.type === 'k' && p.color === chess.turn());
      if (k) hl[k.square] = 'check';
    }
    this.highlights = hl;
    this.applyHighlights();
  }

  makePiece(n) {
    const el = document.createElement('div');
    el.className = `piece ${n.color}${n.type}`;
    el.style.backgroundImage = `url(${this.pieceUrl(n.color, n.type)})`;
    this.piecesEl.appendChild(el);
    return { el, ...n };
  }

  setHighlights(extra = {}) {
    this.extraHl = extra;
    this.applyHighlights();
  }

  applyHighlights() {
    for (const [name, cell] of Object.entries(this.squareEls)) {
      cell.classList.remove('hl-last', 'hl-check', 'hl-sel', 'hl-good', 'hl-bad', 'hl-target', 'hl-dest');
      const a = (this.highlights || {})[name];
      if (a) cell.classList.add('hl-' + a);
      const b = (this.extraHl || {})[name];
      if (b) cell.classList.add('hl-' + b);
    }
    if (this.selected) {
      this.squareEls[this.selected]?.classList.add('hl-sel');
      for (const d of this.dests || []) this.squareEls[d]?.classList.add('hl-dest');
    }
  }

  setArrows(arrows) { this.arrows = arrows || []; this.drawArrows(); }

  drawArrows() {
    const ns = 'http://www.w3.org/2000/svg';
    this.svg.innerHTML = '';
    const defs = document.createElementNS(ns, 'defs');
    const colors = { good: 'var(--arrow-good)', bad: 'var(--arrow-bad)', played: 'var(--arrow-played)' };
    for (const [k, v] of Object.entries(colors)) {
      defs.insertAdjacentHTML('beforeend', `<marker id="ah-${k}" markerWidth="4" markerHeight="4" refX="2.2" refY="2" orient="auto"><path d="M0,0 L4,2 L0,4 z" fill="${v}"/></marker>`);
    }
    this.svg.appendChild(defs);
    for (const a of this.arrows) {
      const p1 = this.xy(a.from), p2 = this.xy(a.to);
      const x1 = p1.col * 100 + 50, y1 = p1.row * 100 + 50, x2 = p2.col * 100 + 50, y2 = p2.row * 100 + 50;
      const len = Math.hypot(x2 - x1, y2 - y1);
      const shorten = 30;
      const ex = x2 - ((x2 - x1) / len) * shorten, ey = y2 - ((y2 - y1) / len) * shorten;
      const line = document.createElementNS(ns, 'line');
      line.setAttribute('x1', x1); line.setAttribute('y1', y1);
      line.setAttribute('x2', ex); line.setAttribute('y2', ey);
      line.setAttribute('class', `arrow ${a.color}`);
      line.setAttribute('marker-end', `url(#ah-${a.color})`);
      this.svg.appendChild(line);
    }
  }

  // Tap-tap input (works on phones without drag).
  enableInput(color) { this.inputColor = color; this.el.classList.add('interactive'); }
  disableInput() { this.inputColor = null; this.selected = null; this.dests = []; this.el.classList.remove('interactive'); this.applyHighlights(); }

  handleClick(e) {
    if (!this.inputColor || !this.fen) return;
    const rect = this.el.getBoundingClientRect();
    const col = Math.floor(((e.clientX - rect.left) / rect.width) * 8);
    const row = Math.floor(((e.clientY - rect.top) / rect.height) * 8);
    if (col < 0 || col > 7 || row < 0 || row > 7) return;
    const file = this.flipped ? 7 - col : col;
    const rank = this.flipped ? row + 1 : 8 - row;
    const sq = FILES[file] + rank;
    const chess = new Chess(this.fen);
    const piece = chess.get(sq);
    if (this.selected && this.dests.includes(sq)) {
      const from = this.selected;
      this.selected = null; this.dests = [];
      const moving = chess.get(from);
      const promo = moving && moving.type === 'p' && (sq[1] === '8' || sq[1] === '1') ? 'q' : undefined;
      if (this.onMove) this.onMove({ from, to: sq, promotion: promo });
      this.applyHighlights();
      return;
    }
    if (piece && piece.color === this.inputColor && chess.turn() === this.inputColor) {
      this.selected = sq;
      this.dests = chess.moves({ square: sq, verbose: true }).map((m) => m.to);
    } else {
      this.selected = null; this.dests = [];
    }
    this.applyHighlights();
  }
}
