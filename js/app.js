/* app.js — навигация, партия с ботом, обучение, задачи, профиль и анализ партий. */
const $ = s => document.querySelector(s);
const main = $('#main');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const last = a => a[a.length - 1];
const setup = {
  level: 2, color: 'w', time: 0, otime: 5,
  pieceSet: localStorage.getItem('chess_piece_set') || 'classic',
  boardTheme: localStorage.getItem('chess_board_theme') || 'green',
  opponentTheme: localStorage.getItem('chess_opponent_theme') || 'dark',
  onlineMode: localStorage.getItem('chess_online_mode') || 'quick',
  friendTime: Number(localStorage.getItem('chess_friend_time') || 5),
  friendRated: localStorage.getItem('chess_friend_rated') !== '0',
  friendUntimed: localStorage.getItem('chess_friend_untimed') === '1',
  friendUndo: localStorage.getItem('chess_friend_undo') !== '0',
  specialThemes: localStorage.getItem('chess_special_themes') === '1',
  coords: localStorage.getItem('chess_coords') !== '0',
};
const ONLINE_SESSION_KEY = 'chess_online_session_v3';
const timeRow = (act, list, cur) => list.map(t => `<button class="chip ${cur === t ? 'on' : ''}" data-act="${act}" data-arg="${t}">${t ? '⏱ ' + t + ' мин' : 'Без часов'}</button>`).join('');
let profile, board, game = null, review = null, taskHint = '';

/* ---------- общие части интерфейса ---------- */
const avatar = () => (profile.photo ? `<img src="${esc(profile.photo)}" alt="">` : esc(profile.name[0].toUpperCase()));
const say = t => { const el = $('#say'); if (el) el.textContent = t; const mobile = $('#mMatchSay'); if (mobile) mobile.textContent = t; };
const renderHeader = () => { $('#elo').textContent = `${profile.name} · ${profile.elo} Elo`; };
const player = (icon, name, elo, clk = '') => `<div class="player"><span class="av">${icon}</span><div><b>${esc(name)}</b><br><small>${elo} Elo</small></div>${clk ? `<span class="clock" id="${clk}"></span>` : ''}</div>`;
const PIECE_VALUES = { P: 1, N: 3, B: 3, R: 5, Q: 9, K: 0 };
function materialHTML(color) {
  const list = game?.captured?.[color] || [];
  const score = list.reduce((n, p) => n + (PIECE_VALUES[p.toUpperCase()] || 0), 0);
  const other = color === 'w' ? 'b' : 'w';
  const otherScore = (game?.captured?.[other] || []).reduce((n, p) => n + (PIECE_VALUES[p.toUpperCase()] || 0), 0);
  const diff = score - otherScore;
  const icons = list.map((p, i) => `<span class="captured-piece" title="${p.toUpperCase() === 'P' ? 'Пешка' : p.toUpperCase() === 'N' ? 'Конь' : p.toUpperCase() === 'B' ? 'Слон' : p.toUpperCase() === 'R' ? 'Ладья' : 'Ферзь'}">${glyph(p, setup.pieceSet)}</span>`).join('');
  return `<div class="material-line"><span class="captured-list">${icons || '<span class="material-empty">—</span>'}</span>${diff > 0 ? `<b class="material-plus">+${diff}</b>` : ''}</div>`;
}
function refreshMaterial() {
  if (!game?.online) return;
  const own = document.querySelector('[data-material="own"]'); const opp = document.querySelector('[data-material="opp"]');
  if (own) own.innerHTML = materialHTML(game.color);
  if (opp) opp.innerHTML = materialHTML(game.color === 'w' ? 'b' : 'w');
  document.querySelectorAll('[data-mobile-material="own"]').forEach(el => el.innerHTML = materialHTML(game.color));
  document.querySelectorAll('[data-mobile-material="opp"]').forEach(el => el.innerHTML = materialHTML(game.color === 'w' ? 'b' : 'w'));
}

function setOnlineLock(locked) {
  document.body.classList.toggle('online-match', !!locked);
  const nav = document.querySelector('nav');
  if (nav) nav.setAttribute('aria-hidden', locked ? 'true' : 'false');
}
function saveOnlineSession(g) {
  if (!g?.online || !g.matchId || !g.token) return;
  localStorage.setItem(ONLINE_SESSION_KEY, JSON.stringify({
    matchId: g.matchId, token: g.token, color: g.color, time: g.time,
    opponent: g.bot, rated: g.rated, allowUndo: g.allowUndo, mode: g.mode, savedAt: Date.now(), refreshedAt: Date.now()
  }));
}
function clearOnlineSession() { localStorage.removeItem(ONLINE_SESSION_KEY); }
function loadOnlineSession() {
  try {
    const x = JSON.parse(localStorage.getItem(ONLINE_SESSION_KEY) || 'null');
    return x && x.matchId && x.token ? x : null;
  } catch (_) { return null; }
}
function applyBoardPreferences() {
  if (!board?.root) return;
  board.root.dataset.theme = setup.boardTheme;
  board.root.dataset.pieces = setup.pieceSet;
  board.root.classList.toggle('no-coords', !setup.coords);
}
function boardLayout(side, hints = profile.hints, opts = {}) {
  const onlineClass = opts.online ? ' online-board-layout' : '';
  main.innerHTML = `<div class="layout${onlineClass}"><div class="boardwrap"><div id="board" class="board"></div></div><aside class="card match-side">${side}</aside>${opts.online ? `<div class="mobile-match-hud"><div class="mobile-hud-player"><span class="av">🌐</span><span><b>${esc(game?.bot?.name || 'Соперник')}</b><small>${game?.bot?.elo ?? '—'} Elo</small><i data-mobile-material="opp">${materialHTML(game?.color === 'w' ? 'b' : 'w')}</i></span><strong id="mClkO" class="clock"></strong></div><div id="mMatchSay" class="mobile-hud-status">Ваш ход</div><div class="mobile-hud-player self"><span class="av">${avatar()}</span><span><b>${esc(profile.name)}</b><small>${profile.elo} Elo</small><i data-mobile-material="own">${materialHTML(game?.color || 'w')}</i></span><strong id="mClkM" class="clock"></strong></div></div><div class="mobile-match-dock"><button data-act="mobilePanel">☰ <span>Панель</span></button><button data-act="pause">⏸ <span>Пауза</span></button><button data-act="flip">⇅ <span>Доска</span></button><button class="danger" data-act="resign">⚑ <span>Сдаться</span></button></div><div class="modal mobile-match-modal" id="mobileMatchPanel" hidden><div class="mobile-match-sheet"><div class="mobile-sheet-head"><b>Панель матча</b><button data-act="closeMobilePanel">✕</button></div><div class="match-controls mobile-panel-controls"><button class="icon-action" data-act="pause">⏸ Пауза</button><button class="icon-action" data-act="flip">⇅ Доска</button><button class="icon-action" data-act="matchSettings">⚙ Настройки</button>${game.allowUndo ? '<button class="icon-action" data-act="onlineUndo">↶ Отмена</button>' : ''}<button class="icon-action danger" data-act="resign">⚑ Сдаться</button></div><div class="match-tabs"><button class="on" data-act="matchTab" data-arg="moves">Ходы</button><button data-act="matchTab" data-arg="chat">Чат</button><button data-act="matchTab" data-arg="info">Информация</button></div><div class="match-tab-pane" data-match-pane></div></div></div>` : ''}</div>`;
  board = new Board($('#board'), { hints });
  applyBoardPreferences();
  fit();
}

/** Подгоняет доску под доступное место: игровой экран помещается без прокрутки страницы. */
function fit() {
  const wrap = $('.boardwrap');
  if (!wrap) return;
  const w = main.clientWidth, h = main.clientHeight, portrait = w < h;
  const size = game?.online && w <= 800 ? Math.max(180, Math.floor(portrait ? Math.min(w - 12, h - 74) : Math.min(h - 10, w - 90))) : Math.max(180, Math.floor(portrait ? Math.min(w - 16, h - 200) : Math.min(h - 16, w - 340)));
  wrap.style.width = wrap.style.height = size + 'px';
  $('#board').style.setProperty('--u', size / 100 + 'px');     // единица размера для шрифтов доски
}
addEventListener('resize', fit);

/* ---------- бот в фоновом потоке (если Worker недоступен — считаем здесь) ---------- */
let worker = null, jobs = {}, jobId = 0;
try {
  worker = new Worker('js/worker.js');
  worker.onmessage = e => { const j = jobs[e.data.id]; delete jobs[e.data.id]; if (j) j.resolve(e.data.result); };
  worker.onerror = () => {
    const pending = Object.values(jobs); jobs = {}; worker = null;
    pending.forEach(j => j.resolve(AI.best(...j.args)));
  };
} catch (e) { worker = null; }
function think(state, depth, noise, rand) {
  if (!worker) return Promise.resolve(AI.best(state, depth, noise, rand));
  return new Promise(resolve => { const id = ++jobId; jobs[id] = { resolve, args: [state, depth, noise, rand] }; worker.postMessage({ id, state, depth, noise, rand }); });
}

