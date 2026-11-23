// Run with: npm test. Checks the counting and check-in rules with a fake clock and a fake server (no network, no Electron).
const { createEngine, TICK } = require('../lib/engine');
let fail = 0; const ok = (name, c, x = '') => { console.log((c ? 'PASS ' : 'FAIL ') + name + (x ? ' · ' + x : '')); if (!c) fail++; };

function setup({ shots = false, screens = 2 } = {}) {
  const t = { now: Date.parse('2026-11-13T14:00:00Z'), idle: 0, online: true, tracking: true, beats: [], rows: {}, shotFiles: 0, captures: 0 };
  const view = () => ({ ok: true, on: true, consent: true, shots, screens: 3, blockMin: 10, pingMin: 2, state: t.tracking ? 'Working' : 'On lunch', tracking: t.tracking });
  const call = async (op, d) => {
    if (!t.online) throw new Error('No connection');
    if (op === 'track.beat') {
      t.beats.push({ at: t.now, idleNow: d.idleNow, n: d.blocks.length, shots: (d.shots || []).length });
      d.blocks.forEach(b => { const old = t.rows[b.start]; if (!old || b.activeSec + b.idleSec > old.activeSec + old.idleSec) t.rows[b.start] = b; }); // the server keeps the fuller one
      t.shotFiles += (d.shots || []).length;
    }
    return view();
  };
  const e = createEngine({ now: () => t.now, idleSeconds: () => t.idle, capture: async () => { t.captures++; return Array.from({ length: screens }, () => 'jpeg'); }, call });
  const run = async (minutes, idle = false) => { for (let i = 0; i < minutes * 60 / TICK; i++) { t.now += TICK * 1000; t.idle = idle ? t.idle + TICK + 60 : 3; await e.tick(); } };
  const rows = () => Object.keys(t.rows).sort().map(k => t.rows[k]);
  return { t, e, run, rows };
}

(async () => {
  let { t, e, run, rows } = setup();
  await e.refresh();
  await run(6); await run(4, true); await run(10); await run(1);
  const pings = t.beats.filter(b => b.n > 0);
  ok('checks in about every 2 minutes (21 min -> 10 or 11 check-ins)', pings.length >= 10 && pings.length <= 11, String(pings.length));
  const gaps = pings.slice(1).map((b, i) => (b.at - pings[i].at) / 1000);
  ok('never more than 2 min 15 s between check-ins', Math.max(...gaps) <= 135, String(Math.max(...gaps)));
  ok('first block: 6 min active, 4 idle', rows()[0].activeSec === 360 && rows()[0].idleSec === 240 && rows()[0].start === '2026-11-13T14:00:00.000Z', JSON.stringify(rows()[0]));
  ok('second block: all active, never over 600 s', rows()[1].activeSec === 600 && rows()[1].idleSec === 0);
  ok('a check-in says how idle the computer is right now', t.beats.some(b => b.idleNow >= 60) && t.beats.some(b => b.idleNow < 60));
  ok('status shows connected with the last check-in time', e.status().online === true && !!e.status().lastPing);

  const before = t.beats.length;
  t.online = false; await run(20);
  ok('offline: nothing lost, blocks wait, app says offline', e.status().queued === 2 && e.status().online === false && t.beats.length === before && /connection/i.test(e.status().error), JSON.stringify(e.status().queued));
  t.online = true; await run(2);
  ok('back online within about a minute: everything is sent', e.status().queued === 0 && e.status().online === true && rows().length === 5 && rows().slice(2, 4).every(b => b.activeSec === 600), JSON.stringify(rows().map(b => b.activeSec)));

  await run(7); // a few minutes into a new block
  t.tracking = false; await e.refresh(); const n = rows().length; const last = rows()[n - 1].activeSec; await run(30);
  ok('lunch: the part-block is kept, no check-ins and nothing counted during it', rows().length === n && rows()[n - 1].activeSec >= last && t.beats.filter(b => b.at > t.now - 25 * 60000).length === 0, `${rows().length} rows`);

  ({ t, e, run, rows } = setup());
  await e.refresh(); await run(10); await run(70, true); await run(11);
  ok('walked away: keeps checking in, time is recorded as idle', rows().filter(b => b.activeSec === 0 && b.idleSec === 600).length >= 6 && t.beats.filter(b => b.idleNow > 1800).length > 0, String(rows().filter(b => b.activeSec === 0).length));
  ok('counts again when they are back', rows()[rows().length - 1].activeSec > 0);

  ({ t, e, run, rows } = setup({ shots: true, screens: 2 }));
  await e.refresh(); await run(31);
  ok('screen monitoring on: one moment per block, one picture per monitor', t.captures >= 3 && t.captures <= 4 && t.shotFiles === t.captures * 2, `${t.captures} moments, ${t.shotFiles} pictures`);
  ({ t, e, run, rows } = setup({ shots: true, screens: 2 }));
  await e.refresh(); await run(31, true);
  ok('no screenshots while idle', t.captures === 0);
  ({ t, e, run, rows } = setup({ shots: false }));
  await e.refresh(); await run(31);
  ok('screen monitoring off: none taken', t.captures === 0 && t.shotFiles === 0);

  console.log(fail ? fail + ' FAILED' : 'ALL PASS');
  process.exit(fail ? 1 : 0);
})();
