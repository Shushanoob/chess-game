/* worker.js — бот в фоновом потоке: тяжёлый поиск ходов не замораживает интерфейс. */
importScripts('engine.js', 'ai.js');
onmessage = e => {
  const { id, state, depth, noise, rand } = e.data;
  postMessage({ id, result: AI.best(state, depth, noise, rand) });
};
