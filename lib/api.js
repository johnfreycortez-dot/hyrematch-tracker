// Talks to the same service as hyrematch.com/candidate. The session is the one the candidate area uses (7 days).
const DEFAULT_URL = 'https://hyrematch.com/api/candidate';

function createApi({ url = DEFAULT_URL, getSession, fetchFn = fetch, onRenew = () => {} }) {
  return async function call(op, extra = {}) {
    let res;
    try {
      // "op" goes first: the website relay looks at the start of the body to allow a screenshot through.
      // A request that hangs (bad Wi-Fi) is given up after 45 seconds (2 minutes with screenshots), so check-ins never get stuck.
      const signal = typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(extra && extra.shots ? 120000 : 45000) : undefined;
      res = await fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op, ...extra, session: getSession() }), signal });
    } catch (e) {
      throw new Error('No connection. Your time is kept and sent when you are back online.');
    }
    let reply;
    try { reply = await res.json(); } catch (e) { reply = { ok: false, error: 'Something went wrong. Please try again.' }; }
    if (!reply.ok) {
      const err = new Error(reply.error || 'Something went wrong. Please try again.');
      if (reply.auth) err.signIn = true;
      throw err;
    }
    // The server sends a fresh sign-in before the old one runs out, so nobody is signed out in the middle of a shift.
    if (reply.renew && typeof reply.renew === 'string') { try { onRenew(reply.renew); } catch (e) { /* keep the old one */ } delete reply.renew; }
    return reply;
  };
}

module.exports = { createApi, DEFAULT_URL };
