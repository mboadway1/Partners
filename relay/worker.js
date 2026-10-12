// Peggy relay — a small Cloudflare Worker that Peggy talks to.
//
//  1. Google Photos relay (Google doesn't allow browsers to call it directly):
//       /picker/<path>   ->  https://photospicker.googleapis.com/<path>
//       /media?u=<url>   ->  photo bytes from *.googleusercontent.com
//  2. Peggy's shared space for two people (tasks, link favorites, calendar for the TV):
//       /api/...         sign-in, shared data, TV agenda
//
// Settings (Cloudflare → the worker → Settings → Variables and Secrets / Bindings):
//   ALLOWED_ORIGINS       text    https://mboadway1.github.io
//   ALLOWED_EMAILS        text    the two Gmail addresses allowed in, comma-separated
//   GOOGLE_CLIENT_ID      text    the Peggy OAuth client ID
//   GOOGLE_CLIENT_SECRET  secret  the Peggy OAuth client secret
//   PEGGY_KV              KV namespace binding (stores sign-ins and shared data)

const DOCS = ['tasks', 'links', 'shared', 'expenses', 'closet', 'flights', 'us'];   // shared = shared photo albums (lists) and the photos in them (items)

export default {
  async fetch(req, env) {
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    const origin = req.headers.get('Origin') || '';
    const okOrigin = allowed.includes(origin);
    const cors = {
      'Access-Control-Allow-Origin': okOrigin ? origin : (allowed[0] || ''),
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Peggy-Session',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    };
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!okOrigin) return new Response('Origin not allowed', { status: 403, headers: cors });

    const url = new URL(req.url);
    try {
      if (url.pathname.startsWith('/api/')) return await api(req, env, url, cors);
      if (url.pathname.startsWith('/picker/') || url.pathname === '/media') return await photos(req, url, cors);
      return new Response('Partners relay is running.', { status: 200, headers: cors });
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 500, cors);
    }
  },
};

