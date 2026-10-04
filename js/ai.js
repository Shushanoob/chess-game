/* ai.js — шахматный бот (минимакс с альфа-бета отсечением) и оценка ходов для анализа. */
const AI = (() => {
  const VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
  const centrality = i => 3.5 - Math.max(Math.abs((i >> 3) - 3.5), Math.abs((i & 7) - 3.5));

  /** Оценка позиции в сотых долях пешки с точки зрения белых: материал + положение фигур. */
  function evaluate(s) {
    let score = 0;
    s.b.forEach((p, i) => {
      if (!p) return;
      const type = p.toLowerCase(), white = p === p.toUpperCase();
      let v = VALUE[type];
      if (type === 'n' || type === 'b') v += centrality(i) * 12;
      if (type === 'p') v += (white ? 6 - (i >> 3) : (i >> 3) - 1) * 8 + centrality(i) * 4;
      score += white ? v : -v;
    });
    return score;
  }

  const moveScore = m => (m.cap ? 10 * VALUE[m.cap.toLowerCase()] - VALUE[m.piece.toLowerCase()] : 0) + (m.promo ? 800 : 0);
  const ordered = moves => moves.sort((a, b) => moveScore(b) - moveScore(a));
  const sign = s => (s.turn === 'w' ? 1 : -1);

  /** Доигрываем взятия, чтобы не ошибаться на «горизонте» поиска. */
  function quiesce(s, alpha, beta, depth) {
    const stand = sign(s) * evaluate(s);
    if (depth === 0 || stand >= beta) return stand;
    alpha = Math.max(alpha, stand);
    for (const m of ordered(Chess.legal(s).filter(x => x.cap))) {
      alpha = Math.max(alpha, -quiesce(Chess.make(s, m), -beta, -alpha, depth - 1));
      if (alpha >= beta) break;
    }
    return alpha;
  }

  function negamax(s, depth, alpha, beta, ply) {
    const moves = Chess.legal(s);
    if (!moves.length) return Chess.inCheck(s) ? -100000 + ply : 0;
    if (depth === 0) return quiesce(s, alpha, beta, 3);
    for (const m of ordered(moves)) {
      alpha = Math.max(alpha, -negamax(Chess.make(s, m), depth - 1, -beta, -alpha, ply + 1));
      if (alpha >= beta) break;
    }
    return alpha;
  }

  /** Лучший ход: { move, score }. noise > 0 делает бота «неточным» (слабые уровни). */
  function best(s, depth, noise = 0, rand = 0) {
    if (rand && Math.random() < rand) {            // самые слабые боты иногда ходят наугад
      const all = Chess.legal(s);
      return { move: all[Math.floor(Math.random() * all.length)], score: 0 };
    }
    let top = null;
    for (const m of ordered(Chess.legal(s))) {
      const score = -negamax(Chess.make(s, m), depth - 1, -Infinity, Infinity, 1) + (Math.random() - 0.5) * 2 * noise;
      if (!top || score > top.score) top = { move: m, score };
    }
    return top;
  }

  const score = (s, depth) => negamax(s, depth, -Infinity, Infinity, 0);

  /** Качество хода по потере оценки (в сотых пешки). */
  function classify(loss) {
    if (loss <= 15) return { cls: 'best', icon: '⭐', label: 'Отличный ход' };
    if (loss <= 60) return { cls: 'good', icon: '👍', label: 'Хороший ход' };
    if (loss <= 130) return { cls: 'inacc', icon: '❓', label: 'Неточность' };
    if (loss <= 300) return { cls: 'mist', icon: '❌', label: 'Ошибка' };
    return { cls: 'blun', icon: '💥', label: 'Грубая ошибка' };
  }

  return { best, score, classify };
})();