function movesHTML(list, active = -1) {
  return list.map((x, i) => (i % 2 ? '' : `<span class="no">${i / 2 + 1}.</span>`)
    + `<span class="mv ${x.cls || ''} ${i + 1 === active ? 'on' : ''}" data-act="ply" data-arg="${i + 1}">${x.san}${x.icon || ''}</span>`).join('');
}

function go(name, arg) {
  if (game && game.online && !game.over) {
    say('Во время онлайн-матча разделы меню недоступны. Завершите или сдайте партию.');
    return;
  }
  if (game) { game.over = true; clearTimeout(game.timer); clearInterval(game.tick); }
  Online.close();
  setOnlineLock(false);
  Platform.gameplay(false);
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.go === name));
  review = null;
  screens[name](arg);
}

/* ---------- экраны ---------- */
const screens = {
  home() {
    main.innerHTML = `<div class="home">
      <div class="home-hero"><div class="home-knight">♞</div><h1>${esc(GAME_TITLE)}</h1><p>Шахматы против бота, обучение, задачи и онлайн-партии.</p></div>
      <div class="home-grid">
        <button class="home-btn primary" data-go="play"><b>♟ Играть</b><small>Партия против бота</small></button>
        <button class="home-btn" data-go="online"><b>🌐 Онлайн</b><small>Игра с другим игроком</small></button>
        <button class="home-btn" data-go="learn"><b>🎓 Обучение</b><small>Освойте правила по шагам</small></button><button class="home-btn beginner-home" data-go="beginner"><b>🌱 Я новичок</b><small>Начать с полного нуля</small></button>
        <button class="home-btn" data-go="train"><b>🧩 Задачи</b><small>Проверьте свои навыки</small></button>
      </div>
      <div class="home-row"><button data-go="profile">👤 Профиль</button><button data-go="rating">🏆 Рейтинг</button></div>
    </div>`;
  },
  welcome() {
    main.innerHTML = `<div class="card narrow"><h2>Добро пожаловать в шахматы! ♞</h2>
      <p>Если вы только начинаете, сыграйте обучающую партию: бот ходит почти наугад, а я подсказываю, как ходит каждая фигура. Ходы можно отменять, а подсказка выручит, если вы застряли.</p>
      <button class="cta" data-act="tutorial">🎓 Начать обучающую партию</button>
      <button data-go="learn">📚 Сначала пройти уроки</button><button data-go="play">Я умею играть</button><button data-go="profile">👤 Войти: прогресс на всех устройствах и рейтинг</button></div>`;
    profile.seen = true; Platform.save();
  },
  beginner() {
    main.innerHTML = `<div class="beginner"><div class="beginner-hero"><span class="beginner-badge">С НУЛЯ</span><h1>Я вообще не умею играть</h1><p>Спокойный режим без рейтинга: сначала разберём доску и фигуры, затем вы попробуете сделать ходы сами.</p></div><div class="beginner-steps">${['Как устроена доска','Пешка и взятие','Ладья и слон','Конь и ферзь','Король и шах','Рокировка и мат'].map((x,i)=>`<div class="beginner-step"><b>${i+1}</b><span>${x}</span><small>${i<2?'самое необходимое':'следующий шаг'}</small></div>`).join('')}</div><div class="beginner-actions"><button class="cta" data-act="tutorial">🎓 Начать обучение на доске</button><button data-go="learn">Посмотреть все уроки</button></div><p class="beginner-note">Никаких штрафов и рейтинга. Подсказки можно использовать в любой момент.</p></div>`;
  },
  online() {
    const mode = setup.onlineMode || 'quick';
    const quick = mode === 'quick', friend = mode === 'friend', blitz = mode === 'blitz';
    const friendTime = setup.friendUntimed ? 0 : setup.friendTime;
    main.innerHTML = `<div class="online-lobby">
      <section class="lobby-hero">
        <div class="lobby-kicker">ОНЛАЙН-ШКОЛА</div>
        <h1>Игра с соперником</h1>
        <p>Быстрый поиск, блиц или закрытая комната для игры с другом.</p>
      </section>
      <div class="online-mode-tabs">
        <button class="${quick?'on':''}" data-act="onlineMode" data-arg="quick">⚡ Быстрая игра</button>
        <button class="${blitz?'on':''}" data-act="onlineMode" data-arg="blitz">🔥 Блиц</button>
        <button class="${friend?'on':''}" data-act="onlineMode" data-arg="friend">👥 Играть с другом</button>
      </div>
      <div class="lobby-grid single-lobby">
        <div class="card lobby-main">
          ${quick ? `<div class="lobby-section"><div class="section-title"><span>Контроль времени</span><small>Рейтинговая игра</small></div><div class="time-pills">${timeRow('otime',[3,5,10],setup.otime)}</div></div>
            <div class="lobby-actions"><button class="cta lobby-quick" data-act="quick"><span>⚡</span><b>Найти соперника</b><small>Автоматический подбор</small></button></div>` : ''}
          ${blitz ? `<div class="friend-settings"><div class="setting-card"><b>🔥 Блиц</b><small>Быстрая рейтинговая партия без паузы.</small><div class="time-pills">${timeRow('blitzTime',[1,3,5],setup.friendTime)}</div></div><button class="cta" data-act="blitz">Играть в блиц</button></div>` : ''}
          ${friend ? `<div class="friend-settings">
            <div class="setting-card"><b>⏱ Время</b><small>Выберите контроль времени для комнаты.</small><div class="time-pills">${timeRow('friendTime',[1,3,5,10],setup.friendTime)}</div><label class="checkline"><input type="checkbox" data-setting="friendUntimed" ${setup.friendUntimed?'checked':''}> Ходы без времени</label></div>
            <div class="setting-card"><b>🏆 Рейтинг</b><small>Результат влияет на Elo только если рейтинг включён.</small><label class="checkline"><input type="checkbox" data-setting="friendRated" ${setup.friendRated?'checked':''}> Рейтинговая партия</label></div>
            <div class="setting-card"><b>↶ Отмена хода</b><small>После просмотра rewarded-видео можно запросить отмену своего последнего хода.</small><label class="checkline"><input type="checkbox" data-setting="friendUndo" ${setup.friendUndo?'checked':''}> Разрешить отмену ходов</label></div>
            <button class="cta" data-act="createFriend">Создать лобби</button>
            <div class="room-row"><div class="code-field"><input id="code" maxlength="6" placeholder="КОД КОМНАТЫ" autocomplete="off"><button data-act="join">Войти</button></div></div>
          </div>` : ''}
          ${quick ? `<div class="room-row"><button data-act="createFriend">Создать комнату</button><div class="code-field"><input id="code" maxlength="6" placeholder="КОД КОМНАТЫ" autocomplete="off"><button data-act="join">Войти</button></div></div>` : ''}
          <div id="onmsg" class="lobby-status">${friend ? 'Создайте комнату, отправьте код другу и дождитесь его входа.' : blitz ? 'Блиц: 3 минуты по умолчанию.' : 'Рейтинг меняется по результату онлайн-партии.'}</div>
        </div>
      </div>
    </div>`;
    if (!Online.available()) $('#onmsg').textContent = 'Онлайн-сервер не настроен.';
  },

  async rating() {
    main.innerHTML = '<div class="card narrow"><h2>🏆 Рейтинг игроков</h2><div id="lb">Загрузка…</div></div>';
    const rows = await Platform.leaderboard();
    $('#lb').innerHTML = rows ? rows.map(r => `<div class="hist"><span>${r.rank}. ${esc(r.name)}</span><b>${r.score}</b></div>`).join('') || 'Пока никого нет' : 'Таблица лидеров доступна внутри Яндекс Игр для авторизованных игроков.';
  },
  games() {
    const rows = profile.history.map((h, i) => `<div class="game-history-row"><div class="game-history-main"><span class="game-result ${h.score === 1 ? 'win' : h.score === 0 ? 'loss' : 'draw'}">${h.score === 1 ? 'Победа' : h.score === 0 ? 'Поражение' : 'Ничья'}</span><b>${esc(h.bot || h.opponent || 'Соперник')}</b><small>${h.online ? 'Онлайн' : h.rated === false ? 'Учебная' : 'Бот'} · ${new Date(h.date || Date.now()).toLocaleString()}</small></div><div class="game-history-score">${h.rated === false ? '—' : `${h.delta >= 0 ? '+' : ''}${h.delta}`}</div><button data-act="analyse" data-arg="${i}">Разбор</button></div>`).join('');
    main.innerHTML = `<div class="card history-card"><div class="history-head"><div><h2>Партии</h2><p>Последние завершённые партии и их результаты.</p></div><button data-go="play">Новая партия</button></div>${rows || '<div class="history-empty">Пока нет завершённых партий.</div>'}</div>`;
  },
  play() {
    main.innerHTML = `<div class="card narrow"><h2>Играть с ботом</h2><button data-go="beginner" class="beginner-entry">🌱 Я вообще не умею играть</button><button data-act="tutorial">🎓 Обучающая партия для новичков</button>
      <div class="bots">${BOTS.map((b, i) => `<button class="bot ${i === setup.level ? 'on' : ''}" data-act="level" data-arg="${i}"><span>${b.emoji}</span><b>${b.name}</b><small>~${b.elo} Elo</small></button>`).join('')}</div>
      <div class="row">${[['w', '♔ Белые'], ['r', '🎲 Случайно'], ['b', '♚ Чёрные']].map(([c, t]) => `<button class="chip ${setup.color === c ? 'on' : ''}" data-act="color" data-arg="${c}">${t}</button>`).join('')}</div>
      <div class="row">${timeRow('time', [0, 5, 10], setup.time)}</div>
      <p><small>Партии с ботом меняют ваш рейтинг Elo. Рейтинг ботов ориентировочный.</small></p>
      <button class="cta" data-act="start">Начать партию</button></div>`;
  },
  learn() { listScreen('Обучение', 'Короткие интерактивные уроки: выполните задание прямо на доске.', LESSONS, 'lessons', 'lesson'); },
  train() { listScreen('Задачи', 'Найдите ход, который ставит мат.', PUZZLES, 'puzzles', 'puzzle'); },
  profile() {
    const p = profile;
    main.innerHTML = `<div class="card narrow"><h2>${p.seen ? 'Профиль' : 'Добро пожаловать!'}</h2>
      <div class="player"><span class="av big">${avatar()}</span><div><b>${esc(p.name)}</b><br><small>${p.elo} Elo · партий ${p.games} (${p.wins} П / ${p.draws} Н / ${p.losses} Пр)</small></div></div>
      <div class="row"><input id="nick" maxlength="14" placeholder="Ваш ник" value="${p.name === 'Игрок' ? '' : esc(p.name)}"><button data-act="nick">Сохранить ник</button></div>
      <small>${Platform.authorized() ? 'Вы вошли через Яндекс ID. Прогресс и рейтинг доступны на устройствах, где используется этот аккаунт.' : 'Гостевой режим доступен без регистрации. Яндекс ID нужен только по желанию: он синхронизирует прогресс и позволяет участвовать в официальном лидерборде.'}</small>
      ${Platform.authorized() ? '<div class="auth-state">✓ Яндекс ID подключён</div>' : '<div class="row"><button data-act="yandex">Войти через Яндекс ID</button><small id="loginMsg"></small></div>'}
      <h3>Настройки</h3>
      <label class="sw"><input type="checkbox" data-act="toggle" data-arg="sound" ${p.sound ? 'checked' : ''}> Звуки</label>
      <label class="sw"><input type="checkbox" data-act="toggle" data-arg="hints" ${p.hints ? 'checked' : ''}> Подсказки ходов</label>
      <h3>Последние партии</h3>${p.history.map((h, i) => `<div class="hist"><span>${h.score === 1 ? '✅' : h.score === 0 ? '❌' : '🤝'} ${esc(h.bot)} ${h.rated === false ? '(учебная)' : `(${h.delta >= 0 ? '+' : ''}${h.delta})`}</span><button data-act="analyse" data-arg="${i}">📊 Анализ</button></div>`).join('') || '<small>Пока нет партий</small>'}</div>`;
    p.seen = true; Platform.save();
  },
};

