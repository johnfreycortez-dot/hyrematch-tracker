// The window: sign in, accept the terms, then a status card. All text is plain; nothing here counts time (see lib/engine.js).
const $ = document.getElementById('app');
let s = null, step = 'email', mail = '', busy = false, error = '';
const esc = v => String(v == null ? '' : v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const mins = sec => Math.floor(sec / 60) + ' min';
const ago = iso => { const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000); return m < 1 ? 'just now' : m + ' min ago'; };

function render() {
  document.getElementById('ver').textContent = s ? 'Version ' + s.version : '';
  document.getElementById('out').hidden = !(s && s.signedIn);
  const err = error ? `<p class="err" role="alert">${esc(error)}</p>` : '';
  if (!s) { $.innerHTML = '<p class="muted">Starting…</p>'; return; }

  if (!s.signedIn) {
    $.innerHTML = step === 'email'
      ? `<h1>Sign in</h1><p class="muted">Use the email of your HyreMatch candidate area. We'll email you a 6-digit code.</p>
         <form id="f"><label for="e">Email</label><input id="e" type="email" required autocomplete="email" value="${esc(mail)}">
         <button class="btn" ${busy ? 'disabled' : ''}>${busy ? 'Sending…' : 'Email me a code'}</button></form>${err}`
      : `<h1>Enter your code</h1><p class="muted">We sent a 6-digit code to <b>${esc(mail)}</b>. It works for a few minutes.</p>
         <form id="f"><label for="c">Code</label><input id="c" type="text" inputmode="numeric" maxlength="6" required autocomplete="one-time-code">
         <button class="btn" ${busy ? 'disabled' : ''}>${busy ? 'Checking…' : 'Sign in'}</button></form>
         <p class="small mt14"><button class="link" id="back">Use a different email</button></p>${err}`;
    const first = document.getElementById(step === 'email' ? 'e' : 'c'); if (first && !busy) first.focus();
    document.getElementById('f').onsubmit = async ev => {
      ev.preventDefault(); busy = true; error = '';
      const val = first.value.trim(); render();
      try {
        if (step === 'email') { mail = val; await window.tracker.sendCode(mail); step = 'code'; }
        else { s = await window.tracker.verify(mail, val); step = 'email'; }
      } catch (e) { error = clean(e); }
      busy = false; render();
    };
    const back = document.getElementById('back'); if (back) back.onclick = () => { step = 'email'; error = ''; render(); };
    return;
  }

  const v = s.view;
  if (!v) { $.innerHTML = `<h1>Hi!</h1><p class="muted">${esc(s.error || 'Checking your account…')}</p><button class="btn light" id="again">Try again</button>`; document.getElementById('again').onclick = () => act(window.tracker.refresh); return; }

  if (!v.on) {
    $.innerHTML = `<h1>Hi ${esc(v.name.split(' ')[0])}!</h1><div class="card"><p><b>The tracker isn't turned on for you.</b></p><p class="muted m0">You don't need this app right now. If HyreMatch asked you to install it, email admin@hyrematch.com.</p></div>${err}`;
    return;
  }
  if (!v.consent) {
    $.innerHTML = `<h1>Before we start</h1><p class="muted">${esc(v.client)} · ${esc(v.role)}</p>
      <div class="card"><ul class="terms">${v.terms.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>
      <form id="f"><label class="check"><input id="ok" type="checkbox" required> <span>I have read this and I accept.</span></label>
      <button class="btn amber" ${busy ? 'disabled' : ''}>${busy ? 'Saving…' : 'Accept and continue'}</button></form>${err}`;
    document.getElementById('f').onsubmit = ev => { ev.preventDefault(); act(window.tracker.accept); };
    return;
  }
  const b = s.block;
  const label = s.tracking ? 'Tracking' : v.state === 'Not clocked in' ? 'Not clocked in' : 'Paused · ' + v.state.toLowerCase();
  $.innerHTML = `<p class="muted mb10">${esc(v.name)} · ${esc(v.client)}</p>
    <div class="card state"><span class="dot ${s.tracking ? 'on' : v.state === 'Not clocked in' ? '' : 'pause'}"></span><div class="big">${esc(label)}</div>
      <p class="muted small tight">${s.tracking ? 'Counting active and idle time' + (v.shots ? '. Your client uses screen monitoring: a screenshot of your screens about every 10 minutes, seen only by your client.' : '. No screenshots.') : v.state === 'Not clocked in' ? 'Clock in on My work to start. Nothing is counted now.' : 'Nothing is counted during lunch and breaks.'}</p></div>
    ${s.tracking && b ? `<div class="card rows mt12"><div class="row"><span>This 10 minutes · active</span><b>${mins(b.activeSec)}</b></div><div class="row"><span>This 10 minutes · idle</span><b>${mins(b.idleSec)}</b></div></div>` : ''}
    ${s.tracking ? `<p class="conn ${s.online === false ? 'off' : 'ok'}"><span class="dot ${s.online === false ? '' : 'on'}"></span>${s.online === false ? 'Offline. Your time is kept and sent when you are back online.' : 'Connected' + (s.lastPing ? ' · last check-in ' + ago(s.lastPing) : '')}</p>` : ''}
    ${s.queued ? `<p class="note">${s.queued} block${s.queued === 1 ? '' : 's'} waiting to send. They go out when you're back online.</p>` : ''}
    ${s.needsScreenAccess ? `<p class="note">Screenshots need permission: System Settings › Privacy &amp; Security › Screen Recording › HyreMatch Tracker. <button class="link" id="perm">Open settings</button></p>` : ''}
    ${s.error && !s.queued && s.online !== false ? `<p class="err">${esc(s.error)}</p>` : ''}
    <button class="btn light" id="site">Open My work (clock in / out)</button>
    <p class="small muted mt14">Keep this app open while you work. Closing the window keeps it running near the clock; choose Quit there to stop it.</p>`;
  document.getElementById('site').onclick = () => window.tracker.open('site');
  const perm = document.getElementById('perm'); if (perm) perm.onclick = () => window.tracker.open('screen');
}
const clean = e => String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
async function act(fn) { busy = true; error = ''; render(); try { s = await fn(); } catch (e) { error = clean(e); } busy = false; render(); }

document.getElementById('out').onclick = () => act(window.tracker.signOut);
window.tracker.onState(next => { s = next; if (!busy) render(); });
window.tracker.state().then(next => { s = next; render(); });
render();
