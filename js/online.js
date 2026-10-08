/* online.js — устойчивый WebSocket-клиент: очередь, чат, переподключение. */
const Online = (() => {
  let ws = null, handlers = {}, generation = 0, intentionalClose = false, pending = [], connectTimer = null;
  function open() {
    if (ws && ws.readyState === WebSocket.OPEN) return Promise.resolve();
    if (!ONLINE_URL) return Promise.reject(new Error('not-configured'));
    const myGen = ++generation; intentionalClose = false;
    return new Promise((resolve, reject) => {
      let done = false;
      const fail = err => { if (done) return; done = true; clearTimeout(connectTimer); try { ws?.close(); } catch (_) {} reject(err); };
      try { ws = new WebSocket(ONLINE_URL); } catch (e) { fail(e); return; }
      connectTimer = setTimeout(() => fail(new Error('timeout')), 9000);
      ws.onopen = () => { if (done) return; done = true; clearTimeout(connectTimer); connectTimer = null; resolve(); flush(); };
      ws.onerror = () => fail(new Error('connect'));
      ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (_) { return; } if (handlers.message) handlers.message(m); };
      ws.onclose = () => { clearTimeout(connectTimer); connectTimer = null; if (myGen === generation && !intentionalClose) handlers.close?.(); };
    });
  }
  function flush() {
    if (!ws || ws.readyState !== WebSocket.OPEN || !pending.length) return;
    const q = pending.splice(0, pending.length); q.forEach(m => { try { ws.send(JSON.stringify(m)); } catch (_) { pending.unshift(m); } });
  }
  function send(m) {
    if (ws && ws.readyState === WebSocket.OPEN) { try { ws.send(JSON.stringify(m)); return true; } catch (_) {} }
    if (m?.type === 'chat') { if (pending.length >= 30) pending.shift(); pending.push(m); }
    return false;
  }
  async function reconnect(matchId, token) { await open(); return send({ type: 'reconnect', matchId, token }); }
  function close() { intentionalClose = true; pending = []; handlers = {}; generation++; if (ws) { try { ws.close(); } catch (_) {} } ws = null; }
  function on(h) { handlers = h || {}; intentionalClose = false; }
  return { open, reconnect, send, close, on, available: () => !!ONLINE_URL, connected: () => !!(ws && ws.readyState === WebSocket.OPEN) };
})();