function listScreen(title, text, list, key, action) {
  const first = key === 'lessons' ? '<button class="item" data-act="tutorial">🎓 Обучающая партия с ботом: подсказки по каждой фигуре</button>' : '';
  main.innerHTML = `<div class="card narrow"><h2>${title} (${profile[key].length}/${list.length})</h2><p>${text}</p>${first}${list.map((t, i) => `<button class="item" data-act="${action}" data-arg="${i}">${profile[key].includes(t.id) ? '✅' : i + 1}  ${t.title}</button>`).join('')}</div>`;
}

/* ---------- партия с ботом ---------- */
const TIPS = {
  P: ['Пешка', 'ходит вперёд на 1 клетку (с начальной позиции можно на 2), а бьёт по диагонали вперёд.'],
  N: ['Конь', 'ходит буквой «Г» и перепрыгивает через другие фигуры.'],
  B: ['Слон', 'ходит по диагонали на любое число клеток.'],
  R: ['Ладья', 'ходит по прямой: вперёд, назад и в стороны.'],
  Q: ['Ферзь', 'самая сильная фигура: ходит как ладья и как слон.'],
  K: ['Король', 'ходит на 1 клетку в любую сторону. Главное — не подставить его под шах.'],
};
/** Подсказка-наставник в обучающей партии. */
function coach(sq, text) {
  const el = $('#coach');
  if (!el) return;
  const p = sq == null ? null : game.state.b[sq];
  el.textContent = text || (p ? `🎓 ${TIPS[p.toUpperCase()][0]} ${TIPS[p.toUpperCase()][1]}` : '🎓 Нажмите на свою фигуру — я покажу, как она ходит. Точки — доступные ходы.');
}

