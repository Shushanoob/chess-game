/* platform.js — Яндекс SDK (вход, облачные сохранения, реклама), профиль игрока и рейтинг Elo.
   Если SDK недоступен, всё работает через localStorage. */
const Platform = (() => {
  const DEFAULT = {
    name: 'Игрок', photo: '', elo: 800, games: 0, wins: 0, losses: 0, draws: 0,
    sound: true, hints: true, seen: false, lessons: [], puzzles: [], history: [], settings: {}, saveVersion: 1, updatedAt: 0,
  };
  let sdk = null, player = null, profile = { ...DEFAULT }, lang = 'ru', platformPaused = false;
  let saveQueue = Promise.resolve();
  const SAVE_KEY = 'chess_profile';

  function normalize(data) {
    const x = data && typeof data === 'object' ? data : {};
    return { ...DEFAULT, ...x, settings: { ...(DEFAULT.settings || {}), ...(x.settings || {}) }, saveVersion: 1 };
  }

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
    let localData = null, cloudData = null;
    try { localData = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { /* пусто */ }
    if (player) {
      try { const r = await player.getData(['profile']); if (r.profile) cloudData = r.profile; } catch (e) { /* облако недоступно — используем локальные данные */ }
    }
    let data = localData;
    if (cloudData && (!localData || Number(cloudData.updatedAt || 0) >= Number(localData.updatedAt || 0))) data = cloudData;
    try { if (player?.isAuthorized?.()) { data = { ...(data || {}), name: player.getName() || (data || {}).name, photo: player.getPhoto('medium') || (data || {}).photo }; } } catch (e) { /* гостевой режим */ }
    profile = normalize(data);
    return profile;
  }

  /** Автосохранение: локально и в облако Яндекса. Облако является основным хранилищем, localStorage — резервным. */
  function save() {
    profile.updatedAt = Date.now();
    profile.saveVersion = 1;
    const snapshot = JSON.parse(JSON.stringify(profile));
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(snapshot)); } catch (e) { /* резервное хранилище недоступно */ }
    if (!player) return;
    saveQueue = saveQueue.catch(() => {}).then(() => player.setData({ profile: snapshot }, true)).catch(() => {});
  }

  function saveSettings(settings) {
    profile.settings = { ...(profile.settings || {}), ...(settings || {}) };
    save();
  }

  async function loginYandex() {
    if (!sdk) return false;
    try {
      const beforeAuth = normalize(profile);
      if (!player || !player.isAuthorized?.()) {
        await sdk.auth.openAuthDialog();
        player = await sdk.getPlayer({ scopes: false });
      }
      const r = await player.getData(['profile']);
      const cloud = r?.profile ? normalize(r.profile) : null;
      if (cloud && Number(cloud.updatedAt || 0) > Number(beforeAuth.updatedAt || 0)) {
        profile = cloud;
      } else {
        // Если это первый вход и облако пустое/старое, переносим текущий гостевой прогресс в аккаунт.
        profile = beforeAuth;
      }
      profile.name = player.getName() || profile.name;
      profile.photo = player.getPhoto('medium') || profile.photo || '';
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
  const CONFIG = { adCooldownMs: 90000, rewardedAssist: true, leaderboards: { elo: 'elo' }, analysisFreePerDay: 2 };
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
  const rewardedStrict = () => (!sdk || !sdk.adv || !CONFIG.rewardedAssist ? Promise.resolve(true) : new Promise(resolve => {
    const wasPlaying = playing; let rewardedOk = false, closed = false;
    const finishAd = () => { if (closed) return; closed = true; Sound.mute('ad', false); if (wasPlaying) gameplay(true); resolve(rewardedOk); };
    Sound.mute('ad', true); gameplay(false);
    try { sdk.adv.showRewardedVideo({ callbacks: { onRewarded: () => { rewardedOk = true; }, onClose: finishAd, onError: finishAd } }); }
    catch (e) { finishAd(); }
  }));

  /** Отправка рейтинга Elo в Яндекс Игры. Работает только для авторизованных игроков. */
  async function submitScore() {
    try {
      const ok = sdk && player && player.isAuthorized?.() && await sdk.isAvailableMethod('leaderboards.setScore');
      if (!ok) return;
      await sdk.leaderboards.setScore(CONFIG.leaderboards.elo, profile.elo);
    } catch (e) { /* лидерборд может быть ещё не создан в Консоли */ }
  }
  /** Топ-10 выбранного рейтинга. Не маскируем 404: он означает, что лидерборд с таким техническим именем ещё не создан в Консоли Яндекс Игр. */
  async function leaderboard(kind = 'elo') {
    if (!sdk) return { entries: null, code: 'SDK_UNAVAILABLE', name: null };
    const name = CONFIG.leaderboards[kind] || CONFIG.leaderboards.elo;
    try {
      const res = await sdk.leaderboards.getEntries(name, { quantityTop: 10, includeUser: true, quantityAround: 2 });
      return { entries: res.entries.map(e => ({ rank: e.rank, score: e.score, name: (e.player && e.player.publicName) || 'Игрок' })), code: null, name };
    } catch (e) {
      const code = e?.code || e?.status || (String(e?.message || e).match(/404/) ? 404 : 'LEADERBOARD_ERROR');
      return { entries: null, code, name, error: String(e?.message || e) };
    }
  }
  /** Два бесплатных разбора партии в сутки, далее — rewarded video. */
  async function analysisAccess() {
    if (!sdk || !sdk.adv) return true;
    const today = new Date().toISOString().slice(0, 10);
    const a = profile.analysisUsage || { date: today, freeUsed: 0 };
    if (a.date !== today) { a.date = today; a.freeUsed = 0; }
    if (a.freeUsed < CONFIG.analysisFreePerDay) {
      a.freeUsed++; profile.analysisUsage = a; save(); return true;
    }
    const ok = await rewardedStrict();
    if (!ok) return false;
    return true;
  }

  return { lang: () => lang, profile: () => profile, init, ready, gameplay, save, saveSettings, loginYandex, applyElo, addGame, showAd, rewarded, analysisAccess, leaderboard, submitScore, CONFIG, hasSdk: () => !!sdk, authorized: () => !!(player && player.isAuthorized?.()) }; 
})();
