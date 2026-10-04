/* sound.js — звуки, синтезируются в браузере (без файлов). Отключаются в настройках профиля. */
const Sound = (() => {
  let ctx = null, enabled = true;
  const muted = new Set();           // причины временного отключения: 'ad', 'pause', 'focus'

  function tone(freq, duration = 0.08, type = 'sine', volume = 0.15, delay = 0) {
    if (!enabled || muted.size) return;
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
      const osc = ctx.createOscillator(), gain = ctx.createGain(), t = ctx.currentTime + delay;
      osc.type = type; osc.frequency.value = freq;
      gain.gain.setValueAtTime(volume, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(t); osc.stop(t + duration);
    } catch (e) { /* звук недоступен — не критично */ }
  }
  const run = (notes, type = 'sine', step = 0.12) => notes.forEach((f, i) => tone(f, 0.2, type, 0.15, i * step));

  const sounds = {
    move: () => tone(210, 0.07, 'triangle', 0.3),
    capture: () => { tone(160, 0.1, 'square', 0.1); tone(95, 0.14, 'triangle', 0.3); },
    castle: () => { tone(210, 0.07, 'triangle', 0.3); tone(250, 0.07, 'triangle', 0.3, 0.1); },
    check: () => { tone(660, 0.08); tone(880, 0.12, 'sine', 0.15, 0.09); },
    click: () => tone(500, 0.03, 'sine', 0.06),
    correct: () => run([660, 880]),
    wrong: () => run([220, 160], 'sawtooth', 0.1),
    win: () => run([523, 659, 784, 1047]),
    lose: () => run([392, 330, 262], 'triangle', 0.15),
  };

  return { play: name => sounds[name] && sounds[name](), setEnabled: v => { enabled = !!v; }, mute: (why, on) => { if (on) muted.add(why); else muted.delete(why); } };
})();
