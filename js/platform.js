/* platform.js — Яндекс SDK (вход, облачные сохранения, реклама), профиль игрока и рейтинг Elo.
   Если SDK недоступен, всё работает через localStorage. */
const Platform = (() => {
  const DEFAULT = {
    name: 'Игрок', photo: '', elo: 800, games: 0, wins: 0, losses: 0, draws: 0,
    sound: true, hints: true, seen: false, lessons: [], puzzles: [], history: [],
  };
  let sdk = null, player = null, profile = { ...DEFAULT }, lang = 'ru', platformPaused = false;

  async function init() {
    try {
      if (window.YaGames) {
        // Не блокируем запуск игры, если SDK недоступен или его инициализация
        // не отвечает (например, при запуске на GitHub Pages).
        const initPromise = YaGames.init();
        sdk = await Promise.race([
          initPromise,
          new Promise((_, reject) => setTimeout(() => reject(new Error('Yandex SDK init timeout')), 4000))
        ]);
        try { lang = sdk.environment.i18n.lang || 'ru'; } catch (e) { lang = 'ru'; }
        try { player = await sdk.getPlayer({ scopes: false }); } catch (e) { player = null; }
        sdk.on('game_api_pause', () => {
          platformPaused = true;
          Sound.mute('pause', true);
          try { sdk.features?.GameplayAPI?.stop(); } catch (e) {}
        });
        sdk.on('game_api_resume', () => {
          platformPaused = false;
          Sound.mute('pause', false);
          try { if (playing) sdk.features?.GameplayAPI?.start(); } catch (e) {}
        });
      } else {
        try { lang = (navigator.language || 'ru').slice(0,2).toLowerCase(); } catch (e) { lang = 'ru'; }
      }
    } catch (e) { /* работаем без SDK */ }
    let data = null;
    try { data = JSON.parse(localStorage.getItem('chess_profile')); } catch (e) { /* пусто */ }
    if (player) {
      try { const r = await player.getData(['profile']); if (r.profile) data = r.profile; } catch (e) { /* пусто */ }
      try { if (player.isAuthorized?.()) { data = { ...(data || {}), name: player.getName() || (data || {}).name, photo: player.getPhoto('medium') || (data || {}).photo }; } } catch (e) { /* гостевой режим */ }
    }
    profile = { ...DEFAULT, ...data };
    return profile;
  }

  /** Автосохранение: локально и в облако Яндекса. */
  function save() {
    try { localStorage.setItem('chess_profile', JSON.stringify(profile)); } catch (e) { /* пусто */ }
    if (player) try { player.setData({ profile }, true).catch(() => {}); } catch (e) { /* пусто */ }
  }

  async function loginYandex() {
    if (!sdk) return false;
    try {
      if (!player || !player.isAuthorized?.()) {
        await sdk.auth.openAuthDialog();
        player = await sdk.getPlayer({ scopes: false });
      }
      const r = await player.getData(['profile']);
      if (r.profile) profile = { ...DEFAULT, ...r.profile };
      profile.name = player.getName() || profile.name;
      profile.photo = player.getPhoto('medium') || '';
      save();
      return true;
    } catch (e) { return false; }
  }

  /** Elo: score 1 — победа, 0.5 — ничья, 0 — поражение. Возвращает изменение рейтинга. */
  function applyElo(opponentElo, score) {
    const k = profile.games < 30 ? 40 : 24;
    const expected = 1 / (1 + Math.pow(10, (opponentElo - profile.elo) / 400));
    const delta = Math.round(k * (score - expected));
    profile.elo = Math.max(100, profile.elo + delta);
    profile.games++;
    if (score === 1) profile.wins++; else if (score === 0) profile.losses++; else profile.draws++;
    save();
    submitScore();
    return delta;
  }

  function addGame(record) { profile.history = [record, ...profile.history].slice(0, 10); save(); }
  const CONFIG = { adCooldownMs: 90000, rewardedAssist: true, leaderboard: 'elo' };
  let lastAd = Date.now(), playing = false;

  /** Сообщает платформе, идёт ли игровой процесс (GameplayAPI.start/stop). */
  function gameplay(on) {
    if (platformPaused) return;
    if (on === playing) return;
    playing = on;
    try { const api = sdk && sdk.features.GameplayAPI; if (api) on ? api.start() : api.stop(); } catch (e) { /* пусто */ }
  }

  /** Game Ready: вызываем, когда игрок уже может начать играть (первый экран показан). */
  function ready() {
    try { sdk && sdk.features.LoadingAPI && sdk.features.LoadingAPI.ready(); } catch (e) { /* пусто */ }
  }

  /** Показ рекламы: на время ролика глушим звук и останавливаем игровой процесс. Возвращает true, если награда получена. */
  function runAd(show) {
    return new Promise(resolve => {
      const wasPlaying = playing;
      let rewarded = false, failed = false;
      const done = () => { lastAd = Date.now(); Sound.mute('ad', false); if (wasPlaying) gameplay(true); resolve(rewarded || failed); };
      Sound.mute('ad', true); gameplay(false);
      try { show({ onRewarded: () => { rewarded = true; }, onClose: done, onError: () => { failed = true; done(); } }); } catch (e) { failed = true; done(); }
    });
  }
  /** Обычная реклама между партиями (не чаще, чем раз в adCooldownMs). */
  const showAd = () => (!sdk || !sdk.adv || Date.now() - lastAd < CONFIG.adCooldownMs
    ? Promise.resolve(false) : runAd(callbacks => sdk.adv.showFullscreenAdv({ callbacks })));
  /** Реклама за награду (подсказка, отмена хода). Вне Яндекс Игр разрешает сразу; при ошибке показа тоже не блокирует игрока. */
  const rewarded = () => (!sdk || !sdk.adv || !CONFIG.rewardedAssist
    ? Promise.resolve(true) : runAd(callbacks => sdk.adv.showRewardedVideo({ callbacks })));

  /** Отправка рейтинга в таблицу лидеров (только для авторизованных игроков). */
  async function submitScore() {
    try {
      const ok = sdk && player && player.isAuthorized?.() && await sdk.isAvailableMethod('leaderboards.setScore');
      if (ok) await sdk.leaderboards.setScore(CONFIG.leaderboard, profile.elo);
    } catch (e) { /* пусто */ }
  }
  /** Топ-10 и место игрока; null, если таблица недоступна. */
  async function leaderboard() {
    if (!sdk) return null;
    try {
      const res = await sdk.leaderboards.getEntries(CONFIG.leaderboard, { quantityTop: 10, includeUser: true, quantityAround: 2 });
      return res.entries.map(e => ({ rank: e.rank, score: e.score, name: (e.player && e.player.publicName) || 'Игрок' }));
    } catch (e) { return null; }
  }

  return { lang: () => lang, profile: () => profile, init, ready, gameplay, save, loginYandex, applyElo, addGame, showAd, rewarded, leaderboard, CONFIG, hasSdk: () => !!sdk, authorized: () => !!(player && player.isAuthorized?.()) }; 
})();