function chatHTML(messages) {
  return (messages || []).map(m => `<div class="chat-msg"><div class="chat-head"><b>${esc(m.name)}</b><span>${new Date(m.at || Date.now()).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</span></div><div>${esc(m.text)}</div></div>`).join('') || '<div class="chat-empty">Напишите сопернику сообщение.</div>';
}
function infoHTML() {
  if (!game?.online) return '';
  const opp = game.bot || {};
  const connected = game.opponentConnected !== false;
  return `<div class="match-info-panel">
    <div class="info-grid"><div><span>Соперник</span><b>${esc(opp.name || 'Игрок')}</b></div><div><span>Elo</span><b>${opp.elo ?? '—'}</b></div>
    <div><span>Контроль</span><b>${game.time ? game.time + ' мин' : 'Без времени'}</b></div><div><span>Статус</span><b class="${connected ? 'status-ok' : 'status-warn'}">${connected ? 'В сети' : 'Отключён'}</b></div></div>
    <div class="info-list"><div>Режим <b>${game.mode === 'blitz' ? 'Блиц' : game.rated ? 'Рейтинг' : 'Без рейтинга'}</b></div><div>Матч <b>${esc(game.matchId || '—')}</b></div><div>Ходов <b>${game.moves.length}</b></div><div>Пауза <b>${game.pauseUsed ? 'использована' : 'доступна'}</b></div><div>Переподключение <b>60 сек</b></div></div>
  </div>`;
}
function renderMatchTab(tab = 'moves') {
  if (!game?.online) return;
  game.activeTab = tab;
  const panes = [...document.querySelectorAll('[data-match-pane]')]; if (!panes.length) return;
  document.querySelectorAll('.match-tabs button').forEach(b => b.classList.toggle('on', b.dataset.arg === tab));
  const html = tab === 'moves' ? `<div class="moves match-moves">${movesHTML(game.moves)}</div>`
    : tab === 'chat' ? `<form class="chat-pane" data-chat-form><div class="chat-list" data-chat-list>${chatHTML(game.chat)}</div><div class="chat-compose"><input type="text" data-chat-input maxlength="300" placeholder="Сообщение…" autocomplete="off" enterkeyhint="send"><button type="submit" aria-label="Отправить">➤</button></div></form>`
    : `<div class="match-info-panel">${infoHTML()}</div>`;
  panes.forEach(pane => pane.innerHTML = html);
  if (tab === 'chat') {
    document.querySelectorAll('[data-chat-list]').forEach(list => list.scrollTop = list.scrollHeight);
    document.querySelector('[data-chat-input]')?.focus();
  }
}
function refreshMatchTab() { renderMatchTab(game?.activeTab || 'moves'); }
function restoreOnlineState(g, moves = []) {
  g.states = [Chess.fromFEN(Chess.START)]; g.keys = [Chess.key(g.states[0])]; g.moves = []; g.captured = { w: [], b: [] };
  for (const raw of (moves || [])) {
    const state = last(g.states);
    const mv = Chess.legal(state).find(x => x.from === Number(raw.from) && x.to === Number(raw.to) && (x.promo || null) === (raw.promo || null));
    if (!mv) break;
    if (mv.cap) g.captured[Chess.colorOf(mv.piece)].push(mv.cap.toUpperCase());
    g.moves.push({ m: mv, san: Chess.san(state, mv) });
    g.states.push(Chess.make(state, mv)); g.keys.push(Chess.key(last(g.states)));
  }
  g.state = last(g.states);
  board.setPosition(g.state, { orientation: g.color, last: g.moves.length ? last(g.moves).m : null });
  refreshMatchTab();
}
function showReconnectOverlay(seconds = 60, self = true) {
  if (!game || !game.online || game.over) return;
  const g = game; g.reconnecting = self; g.reconnectDeadline = Date.now() + seconds * 1000;
  let modal = $('#reconnectModal');
  if (!modal) {
    main.insertAdjacentHTML('beforeend', `<div class="modal reconnect-modal" id="reconnectModal"><div class="card reconnect-card"><div class="reconnect-icon">↻</div><h2>${self ? 'Соединение потеряно' : 'Соперник отключился'}</h2><p id="reconnectText">${self ? 'Возвращаемся в игру…' : 'Ждём переподключения соперника.'}</p><div id="reconnectTimer" class="reconnect-timer">1:00</div><small>Партия и часы сохранены на сервере.</small></div></div>`);
    modal = $('#reconnectModal');
  }
  const title = modal.querySelector('h2'); if (title) title.textContent = self ? 'Соединение потеряно' : 'Соперник отключился';
  clearInterval(g.reconnectTimer);
  g.reconnectTimer = setInterval(() => {
    if (!game || game !== g || g.over) return clearInterval(g.reconnectTimer);
    const left = Math.max(0, g.reconnectDeadline - Date.now());
    const sec = Math.ceil(left / 1000); const timer = $('#reconnectTimer'); if (timer) timer.textContent = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2,'0')}`;
    if (!left) {
      clearInterval(g.reconnectTimer); modal?.remove();
      if (self) { g.reconnecting = false; finish('disconnectTimeout'); }
    }
  }, 250);
}
function hideReconnectOverlay() {
  if (game?.reconnectTimer) clearInterval(game.reconnectTimer);
  $('#reconnectModal')?.remove();
  if (game) game.reconnecting = false;
}
function attemptReconnect(g) {
  if (!g || g !== game || g.over || !g.token) return;
  Online.reconnect(g.matchId, g.token).catch(() => {});
}
function startGame(tutorial = false, online = null) {
  const color = tutorial ? 'w' : online ? online.color : setup.color === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : setup.color;
  const bot = tutorial ? BOTS[0] : online ? { name: online.opponent.name, emoji: '🌐', elo: online.opponent.elo } : BOTS[setup.level], state = Chess.fromFEN(Chess.START);
  const time = tutorial ? 0 : online ? (online.time || 5) : setup.time;
  game = { bot, color, state, tutorial, online: !!online, matchId: online?.matchId || null, token: online?.token || null, time,
    rated: online ? online.rated !== false : true, allowUndo: !!online?.allowUndo, mode: online?.mode || 'online', takebackUsed: !!online?.takebackUsed, takebackPending: false,
    clock: time ? { w: time * 60000, b: time * 60000, last: Date.now() } : null, assisted: tutorial, states: [state], keys: [Chess.key(state)], moves: [], chat: online?.chat || [], activeTab: 'moves', over: false, busy: false,
    pausedUntil: online?.pausedUntil || 0, pauseUsed: !!online?.pauseUsed, pausePending: false, opponentConnected: online?.opponentConnected !== false, reconnecting: false, finishing: false, captured: { w: [], b: [] } };
  saveOnlineSession(game);
  const ad = !tutorial && !online && Platform.hasSdk() && Platform.CONFIG.rewardedAssist ? ' (видео)' : '';
  const side = online ? `<div class="match-appbar">
      <button class="match-appitem on" type="button" data-act="matchNav" data-arg="play">◷<span>Играть</span></button><button class="match-appitem" type="button" data-act="matchNav" data-arg="new">＋<span>Новая партия</span></button><button class="match-appitem" type="button" data-act="matchNav" data-arg="games">▦<span>Партии</span></button><button class="match-appitem" type="button" data-act="matchNav" data-arg="home">♟<span>Шахматы</span></button>
    </div>
    <div class="match-topbar"><div class="match-player-block"><div class="match-player">${player(bot.emoji, bot.name, bot.elo, 'clkO')}</div><div data-material="opp">${materialHTML(game?.color === 'w' ? 'b' : 'w')}</div></div><div class="match-meta"><span class="online-dot"></span><span id="matchStatus">${game.mode === 'blitz' ? 'Блиц' : game.rated ? 'Рейтинг' : 'Без рейтинга'} · ${time ? time + ' мин' : 'Без времени'}</span></div></div>
    <div id="say" class="match-say say">Ваш ход</div>
    <div class="match-controls"><button class="icon-action" data-act="pause">⏸ Пауза</button><button class="icon-action" data-act="flip">⇅ Доска</button><button class="icon-action" data-act="matchSettings">⚙ Настройки</button>${game.allowUndo ? '<button class="icon-action" data-act="onlineUndo">↶ Отмена</button>' : ''}<button class="icon-action danger" data-act="resign">⚑ Сдаться</button></div>
    <div class="match-tabs"><button class="on" data-act="matchTab" data-arg="moves">Ходы</button><button data-act="matchTab" data-arg="chat">Чат</button><button data-act="matchTab" data-arg="info">Информация</button></div><div id="matchTabPane" class="match-tab-pane" data-match-pane></div>
    <div class="match-actions-bottom"><button type="button" data-act="pause">½ Пауза</button><button type="button" class="danger-link" data-act="resign">⚑ Сдаться</button><span id="connState">● В сети</span></div>
    <div class="match-self-block"><div class="match-player match-self">${player(avatar(), profile.name, profile.elo, 'clkM')}</div><div data-material="own">${materialHTML(color)}</div></div>` : `${player(bot.emoji, bot.name, bot.elo, 'clkO')}<div id="say" class="say">Ваш ход</div>
    <div class="row"><button data-act="undo">↶ Отмена хода${ad}</button><button data-act="tip">💡 Подсказка${ad}</button><button data-act="flip">⇅</button><button class="danger" data-act="resign">Сдаться</button></div>
    ${tutorial ? '<div id="coach" class="coach"></div>' : ''}<div id="moves" class="moves"></div><small>${ad ? 'Подсказка и отмена хода показываются после короткого видео. ' : ''}Они делают партию учебной: рейтинг не меняется.</small>${player(avatar(), profile.name, profile.elo, 'clkM')}`;
  boardLayout(side, tutorial || profile.hints, { online: !!online });
  board.setPosition(state, { orientation: color });
  board.onMove = playMove;
  if (online) {
    renderMatchTab('moves');
    const g = game;
    Online.on({
      message: m => {
        if (game !== g || g.over) return;
        if (m.type === 'start') return;
        if (m.type === 'sync') {
          g.matchId = m.matchId || g.matchId; g.token = g.token || m.token; g.opponentConnected = m.opponentConnected !== false; g.pauseUsed = !!m.pauseUsed;
          g.bot = { name: m.opponent?.name || g.bot.name, emoji: '🌐', elo: m.opponent?.elo ?? g.bot.elo }; g.rated = m.rated !== false; g.allowUndo = !!m.allowUndo; g.takebackUsed = !!m.takebackUsed; g.mode = m.mode || g.mode; g.clock = m.clocks ? { ...m.clocks, last: Date.now() } : null; g.pausedUntil = m.pausedUntil || 0;
          restoreOnlineState(g, m.moves || []); hideReconnectOverlay(); saveOnlineSession(g); setOnlineLock(true); nextTurn();
          return;
        }
        if (m.type === 'move' && m.move && g.state.turn !== g.color && g.pausedUntil <= Date.now()) {
          const mv = Chess.legal(g.state).find(x => x.from === m.move.from && x.to === m.move.to && (x.promo || null) === (m.move.promo || null));
          if (mv) playMove(mv, true);
        } else if (m.type === 'reconnect_failed') { clearOnlineSession(); hideReconnectOverlay(); g.over = true; g.finishing = true; setOnlineLock(false); Online.close(); screens.online(); const msg = $('#onmsg'); if (msg) msg.textContent = m.text || 'Не удалось восстановить партию.'; return; } else if (m.type === 'match_end') {
          const reasonMap = { disconnect_timeout: m.result === 'win' ? 'oppDisconnect' : 'disconnectTimeout', resign: m.result === 'win' ? 'oppresign' : 'resign', timeout: m.result === 'win' ? 'oppTime' : 'timeout' };
          finish(reasonMap[m.reason] || (m.result === 'win' ? 'oppresign' : m.result === 'loss' ? 'resign' : 'draw'), m.result);
        } else if (m.type === 'takeback_request') showTakebackRequest(m.from?.name || 'Соперник');
        else if (m.type === 'takeback_declined') { g.takebackPending = false; say('Соперник отклонил отмену хода.'); }
        else if (m.type === 'takeback_state') { g.takebackPending = false; g.takebackUsed = !!m.takebackUsed; g.clock = m.clocks ? { ...m.clocks, last: Date.now() } : null; restoreOnlineState(g, m.moves || []); saveOnlineSession(g); say('Ход отменён.'); }
        else if (m.type === 'pause_request') showPauseRequest(m.seconds, m.from?.name || 'Соперник');
        else if (m.type === 'pause_declined') { g.pausePending = false; say('Соперник отклонил паузу.'); }
        else if (m.type === 'pause_error') { g.pausePending = false; say(m.text || 'Пауза сейчас недоступна.'); }
        else if (m.type === 'pause_state') setPause(m.until, m.seconds);
        else if (m.type === 'opponent_disconnected') { g.opponentConnected = false; $('#connState').textContent = '● Соперник отключён'; $('#matchStatus').textContent = 'Ожидание переподключения'; showReconnectOverlay(m.seconds || 60, false); nextTurn(); }
        else if (m.type === 'opponent_reconnected') { g.opponentConnected = true; $('#connState').textContent = '● В сети'; $('#matchStatus').textContent = `${g.mode === 'blitz' ? 'Блиц' : g.rated ? 'Рейтинг' : 'Без рейтинга'} · ${g.time ? g.time + ' мин' : 'Без времени'}`; hideReconnectOverlay(); say(g.state.turn === g.color ? 'Соперник вернулся. Ваш ход' : 'Соперник вернулся. Ход соперника…'); nextTurn(); }
        else if (m.type === 'chat') { const msg = m.message; if (!msg || (msg.clientId && g.chat.some(x => x.clientId === msg.clientId))) return; g.chat.push(msg); if (g.chat.length > 50) g.chat.splice(0, g.chat.length - 50); if (g.activeTab === 'chat') renderMatchTab('chat'); }
      },
      close: () => {
        if (game !== g || g.over || g.finishing) return;
        g.opponentConnected = false; $('#connState').textContent = '● Переподключение…'; $('#matchStatus').textContent = 'Соединение потеряно';
        showReconnectOverlay(60, true);
        const retry = () => { if (game !== g || g.over || g.finishing || Online.connected()) return; attemptReconnect(g); setTimeout(retry, 2000); };
        setTimeout(retry, 250);
      },
    });
    if (online.resume) Online.reconnect(g.matchId, g.token).catch(() => {});
  }
  board.onSelect = sq => tutorial && coach(sq);
  Platform.gameplay(true);
  if (tutorial) coach(null);
  nextTurn();
}

/* ---------- шахматные часы ---------- */
const fmt = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
function paintClocks() {
  if (!game || !game.clock || !$('#clkM')) return;
  const opp = game.color === 'w' ? 'b' : 'w';
  for (const [id, side] of [['#clkM', game.color], ['#clkO', opp]]) {
    const value = fmt(game.clock[side]);
    document.querySelectorAll(id + ', ' + (id === '#clkM' ? '#mClkM' : '#mClkO')).forEach(el => { el.textContent = value; el.classList.toggle('low', game.clock[side] < 20000); el.classList.toggle('run', game.state.turn === side && !game.over); });
  }
}
/** Списывает время с игрока, чей сейчас ход. */
function settle() {
  if (!game.clock || game.pausedUntil > Date.now()) return;
  const now = Date.now();
  game.clock[game.state.turn] -= now - game.clock.last; game.clock.last = now;
}
function startClock() {
  const g = game;
  clearInterval(g.tick);
  if (!g.clock) return;
  g.clock.last = Date.now(); paintClocks();
  g.tick = setInterval(() => {
    if (g !== game || g.over) return clearInterval(g.tick);
    if (g.reconnecting || (g.online && !g.opponentConnected)) { paintClocks(); return; }
    if (g.pausedUntil > Date.now()) { paintClocks(); return; }
    settle(); paintClocks();
    const side = g.state.turn;
    if (g.clock[side] > 0) return;
    g.clock[side] = 0; paintClocks();
    if (side === g.color) { if (g.online) Online.send({ type: 'timeout' }); finish('timeout'); }   // свой флажок объявляем сами
    else if (!g.online) finish('oppTime');                      // у бота время вышло
  }, 250);
}

function playMove(m, remote = false) {
  if (game.online && game.pausedUntil > Date.now()) return say('Партия на паузе.');
  if (game.online && !remote && game.state.turn === game.color) Online.send({ type: 'move', matchId: game.matchId, move: { from: m.from, to: m.to, promo: m.promo || null } });
  settle();
  if (m.cap) { const capturer = Chess.colorOf(m.piece); const victim = m.cap; game.captured[capturer].push(victim.toUpperCase()); }
  game.state = Chess.make(game.state, m);
  game.moves.push({ m, san: Chess.san(last(game.states), m) });
  game.states.push(game.state);
  const k = Chess.key(game.state);
  game.keys.push(k);
  board.applyMove(game.state, m);
  refreshMaterial();
  Sound.play(Chess.inCheck(game.state) ? 'check' : m.castle ? 'castle' : m.cap ? 'capture' : 'move');
  const moveEl = $('#moves'); if (moveEl) moveEl.innerHTML = movesHTML(game.moves);
  if (game.online) { saveOnlineSession(game); if (game.activeTab !== 'chat') refreshMatchTab(); }
  const end = game.keys.filter(x => x === k).length >= 3 ? 'repetition' : Chess.status(game.state);
  end ? finish(end) : nextTurn();
}

function nextTurn() {
  startClock();
  if (game.online && game.reconnecting) { board.setInteractive(null); return; }
  if (game.state.turn === game.color) {
    game.busy = false; board.setInteractive(game.color);
    say(Chess.inCheck(game.state) ? 'Вам шах! Защитите короля' : 'Ваш ход');
    if (game.tutorial && game.moves.length) coach(null, `🎓 Бот сходил ${last(game.moves).san}. Ваш ход!`);
    return;
  }
  if (game.online) { game.busy = true; board.setInteractive(null); say(game.opponentConnected ? 'Ход соперника…' : 'Соперник отключён. Ожидаем переподключения…'); return; }
  game.busy = true; board.setInteractive(null); say('Бот думает…');
  const g = game, st = game.state;
  game.timer = setTimeout(async () => {
    if (g.over) return;
    const { move } = await think(st, g.bot.depth, g.bot.noise, g.bot.rand);
    if (g === game && !g.over && g.state === st) playMove(move);
  }, 450);
}

/** Отмена: возвращаем позицию к вашему последнему ходу (откатываем ход бота и свой). */
async function undo() {
  if (!game || game.over) return;
  if (game.busy) return say('Подождите ход бота');
  if (game.moves.length < (game.color === 'w' ? 2 : 3)) return say('Пока нечего отменять');
  if (!game.tutorial && !(await Platform.rewarded())) return say('Для отмены хода нужно досмотреть видео');
  if (game.over || game.busy) return;
  for (const list of [game.moves, game.states, game.keys]) list.splice(-2);
  game.state = last(game.states); game.assisted = true;
  board.setPosition(game.state, { orientation: game.color, last: game.moves.length ? last(game.moves).m : null });
  const moveEl = $('#moves'); if (moveEl) moveEl.innerHTML = movesHTML(game.moves);
  say('Ход отменён. Партия стала учебной');
}

/** Подсказка: бот ищет лучший ход за вас и подсвечивает его синим. */
async function tip() {
  if (!game || game.over || game.busy) return;
  if (!game.tutorial && !(await Platform.rewarded())) return say('Для подсказки нужно досмотреть видео');
  if (game.over || game.busy) return;
  const { move } = AI.best(game.state, 2);
  game.assisted = true; board.showSuggestion(move);
  say(`Подсказка: ${Chess.san(game.state, move)} (синие клетки). Партия стала учебной`);
}

function finish(reason, serverResult = null) {
  if (!game || game.over || game.finishing) return;
  game.finishing = true; game.over = true; game.sessionEnded = true;
  board.setInteractive(null); clearTimeout(game.timer); clearInterval(game.tick); clearInterval(game.reconnectTimer); clearInterval(game.pauseTimer); Platform.gameplay(false);
  hideReconnectOverlay();
  const serverDriven = game.online && !!serverResult;
  if (game.online && !serverDriven && ['resign', 'timeout'].includes(reason)) Online.send({ type: reason, matchId: game.matchId });
  if (game.online) clearOnlineSession();
  setOnlineLock(false);
  const opp = game.color === 'w' ? 'b' : 'w';
  let score;
  if (game.online && serverResult) score = serverResult === 'win' ? 1 : serverResult === 'loss' ? 0 : 0.5;
  else {
    const loser = reason === 'resign' || reason === 'timeout' || reason === 'disconnectTimeout' || reason === 'serverLoss'
      ? game.color : ['oppresign', 'oppTime', 'oppDisconnect', 'serverWin'].includes(reason) ? opp
        : reason === 'checkmate' ? game.state.turn : null;
    score = loser ? (loser === game.color ? 0 : 1) : 0.5;
  }
  const rated = game.online ? game.rated !== false : !game.assisted;
  const delta = rated ? Platform.applyElo(game.bot.elo, score) : 0;
  Platform.addGame({ moves: game.moves.map(x => ({ from: x.m.from, to: x.m.to, promo: x.m.promo || null })),
    color: game.color, bot: game.bot.name, opponent: game.bot.name, online: !!game.online, score, delta, rated, mode: game.mode, date: Date.now() });
  renderHeader(); Sound.play(score === 1 ? 'win' : score === 0 ? 'lose' : 'move');
  const names = { checkmate: 'Мат', stalemate: 'Пат', fifty: 'Правило 50 ходов', insufficient: 'Недостаточно материала', repetition: 'Троекратное повторение',
    resign: 'Сдача', oppresign: 'Соперник сдался', timeout: 'Ваше время вышло', oppTime: 'У соперника вышло время',
    disconnectTimeout: 'Вы не успели переподключиться за минуту', oppDisconnect: 'Соперник не вернулся в течение минуты',
    serverLoss: 'Соединение восстановить не удалось', serverWin: 'Соперник продолжил игру после переподключения', draw: 'Ничья' };
  const title = score === 1 ? 'Победа! 🎉' : score === 0 ? 'Поражение' : 'Ничья';
  const rating = rated ? `Рейтинг: ${profile.elo} (${delta >= 0 ? '+' : ''}${delta})` : 'Учебная партия: рейтинг не изменён.';
  main.insertAdjacentHTML('beforeend', `<div class="modal"><div class="card result-card"><h2>${title}</h2><p>${names[reason] || 'Партия завершена'}. ${rating}</p>
    <div class="row"><button class="cta" data-act="analyse" data-arg="0">📊 Разбор партии</button><button data-act="again">Новая партия</button><button data-go="home">⌂ Главное меню</button></div></div></div>`);
  Online.close();
}

/* ---------- обучение и задачи ---------- */
function openTask(list, i, key, action) {
  const t = list[i];
  Platform.gameplay(true);
  boardLayout(`<h2>${t.title}</h2><p>${t.text || 'Найдите ход, который ставит мат.'}</p><div id="say" class="say"></div>
    <div class="row"><button data-act="hint">💡 Подсказка</button><button id="next" class="cta" data-act="${action}" data-arg="${i + 1}" hidden>Дальше ▶</button><button data-go="home">⌂ Главное меню</button></div>`, true);
  taskHint = t.ok ? `Сходите ${t.ok[0].slice(0, 2)}–${t.ok[0].slice(2)}` : 'Ищите шах, после которого королю некуда идти.';
  const st = Chess.fromFEN(t.fen);
  const reset = () => { board.setPosition(st, { orientation: st.turn }); board.setInteractive(st.turn); };
  reset();
  board.onMove = m => {
    board.setInteractive(null);
    const next = Chess.make(st, m);
    const ok = t.mate ? Chess.status(next) === 'checkmate' : t.ok.includes(Chess.sqName(m.from) + Chess.sqName(m.to));
    board.applyMove(next, m);
    if (ok) {
      Sound.play('correct'); say('Верно! ✓');
      if (!profile[key].includes(t.id)) profile[key].push(t.id);
      Platform.save();
      $('#next').hidden = i + 1 >= list.length;
      if (i + 1 >= list.length) {
        $('#say').insertAdjacentHTML('afterend', '<div class="success-actions"><b>🎉 Раздел завершён!</b><button data-go="home" class="cta">⌂ Вернуться в главное меню</button><button data-go="' + (key === 'lessons' ? 'learn' : 'train') + '">К списку</button></div>');
      }
    } else { Sound.play('wrong'); say('Не то. Попробуйте ещё раз'); setTimeout(reset, 800); }
  };
}

/* ---------- онлайн: подбор соперника ---------- */
let lobbyRequestId = null;
let lobbyCancelTimer = null;
async function lobby(request) {
  lobbyRequestId = request.requestId || Math.random().toString(36).slice(2);
  request = { ...request, requestId: lobbyRequestId };
  const note = html => { const el = $('#onmsg'); if (el) el.innerHTML = html; };
  note('Подключаюсь к серверу…');
  try { await Online.open(); } catch (e) { return note('Не удалось подключиться к серверу. Проверьте соединение с сервером.'); }
  Online.on({
    message: m => {
      if (m.type === 'waiting') {
        if (m.requestId && m.requestId !== lobbyRequestId) return;
        note(`Ищу соперника…${m.code ? ` Код комнаты: <b>${m.code}</b>, отправьте его другу.` : ''} <button data-act="cancel">Отмена</button>`);
      } else if (m.type === 'cancelled') {
        if (m.requestId && m.requestId !== lobbyRequestId) return;
        clearTimeout(lobbyCancelTimer); lobbyCancelTimer = null; Online.close(); screens.online();
      } else if (m.type === 'start') {
        if (m.requestId && m.requestId !== lobbyRequestId) return;
        lobbyRequestId = null; startGame(false, m);
      } else if (m.type === 'error') { note(esc(m.text)); }
    },
    close: () => { if (lobbyRequestId) note('Связь с сервером потеряна. Нажмите «Быстрая игра», чтобы попробовать снова.'); },
  });
  Online.send({ ...request, name: profile.name, elo: profile.elo });
}

/* ---------- разбор партии ---------- */
async function analyse(idx) {
  const rec = profile.history[idx];
  if (!rec) return;
  const states = [Chess.fromFEN(Chess.START)], moves = [];
  for (const r of rec.moves) {
    const m = Chess.legal(last(states)).find(x => x.from === r.from && x.to === r.to && (x.promo || null) === r.promo);
    moves.push(m); states.push(Chess.make(last(states), m));
  }
  boardLayout(`<h2>Разбор партии</h2><div id="say" class="say">Анализирую… 0%</div><div id="verdict" class="verdict"></div>
    <div class="row"><button data-act="ply" data-arg="prev">◀</button><button data-act="ply" data-arg="next">▶</button><button data-act="nexterr">К следующей ошибке</button><button data-go="home">⌂ Главное меню</button></div>
    <div id="moves" class="moves"></div>`);
  review = { states, moves, rec, rows: [], ply: 0, showBest: false };
  board.setPosition(states[0], { orientation: rec.color });
  for (let i = 0; i < moves.length; i++) {
    if (!review || review.states !== states) return;     // пользователь ушёл с экрана
    const before = AI.best(states[i], 2), played = -AI.score(states[i + 1], 1), mover = states[i].turn;
    review.rows.push({
      san: Chess.san(states[i], moves[i]), ...AI.classify(Math.max(0, before.score - played)),
      best: Chess.san(states[i], before.move), bestMove: before.move, mine: mover === rec.color,
    });
    say(`Анализирую… ${Math.round(100 * (i + 1) / moves.length)}%`);
    await new Promise(r => setTimeout(r));
  }
  const mine = review.rows.filter(r => r.mine), count = c => mine.filter(r => r.cls === c).length;
  say(`Ваши ходы: грубых ошибок ${count('blun')}, ошибок ${count('mist')}, неточностей ${count('inacc')}. Нажимайте на ходы, чтобы увидеть разбор.`);
  actions.nexterr();
}

function setPause(until, seconds) {
  if (!game || !game.online) return;
  settle();
  game.pausedUntil = until;
  if (game.pausePending) game.pauseUsed = true;
  game.pausePending = false;
  board.setInteractive(null);
  const ms = Math.max(0, until - Date.now());
  say(`⏸ Пауза: ${Math.ceil(ms / 1000)} сек.`);
  clearTimeout(game.pauseTimer);
  game.pauseTimer = setInterval(() => {
    if (!game || game.over) return clearInterval(game.pauseTimer);
    const left = Math.max(0, game.pausedUntil - Date.now());
    say(left ? `⏸ Пауза: ${Math.ceil(left / 1000)} сек.` : (game.state.turn === game.color ? 'Пауза закончилась. Ваш ход' : 'Пауза закончилась. Ход соперника…'));
    if (!left) { clearInterval(game.pauseTimer); game.pausedUntil = 0; game.clock.last = Date.now(); document.getElementById('pauseBanner')?.remove(); const pauseBtn = document.querySelector('[data-act="pause"]'); if (pauseBtn && game.pauseUsed) { pauseBtn.disabled = true; pauseBtn.textContent = '⏸ Пауза использована'; } nextTurn(); }
  }, 250);
  const oldBanner = document.getElementById('pauseBanner'); if (oldBanner) oldBanner.remove();
  $('#say')?.insertAdjacentHTML('afterend', `<div id="pauseBanner" class="pause-banner">⏸ Игра приостановлена на ${seconds} сек.</div>`);
  const pauseBtn = document.querySelector('[data-act="pause"]'); if (pauseBtn) pauseBtn.disabled = true;
}

function showTakebackRequest(from) {
  if (!game || game.over) return;
  const old=document.getElementById('takebackRequest'); if(old) old.remove();
  main.insertAdjacentHTML('beforeend', `<div class="modal" id="takebackRequest"><div class="card"><h2>↶ Отмена хода</h2><p>${esc(from)} просит отменить свой последний ход.</p><div class="row"><button class="cta" data-act="takebackAccept">Принять</button><button data-act="takebackDecline">Отклонить</button></div></div></div>`);
}

function showPauseRequest(seconds, from) {
  if (!game || game.over) return;
  game.pausePending = true;
  const old = document.getElementById('pauseRequest'); if (old) old.remove();
  main.insertAdjacentHTML('beforeend', `<div class="modal" id="pauseRequest"><div class="card"><h2>⏸ Запрос паузы</h2><p>${esc(from)} просит поставить партию на паузу на <b>${seconds} секунд</b>.</p><div class="row"><button class="cta" data-act="pauseAccept" data-arg="${seconds}">Принять</button><button data-act="pauseDecline">Отклонить</button></div></div></div>`);
}

/** Показывает ход №n: оценка простым языком и, если ход неидеален, лучший вариант. */
function showPly(n, showBest = false) {
  if (!review) return;
  const { states, moves, rows, rec } = review;
  review.ply = Math.max(0, Math.min(rows.length, n)); review.showBest = showBest;
  const r = rows[review.ply - 1], ply = showBest && r ? review.ply - 1 : review.ply;
  board.setPosition(states[ply], { orientation: rec.color, last: ply && !showBest ? moves[ply - 1] : null });
  if (showBest && r) board.showSuggestion(r.bestMove);
  $('#moves').innerHTML = movesHTML(rows, review.ply);
  const bad = r && ['inacc', 'mist', 'blun'].includes(r.cls);
  $('#verdict').innerHTML = r ? `<div class="v ${r.cls}"><b>${r.mine ? 'Ваш ход' : (rec.online ? 'Ход соперника' : 'Ход бота')}: ${r.san}</b><br>${r.icon} ${r.label}
    ${bad ? `<br>Лучше было: <b>${r.best}</b> <button data-act="showbest">${showBest ? 'Вернуть позицию' : 'Показать на доске'}</button>` : ''}</div>` : '';
}

/* ---------- обработчики кнопок ---------- */
function showLeaveMatchDialog(target) {
  if (document.querySelector('[data-leave-dialog]')) return;
  main.insertAdjacentHTML('beforeend', `<div class="modal" data-leave-dialog><div class="card leave-dialog"><h2>Партия ещё не завершена</h2><p>Если начать другую партию, текущая партия будет завершена. Для онлайн-матча это засчитается как сдача.</p><div class="row"><button data-act="cancelLeaveMatch">Продолжить партию</button><button class="cta danger" data-act="confirmLeaveMatch" data-leave-target="${esc(target)}">Завершить и перейти</button></div></div></div>`);
}

const actions = {
  level: i => { setup.level = +i; screens.play(); },
  color: c => { setup.color = c; screens.play(); },
  time: t => { setup.time = +t; screens.play(); },
  otime: t => { setup.otime = +t; screens.online(); },
  onlineMode: mode => { setup.onlineMode = mode; localStorage.setItem('chess_online_mode', mode); screens.online(); },
  blitzTime: t => { setup.friendTime = +t; localStorage.setItem('chess_friend_time', String(setup.friendTime)); screens.online(); },
  friendTime: t => { setup.friendTime = +t; localStorage.setItem('chess_friend_time', String(setup.friendTime)); screens.online(); },
  quick: () => lobby({ type: 'quick', time: setup.otime, rated: true, mode: 'quick', requestId: Math.random().toString(36).slice(2) }),
  blitz: () => lobby({ type: 'quick', time: setup.friendTime || 3, rated: true, mode: 'blitz', requestId: Math.random().toString(36).slice(2) }),
  createFriend: () => lobby({ type: 'create', time: setup.friendUntimed ? 0 : setup.friendTime, rated: setup.friendRated, allowUndo: setup.friendUndo, mode: 'friend', requestId: Math.random().toString(36).slice(2) }),
  create: () => lobby({ type: 'create', time: setup.otime, rated: true, mode: 'friend', requestId: Math.random().toString(36).slice(2) }),
  join: () => { const c = $('#code').value.trim().toUpperCase(); if (c) lobby({ type: 'join', code: c, name: profile.name, elo: profile.elo }); },
  cancel: () => {
    const id = lobbyRequestId; if (!id) return;
    const ok = Online.send({ type: 'cancel', requestId: id });
    if (!ok) { Online.close(); lobbyRequestId = null; screens.online(); return; }
    const msg = $('#onmsg'); if (msg) msg.innerHTML = 'Отменяю подбор…';
    clearTimeout(lobbyCancelTimer);
    lobbyCancelTimer = setTimeout(() => { lobbyCancelTimer = null; lobbyRequestId = null; Online.close(); screens.online(); }, 1200);
  },
  onlineUndo: async () => {
    if (!game?.online || game.over || !game.allowUndo || game.takebackUsed || game.takebackPending || !game.moves.length) return;
    if (game.state.turn === game.color) return say('Сначала дождитесь хода соперника.');
    game.takebackPending = true; say('Подготавливаем отмену хода…');
    const ok = await Platform.rewarded();
    if (!ok || !game || game.over) { game.takebackPending = false; return say('Реклама не была просмотрена.'); }
    Online.send({ type: 'takeback_request', matchId: game.matchId });
    say('Запрос отмены отправлен сопернику…');
  },
  takebackAccept: () => { const modal=document.getElementById('takebackRequest'); modal?.remove(); if (!game?.online || game.over) return; Online.send({type:'takeback_response',matchId:game.matchId,accept:true}); },
  takebackDecline: () => { const modal=document.getElementById('takebackRequest'); modal?.remove(); if (!game?.online || game.over) return; Online.send({type:'takeback_response',matchId:game.matchId,accept:false}); },
  pause: () => {
    if (!game || !game.online || game.over || game.pauseUsed || game.pausePending || game.pausedUntil > Date.now()) return;
    main.insertAdjacentHTML('beforeend', `<div class="modal" id="pauseChooser"><div class="card"><h2>⏸ Запрос паузы</h2><p>Выберите длительность. Соперник должен подтвердить запрос.</p><div class="row"><button data-act="pauseChoose" data-arg="30">30 сек</button><button class="cta" data-act="pauseChoose" data-arg="60">60 сек</button><button data-act="pauseChoose" data-arg="120">120 сек</button><button data-act="pauseCancel">Отмена</button></div></div></div>`);
  },
  pauseChoose: seconds => {
    const modal = document.getElementById('pauseChooser'); if (modal) modal.remove();
    if (!game || !game.online || game.over || game.pauseUsed || game.pausePending) return;
    game.pausePending = true; say('Запрос паузы отправлен…');
    Online.send({ type: 'pause_request', matchId: game.matchId, seconds: Number(seconds) || 60 });
  },
  pauseCancel: () => { const modal = document.getElementById('pauseChooser'); if (modal) modal.remove(); },
  pauseAccept: seconds => {
    const modal = document.getElementById('pauseRequest'); if (modal) modal.remove();
    if (!game || !game.online || game.over) return;
    game.pausePending = false;
    Online.send({ type: 'pause_response', matchId: game.matchId, accept: true, seconds: Number(seconds) || 60 });
  },
  pauseDecline: () => {
    const modal = document.getElementById('pauseRequest'); if (modal) modal.remove();
    if (!game || !game.online || game.over) return;
    game.pausePending = false; Online.send({ type: 'pause_response', matchId: game.matchId, accept: false });
  },
  matchSettings: () => {
    if (!game?.online || game.over) return;
    const old = document.getElementById('matchSettings'); if (old) old.remove();
    main.insertAdjacentHTML('beforeend', `<div class="modal" id="matchSettings"><div class="card match-settings-card"><div class="section-title"><span>⚙ Настройки</span><button data-act="closeMatchSettings" aria-label="Закрыть">✕</button></div><label>Фигуры<select data-setting="pieceSet"><option value="neo" ${setup.pieceSet==='neo'?'selected':''}>Neo</option><option value="classic" ${setup.pieceSet==='classic'?'selected':''}>Classic</option><option value="outline" ${setup.pieceSet==='outline'?'selected':''}>Outline</option></select></label><label>Доска<select data-setting="boardTheme"><option value="green" ${setup.boardTheme==='green'?'selected':''}>Зелёный</option><option value="brown" ${setup.boardTheme==='brown'?'selected':''}>Коричневый</option><option value="blue" ${setup.boardTheme==='blue'?'selected':''}>Синий</option></select></label><label>Координаты<select data-setting="coords"><option value="yes" ${setup.coords?'selected':''}>Да</option><option value="no" ${!setup.coords?'selected':''}>Нет</option></select></label><label class="settings-check"><input type="checkbox" data-setting="sound" ${profile.sound?'checked':''}> Звуки</label><p class="settings-note">Настройки применяются сразу. Они влияют только на ваш интерфейс и не меняют состояние партии.</p><button class="cta" data-act="closeMatchSettings">Готово</button></div></div>`);
  },
  closeMatchSettings: () => document.getElementById('matchSettings')?.remove(),
  matchTab: tab => renderMatchTab(tab),
  mobilePanel: () => { const m = document.getElementById('mobileMatchPanel'); if (m) { m.hidden = false; renderMatchTab(game?.activeTab || 'moves'); } },
  closeMobilePanel: () => { const m = document.getElementById('mobileMatchPanel'); if (m) m.hidden = true; },
  chatSend: (form = null) => {
    if (!game?.online || game.over) return false;
    const root = form || document.activeElement?.closest?.('[data-chat-form]') || document.querySelector('.mobile-match-modal:not([hidden]) [data-chat-form]') || document.querySelector('.match-side [data-chat-form]');
    const input = root?.querySelector('[data-chat-input]') || document.querySelector('[data-chat-input]:not([disabled])');
    const text = input?.value.trim();
    if (!text) return false;
    const message = { type: 'chat', matchId: game.matchId, clientId: `${Date.now()}-${Math.random().toString(36).slice(2,7)}`, text: text.slice(0, 300) };
    const sent = Online.send(message);
    if (sent) { input.value = ''; input.focus(); }
    else say('Связь восстанавливается — сообщение будет отправлено автоматически.');
    return sent;
  },
  setting: (key, el) => {
    const map = {
      pieceSet: () => { setup.pieceSet = el.value; localStorage.setItem('chess_piece_set', setup.pieceSet); },
      boardTheme: () => { setup.boardTheme = el.value; localStorage.setItem('chess_board_theme', setup.boardTheme); },
      opponentTheme: () => { setup.opponentTheme = el.checked ? 'light' : 'dark'; localStorage.setItem('chess_opponent_theme', setup.opponentTheme); },
      specialThemes: () => { setup.specialThemes = el.checked; localStorage.setItem('chess_special_themes', el.checked ? '1' : '0'); },
      coords: () => { setup.coords = el.value === 'yes'; localStorage.setItem('chess_coords', setup.coords ? '1' : '0'); },
      sound: () => { profile.sound = !!el.checked; Sound.setEnabled(profile.sound); Platform.save(); },
      friendRated: () => { setup.friendRated = !!el.checked; localStorage.setItem('chess_friend_rated', setup.friendRated ? '1' : '0'); screens.online(); },
      friendUntimed: () => { setup.friendUntimed = !!el.checked; localStorage.setItem('chess_friend_untimed', setup.friendUntimed ? '1' : '0'); screens.online(); },
      friendUndo: () => { setup.friendUndo = !!el.checked; localStorage.setItem('chess_friend_undo', setup.friendUndo ? '1' : '0'); screens.online(); },
    };
    map[key]?.();
    const preview = document.querySelector('[data-preview-board]');
    if (preview) preview.dataset.theme = setup.boardTheme;
    if (game?.online && board) board.setAppearance({ pieceSet: setup.pieceSet, theme: setup.boardTheme, coords: setup.coords });
  },
  matchNav: (where) => {
    if (!game || game.over) { if (where === 'home') go('home'); else if (where === 'games') go('games'); else if (where === 'new') go('play'); return; }
    if (where === 'home') return showLeaveMatchDialog('home');
    if (where === 'games') return showLeaveMatchDialog('games');
    if (where === 'new' || where === 'play') return showLeaveMatchDialog('play');
  },
  confirmLeaveMatch: () => { const target = document.querySelector('[data-leave-target]')?.dataset.leaveTarget || 'play'; document.querySelector('[data-leave-dialog]')?.remove(); if (game && !game.over) { if (game.online) Online.send({ type: 'resign', matchId: game.matchId }); finish('resign'); } go(target); },
  cancelLeaveMatch: () => document.querySelector('[data-leave-dialog]')?.remove(),
  start: () => startGame(false), tutorial: () => startGame(true), undo, tip,
  showbest: () => review && showPly(review.ply, !review.showBest),
  nexterr: () => {
    if (!review) return;
    const i = review.rows.findIndex((r, k) => k >= review.ply && r.mine && ['inacc', 'mist', 'blun'].includes(r.cls));
    if (i < 0) { say('Больше ошибок нет 👍'); if (!review.ply) showPly(1); } else showPly(i + 1);
  },
  flip: () => board.flip(),
  resign: (_, el) => {
    if (!game || game.over) return;
    if (el.dataset.sure) { if (game.online) Online.send({ type: 'resign' }); return finish('resign'); }
    el.dataset.sure = 1; el.textContent = 'Точно сдаться?';
    setTimeout(() => { delete el.dataset.sure; el.textContent = 'Сдаться'; }, 3000);
  },
  analyse: i => analyse(+i),
  again: async () => { await Platform.showAd(); go('play'); },
  lesson: i => (+i < LESSONS.length ? openTask(LESSONS, +i, 'lessons', 'lesson') : go('learn')),
  puzzle: i => (+i < PUZZLES.length ? openTask(PUZZLES, +i, 'puzzles', 'puzzle') : go('train')),
  hint: () => say(taskHint),
  ply: a => review && showPly(a === 'prev' ? review.ply - 1 : a === 'next' ? review.ply + 1 : +a),
  nick: () => {
    const v = $('#nick').value.trim();
    if (v) { profile.name = v.slice(0, 14); Platform.save(); renderHeader(); screens.profile(); }
  },
  yandex: async () => {
    const ok = await Platform.loginYandex();
    if (ok) { profile = Platform.profile(); Sound.setEnabled(profile.sound); renderHeader(); screens.profile(); }
    else $('#loginMsg').textContent = Platform.hasSdk() ? 'Не удалось войти' : 'Вход доступен внутри Яндекс Игр';
  },
  toggle: (key, el) => {
    profile[key] = el.checked;
    if (key === 'sound') Sound.setEnabled(el.checked);
    Platform.save();
  },
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-go],[data-act]');
  if (!el) return;
  if (game?.online && !game.over && el.dataset.go) return;
  Sound.play('click');
  if (el.dataset.go) go(el.dataset.go); else actions[el.dataset.act]?.(el.dataset.arg, el);
});

document.addEventListener('submit', e => {
  const form = e.target.closest('[data-chat-form]');
  if (!form) return;
  e.preventDefault();
  actions.chatSend(form);
});

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.activeElement?.matches('[data-chat-input]')) { e.preventDefault(); actions.chatSend(); }
});

document.addEventListener('change', e => {
  const el = e.target.closest('[data-setting]');
  if (!el) return;
  actions.setting(el.dataset.setting, el);
});

/* ---------- звук отключается при потере фокуса, меню по долгому нажатию запрещено ---------- */
const syncFocus = () => {
  Sound.mute('focus', document.hidden || !document.hasFocus());
  if (!document.hidden && game?.online && !game.over && !Online.connected() && game.token) {
    showReconnectOverlay(60, true);
    Online.reconnect(game.matchId, game.token).catch(() => {});
  }
};
document.addEventListener('visibilitychange', syncFocus);
addEventListener('blur', syncFocus);
addEventListener('focus', syncFocus);
document.addEventListener('contextmenu', e => { if (e.target.tagName !== 'INPUT') e.preventDefault(); });

/* ---------- запуск ---------- */
const finishStartup = () => {
  const overlay = document.getElementById('startupOverlay');
  if (overlay) {
    overlay.classList.add('done');
    setTimeout(() => overlay.remove(), 350);
  }
};

Platform.init().then(p => {
  document.documentElement.lang = Platform.lang();
  document.title = GAME_TITLE; $('#brand').textContent = '♞ ' + GAME_TITLE;
  profile = p; Sound.setEnabled(p.sound); renderHeader();
  go(p.seen ? 'home' : 'welcome');
  const savedOnline = loadOnlineSession();
  if (savedOnline && Date.now() - (savedOnline.refreshedAt || savedOnline.savedAt || 0) < 2 * 60 * 60 * 1000) startGame(false, { ...savedOnline, resume: true });
  else if (savedOnline) clearOnlineSession();
  Platform.ready();
  finishStartup();
}).catch(err => {
  console.error('Chess app startup failed', err);
  const msg = document.createElement('div'); msg.className = 'card narrow'; msg.style.margin = '40px auto';
  msg.innerHTML = '<h2>Не удалось запустить игру</h2><p>Обновите страницу. Если проблема останется, пришлите ошибку из консоли браузера.</p><pre style="white-space:pre-wrap">' + esc(err?.stack || err?.message || err) + '</pre>';
  main.innerHTML = ''; main.appendChild(msg);
  finishStartup();
});
