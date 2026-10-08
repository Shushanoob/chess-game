/* engine.js — правила шахмат: генерация ходов, шах/мат/пат, FEN, запись ходов (SAN).
   Позиция: { b: [64 клетки, 0 = a8], turn: 'w'|'b', castle: 'KQkq', ep: клетка|-1, half, full }.
   Заглавные буквы — белые фигуры, строчные — чёрные. */
const Chess = (() => {
  const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const KNIGHT = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];
  const KING = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const ROOK = KING.slice(0, 4), BISHOP = KING.slice(4);
  const colorOf = p => (p === p.toUpperCase() ? 'w' : 'b');
  const sqName = i => 'abcdefgh'[i & 7] + (8 - (i >> 3));
  const inside = (r, f) => r >= 0 && r < 8 && f >= 0 && f < 8;

  function fromFEN(fen) {
    const [rows, turn, castle, ep, half, full] = fen.split(' ');
    const b = [];
    for (const ch of rows.replace(/\//g, '')) {
      if (/\d/.test(ch)) for (let k = 0; k < +ch; k++) b.push(null); else b.push(ch);
    }
    const epSq = ep === '-' ? -1 : 'abcdefgh'.indexOf(ep[0]) + (8 - ep[1]) * 8;
    return { b, turn, castle: castle === '-' ? '' : castle, ep: epSq, half: +half || 0, full: +full || 1 };
  }

  /** Атакована ли клетка sq фигурами цвета by. */
  function attacked(b, sq, by) {
    const r = sq >> 3, f = sq & 7, white = by === 'w';
    const at = (dr, df) => (inside(r + dr, f + df) ? b[(r + dr) * 8 + f + df] : null);
    const pawnRow = white ? 1 : -1;
    if (at(pawnRow, -1) === (white ? 'P' : 'p') || at(pawnRow, 1) === (white ? 'P' : 'p')) return true;
    if (KNIGHT.some(([dr, df]) => at(dr, df) === (white ? 'N' : 'n'))) return true;
    if (KING.some(([dr, df]) => at(dr, df) === (white ? 'K' : 'k'))) return true;
    const slide = (dirs, piece) => dirs.some(([dr, df]) => {
      for (let k = 1; inside(r + dr * k, f + df * k); k++) {
        const p = b[(r + dr * k) * 8 + f + df * k];
        if (p) return p === piece || p === (white ? 'Q' : 'q');
      }
      return false;
    });
    return slide(ROOK, white ? 'R' : 'r') || slide(BISHOP, white ? 'B' : 'b');
  }

  /** Все ходы без проверки, не остаётся ли свой король под шахом. */
  function pseudo(s) {
    const out = [], me = s.turn, opp = me === 'w' ? 'b' : 'w', b = s.b;
    for (let i = 0; i < 64; i++) {
      const p = b[i];
      if (!p || colorOf(p) !== me) continue;
      const t = p.toUpperCase(), r = i >> 3, f = i & 7;
      const add = (to, extra) => out.push({ from: i, to, piece: p, cap: b[to] || null, ...extra });
      const addPawn = (to, extra) => {
        if ((to >> 3) === (me === 'w' ? 0 : 7)) for (const promo of 'qrbn') add(to, { ...extra, promo });
        else add(to, extra);
      };
      if (t === 'P') {
        const d = me === 'w' ? -1 : 1, one = i + d * 8;
        if (!b[one]) {
          addPawn(one);
          if (r === (me === 'w' ? 6 : 1) && !b[one + d * 8]) add(one + d * 8, { dbl: true });
        }
        for (const df of [-1, 1]) {
          if (!inside(r + d, f + df)) continue;
          const to = one + df;
          if (b[to] && colorOf(b[to]) === opp) addPawn(to);
          else if (to === s.ep) add(to, { ep: true, cap: me === 'w' ? 'p' : 'P' });
        }
      } else if (t === 'N' || t === 'K') {
        for (const [dr, df] of t === 'N' ? KNIGHT : KING) {
          if (!inside(r + dr, f + df)) continue;
          const to = (r + dr) * 8 + f + df;
          if (!b[to] || colorOf(b[to]) === opp) add(to);
        }
        if (t === 'K' && i === (me === 'w' ? 60 : 4) && !attacked(b, i, opp)) {
          const [ks, qs] = me === 'w' ? ['K', 'Q'] : ['k', 'q'];
          if (s.castle.includes(ks) && !b[i + 1] && !b[i + 2] && !attacked(b, i + 1, opp) && !attacked(b, i + 2, opp)) add(i + 2, { castle: true });
          if (s.castle.includes(qs) && !b[i - 1] && !b[i - 2] && !b[i - 3] && !attacked(b, i - 1, opp) && !attacked(b, i - 2, opp)) add(i - 2, { castle: true });
        }
      } else {
        for (const [dr, df] of t === 'R' ? ROOK : t === 'B' ? BISHOP : KING) {
          for (let k = 1; inside(r + dr * k, f + df * k); k++) {
            const to = (r + dr * k) * 8 + f + df * k;
            if (b[to]) { if (colorOf(b[to]) === opp) add(to); break; }
            add(to);
          }
        }
      }
    }
    return out;
  }

  /** Возвращает новую позицию после хода m (исходная не меняется). */
  function make(s, m) {
    const b = s.b.slice(), me = s.turn;
    let castle = s.castle;
    b[m.to] = m.promo ? (me === 'w' ? m.promo.toUpperCase() : m.promo) : m.piece;
    b[m.from] = null;
    if (m.ep) b[m.to + (me === 'w' ? 8 : -8)] = null;
    if (m.castle) {
      const row = m.from & ~7, kingside = m.to > m.from;
      b[row + (kingside ? 5 : 3)] = b[row + (kingside ? 7 : 0)];
      b[row + (kingside ? 7 : 0)] = null;
    }
    const rights = { 60: 'KQ', 4: 'kq', 63: 'K', 56: 'Q', 7: 'k', 0: 'q' };
    for (const sq of [m.from, m.to]) {
      if (rights[sq]) castle = castle.split('').filter(c => !rights[sq].includes(c)).join('');
    }
    return {
      b, turn: me === 'w' ? 'b' : 'w', castle, ep: m.dbl ? (m.from + m.to) >> 1 : -1,
      half: m.piece.toUpperCase() === 'P' || m.cap ? 0 : s.half + 1, full: s.full + (me === 'b' ? 1 : 0),
    };
  }

  const kingSquare = (b, c) => b.indexOf(c === 'w' ? 'K' : 'k');
  const inCheck = s => attacked(s.b, kingSquare(s.b, s.turn), s.turn === 'w' ? 'b' : 'w');

  function legal(s) {
    const me = s.turn, opp = me === 'w' ? 'b' : 'w';
    return pseudo(s).filter(m => { const n = make(s, m); return !attacked(n.b, kingSquare(n.b, me), opp); });
  }

  /** null — игра продолжается, иначе 'checkmate' | 'stalemate' | 'fifty' | 'insufficient'. */
  function status(s, moves = legal(s)) {
    if (!moves.length) return inCheck(s) ? 'checkmate' : 'stalemate';
    if (s.half >= 100) return 'fifty';
    const rest = s.b.filter(p => p && p.toUpperCase() !== 'K');
    if (!rest.length || (rest.length === 1 && /[nb]/i.test(rest[0]))) return 'insufficient';
    return null;
  }

  const key = s => s.b.map(p => p || '1').join('') + s.turn + s.castle + s.ep;

  /** Запись хода в алгебраической нотации, например Nbd7+ */
  function san(s, m, moves = legal(s)) {
    let out;
    if (m.castle) out = m.to > m.from ? 'O-O' : 'O-O-O';
    else {
      const t = m.piece.toUpperCase();
      out = '';
      if (t !== 'P') {
        out = t;
        const rivals = moves.filter(o => o.from !== m.from && o.piece === m.piece && o.to === m.to);
        if (rivals.length) {
          const sameFile = rivals.some(o => (o.from & 7) === (m.from & 7));
          const sameRank = rivals.some(o => (o.from >> 3) === (m.from >> 3));
          out += !sameFile ? sqName(m.from)[0] : !sameRank ? sqName(m.from)[1] : sqName(m.from);
        }
      } else if (m.cap) out = sqName(m.from)[0];
      if (m.cap) out += 'x';
      out += sqName(m.to) + (m.promo ? '=' + m.promo.toUpperCase() : '');
    }
    const next = make(s, m);
    if (inCheck(next)) out += legal(next).length ? '+' : '#';
    return out;
  }

  return { START, fromFEN, legal, make, status, inCheck, key, san, sqName, colorOf };
})();
