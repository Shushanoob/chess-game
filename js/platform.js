/* platform.js — Яндекс SDK (вход, облачные сохранения, реклама), профиль игрока и рейтинг Elo.
   Если SDK недоступен, всё работает через localStorage. */
const Platform = (() => {
  const DEFAULT = {
    name: 'Игрок', photo: '', elo: 800, games: 0, wins: 0, losses: 0, draws: 0,
    sound: true, hints: true, seen: false, lessons: [], puzzles: [], history: [],
  };
  let sdk = null, player = null, profile = { ...DEFAULT }, lang = 'ru';

  async function init() {
    try {
      if (window.YaGames) {
        sdk = await YaGames.init();
        player = await sdk.getPlayer({ scopes: false });
        try { lang = sdk.environment.i18n.lang || 'ru'; } catch (e) { /* язык по умолчанию */ }   // автоопределение языка
        sdk.on('game_api_pause', () => Sound.mute('pause', true));   // платформа ставит игру на паузу
        sdk.on('game_api_resume', () => Sound.mute('pause', false));
      }
    } catch (e) { /* работаем без SDK */ }
    let data = null;
    try { data = JSON.parse(localStorage.getItem('chess_profile')); } catch (e) { /* пусто */ }
    if (player) {
      try { const r = await player.getData(['profile']); if (r.profile) data = r.profile; } catch (e) { /* пусто */ }
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
      if (player.getMode() === 'lite') {
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
      const ok = sdk && player.getMode() !== 'lite' && await sdk.isAvailableMethod('leaderboards.setScore');
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

  return { lang: () => lang, profile: () => profile, init, ready, gameplay, save, loginYandex, applyElo, addGame, showAd, rewarded, leaderboard, CONFIG, hasSdk: () => !!sdk };
})();
