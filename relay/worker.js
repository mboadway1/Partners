// Peggy relay — a tiny Cloudflare Worker.
// Google Photos doesn't allow web pages to call it directly from the browser (no CORS),
// so the app sends requests here and this forwards them to Google with your sign-in token.
// It stores nothing and only talks to Google Photos hosts.
//
//   /picker/<path>   ->  https://photospicker.googleapis.com/<path>   (GET, POST, DELETE)
//   /media?u=<url>   ->  photo bytes from *.googleusercontent.com    (GET)
//
// Set ALLOWED_ORIGINS (comma-separated) in wrangler.toml to the site(s) hosting the app.

export default {
  async fetch(req, env) {
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    const origin = req.headers.get('Origin') || '';
    const okOrigin = allowed.includes(origin);
    const cors = {
      'Access-Control-Allow-Origin': okOrigin ? origin : (allowed[0] || ''),
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!okOrigin) return new Response('Origin not allowed', { status: 403, headers: cors });

    const auth = req.headers.get('Authorization') || '';
    if (!auth.startsWith('Bearer ')) return new Response('Missing token', { status: 401, headers: cors });

    const url = new URL(req.url);
    let target, init;

    if (url.pathname.startsWith('/picker/')) {
      if (!['GET', 'POST', 'DELETE'].includes(req.method)) return new Response('Method not allowed', { status: 405, headers: cors });
      target = 'https://photospicker.googleapis.com/' + url.pathname.slice('/picker/'.length) + url.search;
      init = { method: req.method, headers: { Authorization: auth } };
      if (req.method === 'POST') { init.headers['Content-Type'] = 'application/json'; init.body = await req.text(); }
    } else if (url.pathname === '/media') {
      if (req.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: cors });
      let u;
      try { u = new URL(url.searchParams.get('u') || ''); } catch { return new Response('Bad url', { status: 400, headers: cors }); }
      if (u.protocol !== 'https:' || !(u.hostname === 'googleusercontent.com' || u.hostname.endsWith('.googleusercontent.com')))
        return new Response('Host not allowed', { status: 400, headers: cors });
      target = u.toString();
      init = { headers: { Authorization: auth } };
    } else {
      return new Response('Peggy relay is running.', { status: 200, headers: cors });
    }

    const r = await fetch(target, init);
    const headers = new Headers(cors);
    const ct = r.headers.get('Content-Type'); if (ct) headers.set('Content-Type', ct);
    headers.set('Cache-Control', 'no-store');
    return new Response(r.body, { status: r.status, headers });
  },
};
