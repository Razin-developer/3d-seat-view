// Waitlist API for the mobile version of 3D Seat View.
//   POST /join   { email, platform?: 'android' | 'ios', website?: '' }
//   GET  /count  -> { count }
// Stores only the email, the chosen platform and the time. No IP address,
// no user agent, no cookies.

const ALLOWED_ORIGINS = ['https://seats.radr.in', 'https://seats.movie', 'https://www.seats.movie', 'https://3d-seat-view.pages.dev', 'http://localhost:8791', 'http://127.0.0.1:8791'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function cors(request) {
  const origin = request.headers.get('origin') || '';
  return {
    'access-control-allow-origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'access-control-allow-methods': 'POST, GET, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    vary: 'origin',
  };
}

const json = (request, status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...cors(request) } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(request) });

    if (url.pathname === '/count' && request.method === 'GET') {
      const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM waitlist').first();
      return json(request, 200, { count: row.n });
    }

    if (url.pathname === '/join' && request.method === 'POST') {
      // browsers send an Origin header on cross-site POSTs; refuse other sites' forms
      const origin = request.headers.get('origin');
      if (origin && !ALLOWED_ORIGINS.includes(origin)) return json(request, 403, { error: 'Not allowed from this site.' });

      let body;
      try {
        const text = await request.text();
        if (text.length > 1000) return json(request, 413, { error: 'Request too large.' });
        body = JSON.parse(text);
      } catch (_) { return json(request, 400, { error: 'Send JSON.' }); }

      // honeypot: real visitors never fill the hidden "website" field
      if (body.website) return json(request, 200, { ok: true });

      const email = String(body.email || '').trim().toLowerCase();
      if (email.length > 254 || !EMAIL.test(email)) return json(request, 400, { error: 'Enter a valid email address.' });
      const platform = ['android', 'ios'].includes(body.platform) ? body.platform : '';

      await env.DB
        .prepare('INSERT INTO waitlist (email, platform) VALUES (?1, ?2) ON CONFLICT(email) DO UPDATE SET platform = CASE WHEN excluded.platform != \'\' THEN excluded.platform ELSE waitlist.platform END')
        .bind(email, platform)
        .run();
      // same answer whether new or already on the list, so the form cannot be used to check who signed up
      return json(request, 200, { ok: true });
    }

    return json(request, 404, { error: 'Not found.' });
  },
};
