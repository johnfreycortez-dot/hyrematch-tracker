// The tracker's logic, with no Electron in it so it can be tested in plain Node (test/engine.test.js).
// It is given: a clock, "seconds since the last mouse or keyboard use", a screen capture, and a way to call the server.
//
// Every TICK seconds while tracking, the tick counts as active or idle. Ticks are grouped in 10-minute blocks
// (10:00, 10:10, ...). Every 2 minutes the app CHECKS IN with the server (track.beat): it says how idle the computer is
// right now and sends the running totals of the current block, plus any finished blocks that haven't been sent yet.
// If the check-ins stop (no internet, app closed, computer off) HyreMatch sees "Disconnected" after about 5 minutes.
// Nothing is counted while the person is clocked out, on lunch or on a break: the server says so (track.me / the answer
// to every check-in).

const TICK = 15; // seconds
const IDLE_AFTER = 60; // no mouse or keyboard for this many seconds = idle
const QUEUE_MAX = 150; // finished blocks kept while offline (about 25 hours)
const BATCH = 17; // finished blocks per check-in (the server takes 18 with the current one)
const RETRY = 60000; // while offline, try again this often

function createEngine({ now, idleSeconds, capture, call, onChange = () => {} }) {
  let view = null; // the last answer from the server
  let block = null; // { ms, active, idle, shotAt, shots: [{ at, screen, data }] | null, shotsSent }
  let queue = []; // finished blocks not confirmed by the server yet
  let lastError = '';
  let sending = false;
  let lastPing = 0; // the last check-in the server answered
  let lastTry = 0;
  let online = null; // null = not tried yet
  const step = () => ((view && view.blockMin) || 10) * 60000;
  const pingMs = () => ((view && view.pingMin) || 2) * 60000;
  const tracking = () => !!(view && view.tracking);

  function closeBlock() {
    const b = block;
    block = null;
    if (!b || b.active + b.idle < TICK) return;
    queue.push({ start: new Date(b.ms).toISOString(), activeSec: b.active, idleSec: b.idle, shots: b.shots && !b.shotsSent ? b.shots : null });
    if (queue.length > QUEUE_MAX) queue = queue.slice(-QUEUE_MAX);
  }

  // Called every TICK seconds.
  async function tick() {
    const t = now();
    const ms = Math.floor((t - TICK * 1000) / step()) * step(); // a tick stands for the TICK seconds before it
    if (block && block.ms !== ms) closeBlock();
    if (!tracking()) { closeBlock(); await sync(); return; }
    // One screenshot moment per block, at a random time between minute 1 and minute 8.
    if (!block) block = { ms, active: 0, idle: 0, shots: null, shotsSent: false, shotAt: ms + (60 + Math.floor(Math.random() * 420)) * 1000 };
    const idle = idleSeconds() >= IDLE_AFTER;
    if (idle) block.idle += TICK; else block.active += TICK;
    const cap = step() / 1000;
    if (block.active + block.idle > cap) { if (idle) block.idle = cap - block.active; else block.active = cap - block.idle; }
    // Only when this person's client uses screen monitoring (view.shots), and only while active.
    if (view.shots && !block.shots && !idle && t >= block.shotAt) {
      block.shotAt = Infinity; // one try per block
      try {
        const got = await capture(view.screens || 3); // one JPEG per monitor
        const list = (Array.isArray(got) ? got : got ? [got] : []).filter(Boolean).slice(0, view.screens || 3);
        if (list.length) block.shots = list.map((data, i) => ({ at: new Date(t).toISOString(), screen: i + 1, data }));
      } catch (e) { /* no screenshot this block */ }
    }
    onChange();
    await sync();
  }

  // The check-in. Runs when one is due (every 2 minutes while tracking), when a screenshot was just taken, or to send
  // what is waiting. Safe to call often. Keeps everything when offline and tries again a minute later.
  async function sync(force) {
    if (sending || !view) return;
    const t = now();
    const due = tracking() && block && (t - lastPing >= pingMs() || (block.shots && !block.shotsSent));
    const waiting = queue.length > 0;
    if (!force && !due && !waiting) return;
    if (!force && online === false && t - lastTry < RETRY) return;
    sending = true;
    lastTry = t;
    try {
      do {
        const part = queue.slice(0, BATCH);
        const cur = tracking() && block ? block : null;
        const blocks = part.map(b => ({ start: b.start, activeSec: b.activeSec, idleSec: b.idleSec }));
        if (cur) blocks.push({ start: new Date(cur.ms).toISOString(), activeSec: cur.active, idleSec: cur.idle });
        if (!blocks.length) break;
        view = await call('track.beat', { app: 'tracker', idleNow: Math.max(0, Math.round(idleSeconds())), blocks });
        queue = queue.slice(part.length);
        lastPing = now();
        online = true;
        // Screenshots go one block at a time, after their block is saved (they are the big part of a check-in).
        for (const b of part) if (b.shots && view.shots) await call('track.beat', { blocks: [], shots: b.shots });
        if (cur && cur.shots && !cur.shotsSent && view.shots) { await call('track.beat', { blocks: [], shots: cur.shots }); cur.shotsSent = true; cur.shots = []; }
      } while (queue.length);
      lastError = '';
    } catch (e) {
      lastError = e && e.message ? e.message : 'No connection';
      if (e && e.signIn) { view = null; queue = []; block = null; }
      else if (/not turned on|accept the tracker terms|hire is active/i.test(lastError)) { queue = []; sending = false; await refresh(); } // tracker off, hire ended or terms changed: nothing to send
      else online = false;
    } finally {
      sending = false;
      onChange();
    }
  }

  // Asks the server where things stand (every minute, and after sign-in).
  async function refresh() {
    try { view = await call('track.me', {}); lastError = ''; online = true; }
    catch (e) { lastError = e && e.message ? e.message : 'No connection'; if (e && e.signIn) view = null; else online = false; }
    if (!tracking()) closeBlock();
    onChange();
    return view;
  }

  async function accept() {
    view = await call('track.consent', { agree: true });
    onChange();
    return view;
  }

  function signOut() { view = null; block = null; queue = []; lastError = ''; lastPing = 0; online = null; onChange(); }

  // Clocking out or quitting: keep what was counted in the unfinished block.
  async function stop() { closeBlock(); await sync(true); }

  const status = () => ({
    view, tracking: tracking(), queued: queue.length, error: lastError, online, lastPing: lastPing ? new Date(lastPing).toISOString() : '',
    block: block ? { start: new Date(block.ms).toISOString(), activeSec: block.active, idleSec: block.idle, hasShot: !!(block.shots) } : null,
  });

  return { tick, sync, flush: sync, refresh, accept, signOut, stop, status, TICK };
}

module.exports = { createEngine, TICK, IDLE_AFTER };