const json = (o, status, cors) => new Response(JSON.stringify(o), { status: status || 200, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

/* ---------------- Google Photos relay ---------------- */
async function photos(req, url, cors) {
  const auth = req.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return new Response('Missing token', { status: 401, headers: cors });
  let target, init;
  if (url.pathname.startsWith('/picker/')) {
    if (!['GET', 'POST', 'DELETE'].includes(req.method)) return new Response('Method not allowed', { status: 405, headers: cors });
    target = 'https://photospicker.googleapis.com/' + url.pathname.slice('/picker/'.length) + url.search;
    init = { method: req.method, headers: { Authorization: auth } };
    if (req.method === 'POST') { init.headers['Content-Type'] = 'application/json'; init.body = await req.text(); }
  } else {
    let u;
    try { u = new URL(url.searchParams.get('u') || ''); } catch { return new Response('Bad url', { status: 400, headers: cors }); }
    if (u.protocol !== 'https:' || !(u.hostname === 'googleusercontent.com' || u.hostname.endsWith('.googleusercontent.com')))
      return new Response('Host not allowed', { status: 400, headers: cors });
    target = u.toString();
    init = { headers: { Authorization: auth } };
  }
  const r = await fetch(target, init);
  const headers = new Headers(cors);
  const ct = r.headers.get('Content-Type'); if (ct) headers.set('Content-Type', ct);
  headers.set('Cache-Control', 'no-store');
  return new Response(r.body, { status: r.status, headers });
}

/* ---------------- Peggy shared space ---------------- */
async function api(req, env, url, cors) {
  if (!env.PEGGY_KV) return json({ error: 'The PEGGY_KV storage isn’t connected to this worker yet.' }, 500, cors);
  const KV = env.PEGGY_KV;
  const path = url.pathname.slice(5);           // after "/api/"
  const emails = (env.ALLOWED_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const body = async () => { try { return await req.json(); } catch { return {}; } };

  // --- sign-in: exchange Google's one-time code for tokens, kept here so nobody has to sign in again ---
  if (path === 'auth/exchange' && req.method === 'POST') {
    const { code, redirect_uri } = await body();
    if (!code || !redirect_uri) return json({ error: 'Missing code' }, 400, cors);
    const t = await googleToken(env, { code, redirect_uri, grant_type: 'authorization_code' });
    if (t.error) return json({ error: t.error_description || t.error }, 400, cors);
    const claims = decodeJwt(t.id_token);
    const email = (claims.email || '').toLowerCase();
    if (!email || !emails.includes(email)) return json({ error: `${email || 'This account'} isn’t on Partners’ list of members.` }, 403, cors);
    const user = (await KV.get('user:' + email, 'json')) || { email };
    Object.assign(user, { name: claims.given_name || claims.name || email.split('@')[0], fullName: claims.name || '', picture: claims.picture || '',
      access: t.access_token, exp: Date.now() + (t.expires_in - 60) * 1000, scope: t.scope });
    if (t.refresh_token) user.refresh = t.refresh_token;
    await KV.put('user:' + email, JSON.stringify(user));
    const session = token();
    await KV.put('session:' + session, JSON.stringify({ email, ro: false, created: Date.now() }));
    return json({ session, me: publicUser(user), access_token: t.access_token, expires_in: t.expires_in - 60, scope: t.scope }, 200, cors);
  }

  const s = await sessionOf(req, KV);
  if (!s || !emails.includes(s.email)) return json({ error: 'Please sign in again.', reauth: true }, 401, cors);
  const full = !s.ro;

  if (path === 'auth/token' && req.method === 'GET') {
    if (!full) return json({ error: 'Read-only' }, 403, cors);
    const user = await KV.get('user:' + s.email, 'json');
    const t = await accessFor(env, KV, user);
    if (!t) return json({ error: 'Google sign-in expired. Please sign in again.', reauth: true }, 401, cors);
    return json(t, 200, cors);
  }
  if (path === 'auth/signout' && req.method === 'POST') {
    await KV.delete('session:' + req.headers.get('X-Peggy-Session'));
    return json({ ok: true }, 200, cors);
  }
  if (path === 'me' && req.method === 'GET') {
    const user = await KV.get('user:' + s.email, 'json');
    return json({ me: publicUser(user || { email: s.email }), readOnly: !full }, 200, cors);
  }
  if (path === 'members' && req.method === 'GET') {
    const list = [];
    for (const e of emails) {
      const u = await KV.get('user:' + e, 'json'), pr = (await KV.get('profile:' + e, 'json')) || {};
      const m = publicUser(u || { email: e });
      if (pr.name) m.name = pr.name;          // the name each partner chose in Settings
      m.color = pr.color || ''; m.theme = pr.theme || '';
      list.push(m);
    }
    const ph = await KV.get('couple:at');
    return json({ members: list, couplePhoto: ph ? Number(ph) : 0 }, 200, cors);
  }
  // Settings kept in sync between the TV, the Chromebook and both phones. The TV's view-only pass may write these too.
  if (path === 'settings') {
    const cur = (await KV.get('settings', 'json')) || {};
    if (req.method === 'GET') return json(cur, 200, cors);
    if (req.method === 'PUT') {
      const { changes } = await body();
      for (const [k, x] of Object.entries(changes || {})) {
        if (!/^peggy\.[\w.]{1,60}$/.test(k) || !x || typeof x.at !== 'number') continue;
        if (x.v != null && String(x.v).length > 4000) continue;
        if (!cur[k] || cur[k].at < x.at) cur[k] = { v: x.v == null ? null : String(x.v), at: x.at };
      }
      if (JSON.stringify(cur).length < 200000) await KV.put('settings', JSON.stringify(cur));
      return json(cur, 200, cors);
    }
  }
  // Each partner's own name, color and theme (shown to both of you and on the TV).
  if (path === 'profile' && req.method === 'PUT' && full) {
    const b = await body(), cur = (await KV.get('profile:' + s.email, 'json')) || {};
    const clean = (v, n) => typeof v === 'string' ? v.trim().slice(0, n) : undefined;
    const next = { ...cur };
    for (const [k, n] of [['name', 40], ['color', 9], ['theme', 20]]) { const v = clean(b[k], n); if (v !== undefined) next[k] = v; }
    if (next.color && !/^#[0-9a-fA-F]{6}$/.test(next.color)) delete next.color;
    await KV.put('profile:' + s.email, JSON.stringify(next));
    return json(next, 200, cors);
  }
  // The couples photo on the home screens. Anyone signed in (and the TV) can see it; either partner can change it.
  if (path === 'couple-photo') {
    if (req.method === 'GET') {
      const d = await KV.get('couple:photo', 'arrayBuffer');
      if (!d) return json({ error: 'No couples photo yet' }, 404, cors);
      return new Response(d, { status: 200, headers: { ...cors, 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=60' } });
    }
    if (req.method === 'PUT' && full) {
      const buf = await req.arrayBuffer();
      if (!buf.byteLength || buf.byteLength > 4_000_000) return json({ error: 'Photo is too large' }, 400, cors);
      await KV.put('couple:photo', buf); const at = Date.now(); await KV.put('couple:at', String(at));
      return json({ ok: true, at }, 200, cors);
    }
    if (req.method === 'DELETE' && full) { await KV.delete('couple:photo'); await KV.delete('couple:at'); return json({ ok: true }, 200, cors); }
  }
  if (path === 'tv-token' && req.method === 'POST') {
    if (!full) return json({ error: 'Read-only' }, 403, cors);
    const tv = token();
    await KV.put('session:' + tv, JSON.stringify({ email: s.email, ro: true, created: Date.now() }));
    return json({ session: tv }, 200, cors);
  }

  // --- each person's calendar choices (used for the TV agenda) ---
  if (path === 'prefs') {
    if (req.method === 'GET') return json((await KV.get('prefs:' + s.email, 'json')) || {}, 200, cors);
    if (req.method === 'PUT' && full) { const p = await body(); await KV.put('prefs:' + s.email, JSON.stringify(p)); return json(p, 200, cors); }
  }

  // --- shared documents (tasks, links): last change wins per item ---
  const dm = path.match(/^data\/(\w+)$/);
  if (dm && DOCS.includes(dm[1])) {
    const key = 'doc:' + dm[1];
    if (req.method === 'GET') return json((await KV.get(key, 'json')) || { v: 0, items: [], lists: [] }, 200, cors);
    if (req.method === 'POST' && full) {
      const { ops } = await body();
      const doc = (await KV.get(key, 'json')) || { v: 0, items: [], lists: [] };
      for (const op of (ops || []).slice(0, 2000)) applyOp(doc, op, s.email);
      doc.v = (doc.v || 0) + 1; doc.updated = Date.now();
      await KV.put(key, JSON.stringify(doc));
      return json(doc, 200, cors);
    }
  }

  // --- shared album photos, kept in Cloudflare R2 (binding PEGGY_R2) ---
  const pm = path.match(/^photo\/([\w-]{8,64})(?:\/(full))?$/);
  if (pm) {
    if (!env.PEGGY_R2) return json({ error: 'Shared albums need the PEGGY_R2 photo storage connected to the relay.' }, 500, cors);
    const key = 'photos/' + pm[1] + '/full';
    if (req.method === 'GET') {
      const o = await env.PEGGY_R2.get(key);
      if (!o) return json({ error: 'Photo not found' }, 404, cors);
      return new Response(o.body, { status: 200, headers: { ...cors, 'Content-Type': (o.httpMetadata && o.httpMetadata.contentType) || 'image/jpeg', 'Cache-Control': 'private, max-age=31536000, immutable' } });
    }
    if (req.method === 'PUT' && full) {
      const len = +(req.headers.get('Content-Length') || 0);
      if (len > 20e6) return json({ error: 'Photo too big' }, 413, cors);
      const buf = await req.arrayBuffer();
      if (!buf.byteLength || buf.byteLength > 20e6) return json({ error: 'Photo missing or too big' }, 400, cors);
      await env.PEGGY_R2.put(key, buf, { httpMetadata: { contentType: req.headers.get('Content-Type') || 'image/jpeg' }, customMetadata: { by: s.email } });
      return json({ ok: true, size: buf.byteLength }, 200, cors);
    }
    if (req.method === 'DELETE' && full) { await env.PEGGY_R2.delete(key); return json({ ok: true }, 200, cors); }
    return json({ error: 'Not allowed' }, 405, cors);
  }

  // --- AI captions: Claude looks at the photos and suggests Facebook captions ---
  if (path === 'caption' && req.method === 'POST' && full) {
    if (!env.ANTHROPIC_API_KEY) return json({ error: 'AI captions need an ANTHROPIC_API_KEY secret in the relay’s settings.' }, 500, cors);
    const { images, tone, about, draft } = await body();
    const pics = (Array.isArray(images) ? images : []).filter(x => typeof x === 'string' && x.length < 1500000).slice(0, 4);
    if (!pics.length) return json({ error: 'No photos sent' }, 400, cors);
    const user = await KV.get('user:' + s.email, 'json');
    const TONES = { warm: 'warm and friendly', funny: 'light and playful, gently funny', short: 'very short (a few words) and sweet', heartfelt: 'heartfelt and sincere', excited: 'upbeat and excited' };
    const ask = [
      `Write 3 different Facebook captions for ${pics.length > 1 ? 'these ' + pics.length + ' photos, posted together' : 'this photo'}.`,
      `The person posting is ${(user && user.name) || 'the account owner'}. Write in their voice, first person, as a regular person sharing with friends and family.`,
      `Tone: ${TONES[tone] || TONES.warm}.`,
      about ? `What it's about, in their words: ${String(about).slice(0, 500)}` : '',
      draft ? `Their draft so far (improve on it, keep its meaning): ${String(draft).slice(0, 1000)}` : '',
      'Describe only what you can actually see or what they told you. Don’t guess names, places or events. At most one or two emoji per caption, no hashtags unless they fit naturally.',
      'Reply with only a JSON array of 3 strings.',
    ].filter(Boolean).join('\n');
    const content = pics.map(d => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: d.replace(/^data:image\/\w+;base64,/, '') } }));
    content.push({ type: 'text', text: ask });
    const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: env.CAPTION_MODEL || 'claude-sonnet-5-5', max_tokens: 800, messages: [{ role: 'user', content }] }) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return json({ error: (d.error && d.error.message) || ('Claude answered ' + r.status) }, 502, cors);
    const text = (d.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
    let captions = [];
    try { const m = text.match(/\[[\s\S]*\]/); captions = JSON.parse(m ? m[0] : text).filter(x => typeof x === 'string'); } catch { captions = text.split(/\n+/).map(t => t.replace(/^\s*(\d+[.)]|[-*•])\s*/, '').replace(/^"|"$/g, '').trim()).filter(Boolean); }
    return json({ captions: captions.slice(0, 3) }, 200, cors);
  }

  // --- costumes: find costumes in photos and note the pieces; suggest new costumes from the closet ---
  if (path === 'costume-scan' && req.method === 'POST' && full) {
    if (!env.ANTHROPIC_API_KEY) return json({ error: 'Costume finding needs an ANTHROPIC_API_KEY secret in the relay’s settings.' }, 500, cors);
    const { images } = await body();
    const pics = (Array.isArray(images) ? images : []).filter(x => x && typeof x.data === 'string' && x.data.length < 600000 && typeof x.id === 'string').slice(0, 8);
    if (!pics.length) return json({ error: 'No photos sent' }, 400, cors);
    const content = [];
    pics.forEach((x, i) => { content.push({ type: 'text', text: `Photo ${i + 1} (id ${x.id}):` }); content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: x.data } }); });
    content.push({ type: 'text', text: [
      'For each photo, decide whether someone in it is wearing a costume (Halloween, cosplay, theme party, dress-up, mascot, period or character outfit). Everyday clothes, uniforms and formal wear are not costumes.',
      'For photos with a costume, name the costume in a few words and list the visible costume pieces someone could reuse: clothing, accessories, wigs, hats, props, makeup. Use short plain names with a colour when it helps, like "red cape", "pirate hat", "fairy wings".',
      'Reply with only JSON: an array with one object per photo, in order: {"id": "...", "costume": true|false, "name": "...", "items": [{"name": "...", "kind": "clothing|accessory|wig|hat|prop|makeup|shoes"}]}. Use "costume": false and empty items when there is no costume.',
    ].join('\n') });
    const r = await claude(env, env.SCAN_MODEL || 'claude-haiku-5-5', content, 1500);
    if (r.error) return json({ error: r.error }, 502, cors);
    const arr = jsonFrom(r.text, []);
    return json({ results: Array.isArray(arr) ? arr : [] }, 200, cors);
  }
  if (path === 'costume-ideas' && req.method === 'POST' && full) {
    if (!env.ANTHROPIC_API_KEY) return json({ error: 'Costume ideas need an ANTHROPIC_API_KEY secret in the relay’s settings.' }, 500, cors);
    const { closet, wish, past } = await body();
    const items = (Array.isArray(closet) ? closet : []).filter(x => typeof x === 'string').slice(0, 300);
    const done = (Array.isArray(past) ? past : []).filter(x => typeof x === 'string').slice(0, 60);
    const text = [
      'Two people (a couple) keep a costume closet. Suggest 6 costume ideas they could make mostly from what they already own.',
      `Their closet: ${items.length ? items.join('; ') : '(empty so far)'}.`,
      done.length ? `Costumes they have already worn (suggest different ones): ${done.join('; ')}.` : '',
      wish ? `What they’re looking for: ${String(wish).slice(0, 400)}` : 'Mix solo costumes and a couple of matching couple costumes.',
      'Reply with only JSON: an array of {"name": "...", "for": "one person|couple", "uses": ["closet items it uses, exactly as listed"], "need": ["a few things to get or make"], "how": "one or two sentences on putting it together"}. Prefer ideas that need little or nothing new.',
    ].filter(Boolean).join('\n');
    const r = await claude(env, env.CAPTION_MODEL || 'claude-sonnet-5-5', [{ type: 'text', text }], 2000);
    if (r.error) return json({ error: r.error }, 502, cors);
    const arr = jsonFrom(r.text, []);
    return json({ ideas: Array.isArray(arr) ? arr.slice(0, 8) : [] }, 200, cors);
  }

  // --- money: read receipts and screenshots (bank, card, Venmo, orders) into expenses ---
  if (path === 'receipt-scan' && req.method === 'POST' && full) {
    if (!env.ANTHROPIC_API_KEY) return json({ error: 'Scanning receipts needs an ANTHROPIC_API_KEY secret in the relay’s settings.' }, 500, cors);
    const { images, today } = await body();
    const pics = (Array.isArray(images) ? images : []).filter(x => typeof x === 'string' && x.length < 3000000).slice(0, 4);
    if (!pics.length) return json({ error: 'No pictures sent' }, 400, cors);
    const content = pics.map(d => ({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: d } }));
    content.push({ type: 'text', text: [
      `Today is ${String(today || '').slice(0, 10) || 'unknown'}. These pictures are receipts or screenshots (a store receipt, a restaurant bill, an order confirmation, or a list of transactions from a bank, card or payment app).`,
      'List the money spent. A single receipt or bill is ONE expense: use the final total actually paid (with tax and tip). A list of transactions gives one expense per purchase. Skip deposits, refunds, credits, transfers between own accounts, and pending holds that are duplicated.',
      'For each: "what" = the store or merchant in plain words (e.g. "Costco", "Rosa’s Cantina"), plus a 2–4 word hint of what was bought when the receipt shows it; "amount" = positive number in dollars; "date" = YYYY-MM-DD (use today’s year if the year isn’t shown); "cat" = one of groceries, food, home, bills, gas, rv, travel, fun, gifts, health, other; "note" = anything useful like the card last 4 or order number, else "".',
      'Reply with only JSON: an array of {"what": "...", "amount": 0, "date": "YYYY-MM-DD", "cat": "...", "note": "..."}. Use [] if there is no spending.',
    ].join('\n') });
    const r = await claude(env, env.CAPTION_MODEL || 'claude-sonnet-5-5', content, 2000);
    if (r.error) return json({ error: r.error }, 502, cors);
    const arr = jsonFrom(r.text, []);
    const items = (Array.isArray(arr) ? arr : []).map(x => ({ what: String(x.what || '').slice(0, 80), amount: Math.round(Math.abs(+x.amount || 0) * 100) / 100,
      date: /^\d{4}-\d\d-\d\d$/.test(x.date || '') ? x.date : '', cat: String(x.cat || 'other'), note: String(x.note || '').slice(0, 120) })).filter(x => x.amount > 0).slice(0, 60);
    return json({ items }, 200, cors);
  }

  // --- fuel: posted fuel prices at nearby stations or along a route (Google Places + Routes, key GOOGLE_MAPS_KEY) ---
  if ((path === 'fuel' || path === 'fuel-route') && req.method === 'POST' && full) {
    if (!env.GOOGLE_MAPS_KEY) return json({ error: 'Fuel prices need a GOOGLE_MAPS_KEY secret in the relay’s settings.' }, 500, cors);
    const q = await body(), lat = +q.lat, lng = +q.lng;
    if (!isFinite(lat) || !isFinite(lng)) return json({ error: 'Location missing' }, 400, cors);
    const rest = q.kind === 'rest' || q.kind === 'elks';   // rest areas / truck stops, or Elks lodges, instead of fuel prices
    const elks = q.kind === 'elks';
    const F = 'places.id,places.displayName,places.formattedAddress,places.location,places.currentOpeningHours.openNow,places.googleMapsUri'
      + (rest ? ',places.primaryType,places.primaryTypeDisplayName,places.restroom,places.allowsDogs,places.rating,places.userRatingCount' : ',places.fuelOptions')
      + (elks ? ',places.nationalPhoneNumber,places.websiteUri' : '');
    const g = (url, mask, payload) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': env.GOOGLE_MAPS_KEY, 'X-Goog-FieldMask': mask }, body: JSON.stringify(payload) })
      .then(async r => ({ ok: r.ok, d: await r.json().catch(() => ({})) }));
    let places = [], route = null, summaries = [];
    if (path === 'fuel') {
      const radius = Math.min(50000, Math.max(1000, +q.radius || 16000));
      const near = types => g('https://places.googleapis.com/v1/places:searchNearby', F, { includedTypes: types, maxResultCount: 20, rankPreference: 'DISTANCE',
        locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius } } });
      let r;
      if (elks) r = await g('https://places.googleapis.com/v1/places:searchText', F, { textQuery: 'Elks Lodge', maxResultCount: 20, rankPreference: 'DISTANCE',
        locationBias: { circle: { center: { latitude: lat, longitude: lng }, radius } } });
      else { r = await near(rest ? ['rest_stop', 'truck_stop'] : ['gas_station', 'truck_stop']);
        if (!r.ok) r = await near(rest ? ['rest_stop'] : ['gas_station']); }
      if (!r.ok) return json({ error: (r.d.error && r.d.error.message) || 'Google Places refused the request' }, 502, cors);
      places = r.d.places || [];
    } else {
      if (!q.dest) return json({ error: 'Where are you headed?' }, 400, cors);
      const rr = await g('https://routes.googleapis.com/directions/v2:computeRoutes', 'routes.polyline.encodedPolyline,routes.distanceMeters,routes.duration',
        { origin: { location: { latLng: { latitude: lat, longitude: lng } } }, destination: { address: String(q.dest).slice(0, 200) }, travelMode: 'DRIVE' });
      const rt = rr.ok && rr.d.routes && rr.d.routes[0];
      if (!rt) return json({ error: (rr.d.error && rr.d.error.message) || 'Couldn’t find a route there' }, 502, cors);
      route = { meters: rt.distanceMeters, duration: rt.duration };
      const ts = await g('https://places.googleapis.com/v1/places:searchText', F + ',routingSummaries', { textQuery: elks ? 'Elks Lodge' : rest ? 'rest area or truck stop' : (q.fuelWord || 'diesel') + ' gas station', maxResultCount: 20,
        searchAlongRouteParameters: { polyline: { encodedPolyline: rt.polyline.encodedPolyline } }, routingParameters: { origin: { latitude: lat, longitude: lng } } });
      if (!ts.ok) return json({ error: (ts.d.error && ts.d.error.message) || 'Google Places refused the request' }, 502, cors);
      places = ts.d.places || []; summaries = ts.d.routingSummaries || [];
    }
    const out = places.map((p, i) => {
      const s = summaries[i] && summaries[i].legs;   // leg 0: here → station; leg 1: station → destination
      return { id: p.id, name: (p.displayName && p.displayName.text) || 'Station', address: p.formattedAddress || '', lat: p.location && p.location.latitude, lng: p.location && p.location.longitude,
        open: p.currentOpeningHours ? p.currentOpeningHours.openNow : null, maps: p.googleMapsUri || '',
        phone: p.nationalPhoneNumber || '', web: p.websiteUri || '',
        type: p.primaryType || '', typeName: (p.primaryTypeDisplayName && p.primaryTypeDisplayName.text) || '', restroom: p.restroom, dogs: p.allowsDogs, rating: p.rating, ratings: p.userRatingCount,
        prices: ((p.fuelOptions && p.fuelOptions.fuelPrices) || []).map(f => ({ type: f.type, price: f.price ? (+f.price.units || 0) + (f.price.nanos || 0) / 1e9 : null, currency: f.price && f.price.currencyCode, updated: f.updateTime })),
        detour: s ? { toMeters: s[0] && s[0].distanceMeters, toSecs: s[0] && parseInt(s[0].duration), restSecs: s[1] && parseInt(s[1].duration) } : null };
    });
    // Elks searches can return nearby businesses too: keep only actual lodges.
    const keep = elks ? out.filter(x => /\belks\b|b\.?\s?p\.?\s?o\.?\s?e/i.test(x.name)) : out;
    return json({ stations: keep, route }, 200, cors);
  }

  // --- us: help put a hard feeling into kind, clear words (only the writer sees the result) ---
  if (path === 'rephrase' && req.method === 'POST' && full) {
    if (!env.ANTHROPIC_API_KEY) return json({ error: 'This needs an ANTHROPIC_API_KEY secret in the relay’s settings.' }, 500, cors);
    const { text, to } = await body();
    if (!text || typeof text !== 'string') return json({ error: 'Write what you want to say first' }, 400, cors);
    const user = await KV.get('user:' + s.email, 'json');
    const ask = [
      `${(user && user.name) || 'Someone'} wants to raise something with their partner${to ? ' ' + String(to).slice(0, 40) : ''}. Below is what they wrote, possibly in the heat of the moment.`,
      'Rewrite it as 3 short alternatives they could actually say or text. Use a gentle start-up: describe the situation without blame or "you always/never", say how they feel ("I feel…"), and ask for something specific and positive ("Could we…"). Keep their real concern and meaning; don’t water it down to nothing, and don’t add things they didn’t say. Warm, natural, first person, no therapy jargon.',
      'If the message describes being hurt, threatened, controlled or unsafe, don’t rewrite it to be softer; instead make the first option a short, kind note that they deserve to feel safe and can call or text the National Domestic Violence Hotline (1-800-799-7233, or text START to 88788).',
      'Reply with only JSON: {"options": ["...", "...", "..."], "tip": "one sentence of advice for how to bring it up (timing, tone)"}.',
      '---', String(text).slice(0, 3000),
    ].join('\n');
    const r = await claude(env, env.CAPTION_MODEL || 'claude-sonnet-5-5', [{ type: 'text', text: ask }], 900);
    if (r.error) return json({ error: r.error }, 502, cors);
    const d = jsonFrom(r.text, {});
    return json({ options: Array.isArray(d.options) ? d.options.slice(0, 3).map(String) : [], tip: String(d.tip || '') }, 200, cors);
  }

  // --- Elks lodges: read the lodge's own elks.org page for RV parking details (cached a week) ---
  if (path === 'elks-rv' && req.method === 'GET') {
    const n = (url.searchParams.get('lodge') || '').replace(/\D/g, '').slice(0, 5);
    if (!n) return json({ error: 'Lodge number missing' }, 400, cors);
    const ck = 'elksrv:' + n, hit = await KV.get(ck, 'json');
    if (hit && Date.now() - hit.at < 7 * 864e5) return json(hit, 200, cors);
    const home = 'https://www.elks.org/lodges/home.cfm?lodge=' + n;
    const get = async u => { try { const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (Peggy RV lookup)', 'Accept': 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(7000) }); return r.ok ? (await r.text()).slice(0, 400000) : ''; } catch { return ''; } };
    const html = await get(home);
    if (!html) return json({ lodge: n, url: home, found: false, rv: false, summary: '', at: Date.now() }, 200, cors);
    // A link to the lodge's RV page, if it has one.
    let rvUrl = '';
    const lm = [...html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]{0,80}?)<\/a>/gi)].find(m => /\bRV\b|camp/i.test(m[2].replace(/<[^>]+>/g, '')));
    if (lm) { try { const u = new URL(lm[1], home); if (/(^|\.)elks\.org$/.test(u.hostname)) rvUrl = u.toString(); } catch {} }
    const text = h => decodeEntities(h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
    let body = text(html); if (rvUrl && rvUrl !== home) body += ' ' + text(await get(rvUrl));
    const RVW = /\bRVs?\b|hook ?-?ups?|\b(30|50)\s?-?amps?\b|sewer|dump station|dry camp|boondock|camp ?sites?/i;
    const lines = [...new Set(body.split(/(?<=[.!?])\s+/).filter(x => RVW.test(x) && x.length > 8 && x.length < 260 && !/^\s*RV Parking\s*$/i.test(x)).map(x => x.trim()))].slice(0, 8);
    const name = (body.match(/([A-Z][A-Za-z .'-]+,\s?[A-Z]{2})\s+(?:Lodge\s+)?(?:No\.?|#)\s*\d+/) || [])[0] || '';
    let summary = '';
    if (lines.length && env.ANTHROPIC_API_KEY) {
      const r = await claude(env, env.SCAN_MODEL || 'claude-haiku-5-5', [{ type: 'text', text: 'From these lines on an Elks Lodge website, summarize its RV parking in under 18 words: number of sites, power (amps), water/sewer, price per night, who may stay, how to reserve. Only use facts stated. Reply with just the summary.\n\n' + lines.join('\n') }], 120);
      summary = (r.text || '').trim().slice(0, 200);
    }
    if (!summary && lines.length) summary = lines.slice(0, 2).join(' ').slice(0, 200);
    const out = { lodge: n, name, url: home, rvUrl, found: true, rv: lines.length > 0, summary, lines, at: Date.now() };
    await KV.put(ck, JSON.stringify(out));
    return json(out, 200, cors);
  }

  // --- photos: sort pictures into real photos vs screenshots, maps/papers and item shots ---
  // The TV's view-only pass may use this too (its Favorites folder slideshow skips screenshots and item photos).
  // The TV sends Google Drive preview links instead of picture data; the relay fetches small copies itself.
  if (path === 'classify' && req.method === 'POST') {
    if (!env.ANTHROPIC_API_KEY) return json({ error: 'Sorting photos needs an ANTHROPIC_API_KEY secret in the relay’s settings.' }, 500, cors);
    const { images } = await body();
    const list = (Array.isArray(images) ? images : []).filter(x => x && typeof x.id === 'string').slice(0, 12);
    for (const x of list) {
      if (typeof x.data === 'string' || typeof x.url !== 'string') continue;
      let u; try { u = new URL(x.url); } catch { continue; }
      if (u.protocol !== 'https:' || !/(^|\.)googleusercontent\.com$/.test(u.hostname)) continue;   // Google's photo previews only
      try { const r = await fetch(x.url.replace(/=s\d+$/, '') + '=s384');
        if (r.ok) { const b = new Uint8Array(await r.arrayBuffer()); let bin = ''; for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000)); x.data = btoa(bin); } } catch { }
    }
    const pics = list.filter(x => typeof x.data === 'string' && x.data.length < 400000);
    if (!pics.length) return json({ error: 'No photos sent' }, 400, cors);
    const content = [];
    pics.forEach((x, i) => { content.push({ type: 'text', text: `Picture ${i + 1} (id ${x.id}):` }); content.push({ type: 'image', source: { type: 'base64', media_type: x.data.startsWith('iVBOR') ? 'image/png' : x.data.startsWith('UklGR') ? 'image/webp' : 'image/jpeg', data: x.data } }); });
    content.push({ type: 'text', text: [
      'Sort each picture into exactly one kind:',
      '"photo": a memory worth keeping: people, pets, places, scenery, events, parties, costumes, food or moments, including photos of art or fire at an event.',
      '"screenshot": a capture of a phone, tablet or computer screen (apps, web pages, forms, messages, settings), or a photo pointed at a screen.',
      '"paper": maps, signs, printed schedules, documents, receipts, menus, labels, whiteboards, notes, or a photo taken mainly to read text.',
      '"item": a close-up of an object or product taken for reference rather than as a memory: appliances, panels, parts, boxes, serial numbers, things to buy or fix.',
      'When a person is clearly the subject, it is a "photo" even if there is text or an object too.',
      'Reply with only JSON: an array of {"id": "...", "kind": "photo|screenshot|paper|item"} in order.',
    ].join('\n') });
    const r = await claude(env, env.SCAN_MODEL || 'claude-haiku-5-5', content, 800);
    if (r.error) return json({ error: r.error }, 502, cors);
    const arr = jsonFrom(r.text, []);
    const ok = new Set(['photo', 'screenshot', 'paper', 'item']);
    return json({ results: (Array.isArray(arr) ? arr : []).map(x => ({ id: String(x.id || ''), kind: ok.has(x.kind) ? x.kind : 'photo' })) }, 200, cors);
  }

  // --- flights: read a pasted confirmation email into flight details ---
  if (path === 'flight-parse' && req.method === 'POST' && full) {
    if (!env.ANTHROPIC_API_KEY) return json({ error: 'Reading confirmations needs an ANTHROPIC_API_KEY secret in the relay’s settings.' }, 500, cors);
    const { text } = await body();
    if (!text || typeof text !== 'string') return json({ error: 'Paste the confirmation first' }, 400, cors);
    const ask = [
      'Below is an airline booking confirmation or itinerary. Pull out every flight segment.',
      'Reply with only JSON: an array of {"airline": "two-letter IATA code", "airlineName": "...", "number": "flight number digits", "from": "IATA airport code", "to": "IATA airport code", "date": "YYYY-MM-DD local departure date", "depart": "HH:MM 24h local", "arrive": "HH:MM 24h local", "arriveDate": "YYYY-MM-DD", "conf": "confirmation / record locator", "seat": "", "passengers": ["names"]}. Use "" for anything not shown.',
      '---', String(text).slice(0, 20000),
    ].join('\n');
    const r = await claude(env, env.SCAN_MODEL || 'claude-haiku-5-5', [{ type: 'text', text: ask }], 1500);
    if (r.error) return json({ error: r.error }, 502, cors);
    const arr = jsonFrom(r.text, []);
    return json({ flights: Array.isArray(arr) ? arr.slice(0, 12) : [] }, 200, cors);
  }

  // --- link titles: look up a web page's title for a new favorite ---
  if (path === 'linkinfo' && req.method === 'GET' && full) {
    let u; try { u = new URL(url.searchParams.get('url') || ''); } catch { return json({ error: 'Bad link' }, 400, cors); }
    if (!/^https?:$/.test(u.protocol)) return json({ error: 'Bad link' }, 400, cors);
    try {
      const r = await fetch(u.toString(), { headers: { 'User-Agent': 'Mozilla/5.0 (Peggy link preview)', 'Accept': 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(6000) });
      const text = (await r.text()).slice(0, 200000);
      const pick = re => { const m = text.match(re); return m ? decodeEntities(m[1].trim()).slice(0, 200) : ''; };
      const title = pick(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)/i) || pick(/<title[^>]*>([^<]+)<\/title>/i);
      return json({ title, url: r.url || u.toString() }, 200, cors);
    } catch { return json({ title: '' }, 200, cors); }
  }

  // --- TV agenda: both people's chosen calendars, merged ---
  if (path === 'agenda' && req.method === 'GET') {
    const days = Math.min(31, Math.max(1, +url.searchParams.get('days') || 7));
    const from = new Date(url.searchParams.get('from') || Date.now());
    const to = new Date(from.getTime() + days * 86400000);
    const seen = new Set(), events = [], problems = [];
    for (const e of emails) {
      const user = await KV.get('user:' + e, 'json'); if (!user || !user.refresh) continue;
      const prefs = (await KV.get('prefs:' + e, 'json')) || {};
      const cals = (prefs.calendars || []).filter(c => c.show !== false);
      if (!cals.length) continue;
      const t = await accessFor(env, KV, user); if (!t) { problems.push(e); continue; }
      for (const c of cals) {
        const q = new URLSearchParams({ timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '250' });
        const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(c.id)}/events?${q}`, { headers: { Authorization: 'Bearer ' + t.access_token } });
        if (!r.ok) continue;
        const d = await r.json();
        for (const ev of d.items || []) {
          if (ev.status === 'cancelled') continue;
          const k = (ev.iCalUID || ev.id) + '|' + (ev.start && (ev.start.dateTime || ev.start.date));
          if (seen.has(k)) continue; seen.add(k);
          events.push({ id: ev.id, title: ev.summary || '(No title)', start: ev.start, end: ev.end, location: ev.location || '', calendar: c.name || c.id, color: c.color || '', who: user.name });
        }
      }
    }
    events.sort((a, b) => String(a.start.dateTime || a.start.date).localeCompare(String(b.start.dateTime || b.start.date)));
    return json({ events, problems }, 200, cors);
  }

  return json({ error: 'Not found' }, 404, cors);
}

function applyOp(doc, op, email) {
  if (!op || typeof op !== 'object') return;
  const now = Date.now();
  const coll = op.kind === 'list' ? (doc.lists = doc.lists || []) : (doc.items = doc.items || []);
  if (op.op === 'upsert' && op.item && op.item.id) {
    const i = coll.findIndex(x => x.id === op.item.id);
    const incoming = { ...op.item, updatedAt: op.item.updatedAt || now, updatedBy: email };
    if (i < 0) coll.push({ createdAt: now, createdBy: email, ...incoming });
    else if ((incoming.updatedAt || 0) >= (coll[i].updatedAt || 0)) coll[i] = { ...coll[i], ...incoming };
  } else if (op.op === 'delete' && op.id) {
    const i = coll.findIndex(x => x.id === op.id); if (i >= 0) coll.splice(i, 1);
  }
}

async function googleToken(env, params) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, ...params }),
  });
  return r.json();
}
async function accessFor(env, KV, user) {
  if (!user) return null;
  if (user.access && user.exp > Date.now() + 30000) return { access_token: user.access, expires_in: Math.floor((user.exp - Date.now()) / 1000), scope: user.scope };
  if (!user.refresh) return null;
  const t = await googleToken(env, { refresh_token: user.refresh, grant_type: 'refresh_token' });
  if (t.error) { if (t.error === 'invalid_grant') { delete user.refresh; await KV.put('user:' + user.email, JSON.stringify(user)); } return null; }
  user.access = t.access_token; user.exp = Date.now() + (t.expires_in - 60) * 1000; if (t.scope) user.scope = t.scope;
  await KV.put('user:' + user.email, JSON.stringify(user));
  return { access_token: t.access_token, expires_in: t.expires_in - 60, scope: user.scope };
}
async function sessionOf(req, KV) { const t = req.headers.get('X-Peggy-Session'); if (!t || t.length < 20) return null; return KV.get('session:' + t, 'json'); }
async function claude(env, model, content, max_tokens) {
  const r = await fetch('https://api.anthropic.com/v1/messages', { method: 'POST',
    headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model, max_tokens, messages: [{ role: 'user', content }] }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) return { error: (d.error && d.error.message) || ('Claude answered ' + r.status) };
  return { text: (d.content || []).filter(c => c.type === 'text').map(c => c.text).join('') };
}
function jsonFrom(text, dflt) { try { const m = String(text).match(/[\[{][\s\S]*[\]}]/); return JSON.parse(m ? m[0] : text); } catch { return dflt; } }
function publicUser(u) { return { email: u.email, name: u.name || u.email.split('@')[0], picture: u.picture || '', signedIn: !!u.refresh }; }
function token() { const b = new Uint8Array(24); crypto.getRandomValues(b); return [...b].map(x => x.toString(16).padStart(2, '0')).join(''); }
function decodeJwt(j) { try { const p = j.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'); return JSON.parse(decodeURIComponent(escape(atob(p + '==='.slice((p.length + 3) % 4))))); } catch { return {}; } }
function decodeEntities(s) { return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)); }
