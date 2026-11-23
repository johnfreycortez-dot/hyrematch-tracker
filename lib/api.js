// Talks to the same service as hyrematch.com/candidate. The session is the one the candidate area uses (7 days).
const DEFAULT_URL = 'https://hyrematch.com/api/candidate';

function createApi({ url = DEFAULT_URL, getSession, fetchFn = fetch }) {
  return async function call(op, extra = {}) {
    let res;
    try {
      // "op" goes first: the website relay looks at the start of the body to allow a screenshot through.
      res = await fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op, ...extra, session: getSession() }) });
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
    return reply;
  };
}

module.exports = { createApi, DEFAULT_URL };
