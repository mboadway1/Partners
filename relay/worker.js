// Partners relay — a small Cloudflare Worker that Partners talks to.
//
//  1. Google Photos relay (Google doesn't allow browsers to call it directly):
//       /picker/<path>   ->  https://photospicker.googleapis.com/<path>
//       /media?u=<url>   ->  photo bytes from *.googleusercontent.com
//  2. Partners' shared space for two people (tasks, link favorites, calendar for the TV):
//       /api/...         sign-in, shared data, TV agenda
//
// Settings (Cloudflare → the worker → Settings → Variables and Secrets / Bindings):
//   ALLOWED_ORIGINS       text    https://mboadway1.github.io
//   ALLOWED_EMAILS        text    the two Gmail addresses allowed in, comma-separated
//   GOOGLE_CLIENT_ID      text    the Partners OAuth client ID
//   GOOGLE_CLIENT_SECRET  secret  the Partners OAuth client secret
//   PARTNERS_KV           KV namespace binding (stores sign-ins and shared data)
//   For subscriptions (other couples; the two ALLOWED_EMAILS are the "home" couple and never pay):
//   STRIPE_SECRET_KEY     secret  Stripe secret key (sk_test_… while testing, sk_live_… when selling)
//   STRIPE_WEBHOOK_SECRET secret  signing secret of the Stripe webhook that points at /stripe/webhook
//   STRIPE_PRICE_MONTH    text    Stripe price ID of the monthly plan (price_…)
//   STRIPE_PRICE_YEAR     text    Stripe price ID of the annual plan (price_…)
//   APP_URL               text    https://mboadway1.github.io/Partners/
//   For Mail with Outlook / Hotmail accounts (optional):
//   MS_CLIENT_ID          text    Application (client) ID of the Microsoft app registration
//   MS_CLIENT_SECRET      secret  its client secret value

import { connect } from 'cloudflare:sockets';   // Mail: talking IMAP to Yahoo, iCloud, AOL and others

const HOME = 'home', TRIAL_DAYS = 14, AI_PER_DAY = 60;
const DOCS = ['tasks', 'links', 'shared', 'expenses', 'closet', 'flights', 'us'];   // shared = shared photo albums (lists) and the photos in them (items)

export default {
  async fetch(req, env) {
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    const origin = req.headers.get('Origin') || '';
    const okOrigin = allowed.includes(origin);
    const cors = {
      'Access-Control-Allow-Origin': okOrigin ? origin : (allowed[0] || ''),
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Partners-Session, X-Peggy-Session',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    };
    // Stripe calls this from its servers (no browser Origin); it's checked by its signature instead.
    if (new URL(req.url).pathname === '/stripe/webhook' && req.method === 'POST') {
      try { return await stripeWebhook(req, env); } catch (e) { return new Response('Error: ' + (e && e.message || e), { status: 500 }); }
    }
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

/* ---------------- Partners shared space ---------------- */
async function api(req, env, url, cors) {
  // Storage is bound as PARTNERS_KV (the old PEGGY_KV name still works while switching over).
  const KV = env.PARTNERS_KV || env.PEGGY_KV;
  if (!KV) return json({ error: 'The PARTNERS_KV storage isn’t connected to this worker yet.' }, 500, cors);
  const path = url.pathname.slice(5);           // after "/api/"
  const emails = (env.ALLOWED_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const body = async () => { try { return await req.json(); } catch { return {}; } };

  // --- sign-in with Google: exchange Google's one-time code for tokens, kept here so nobody has to sign in again ---
  // The two home members sign in as before. Anyone else gets (or reuses) their own Partners account; someone
  // already signed in with email and password connects Google to that account instead (for Calendar and Photos).
  if (path === 'auth/exchange' && req.method === 'POST') {
    const { code, redirect_uri, invite } = await body();
    if (!code || !redirect_uri) return json({ error: 'Missing code' }, 400, cors);
    const t = await googleToken(env, { code, redirect_uri, grant_type: 'authorization_code' });
    if (t.error) return json({ error: t.error_description || t.error }, 400, cors);
    const claims = decodeJwt(t.id_token);
    const gmail = (claims.email || '').toLowerCase();
    if (!gmail) return json({ error: 'Google didn’t share an email address.' }, 400, cors);
    const s0 = await sessionOf(req, KV);
    let email = gmail, session = '';
    if (s0 && !s0.ro && s0.email !== gmail && !emails.includes(s0.email) && await KV.get('acct:' + s0.email)) { email = s0.email; session = sessionToken(req); }
    else if (!emails.includes(gmail)) {
      let a = await KV.get('acct:' + gmail, 'json');
      if (!a) { a = { email: gmail, name: claims.given_name || claims.name || gmail.split('@')[0], created: Date.now(), google: true };
        const j = invite ? await joinCouple(KV, a, invite) : null;
        if (j && j.error) return json(j, 400, cors);
        if (!j) a.couple = (await newCouple(KV, gmail)).id;
        await KV.put('acct:' + gmail, JSON.stringify(a)); }
      else if (invite && !a.couple) { const j = await joinCouple(KV, a, invite); if (j.error) return json(j, 400, cors); await KV.put('acct:' + gmail, JSON.stringify(a)); }
    }
    const user = (await KV.get('user:' + email, 'json')) || { email };
    Object.assign(user, { name: user.name && email !== gmail ? user.name : (claims.given_name || claims.name || email.split('@')[0]), fullName: claims.name || '', picture: claims.picture || '',
      google: gmail, access: t.access_token, exp: Date.now() + (t.expires_in - 60) * 1000, scope: t.scope });
    if (t.refresh_token) user.refresh = t.refresh_token;
    await KV.put('user:' + email, JSON.stringify(user));
    if (!session) { session = token(); await KV.put('session:' + session, JSON.stringify({ email, ro: false, created: Date.now() })); }
    return json({ session, me: publicUser(user), access_token: t.access_token, expires_in: t.expires_in - 60, scope: t.scope }, 200, cors);
  }

  // --- accounts with email and password ---
  if (path === 'auth/signup' && req.method === 'POST') {
    const b = await body(), email = String(b.email || '').trim().toLowerCase(), name = String(b.name || '').trim().slice(0, 40);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 120) return json({ error: 'Please enter a valid email address.' }, 400, cors);
    if (String(b.password || '').length < 8) return json({ error: 'Use a password with at least 8 characters.' }, 400, cors);
    if (emails.includes(email) || await KV.get('acct:' + email)) return json({ error: 'There’s already an account with that email. Log in instead.' }, 409, cors);
    const a = { email, name: name || email.split('@')[0], created: Date.now(), pw: await pwHash(String(b.password)) };
    const j = b.invite ? await joinCouple(KV, a, b.invite) : null;
    if (j && j.error) return json(j, 400, cors);
    if (!j) a.couple = (await newCouple(KV, email)).id;
    await KV.put('acct:' + email, JSON.stringify(a));
    await KV.put('user:' + email, JSON.stringify({ email, name: a.name }));
    const session = token(); await KV.put('session:' + session, JSON.stringify({ email, ro: false, created: Date.now() }));
    return json({ session, me: publicUser({ email, name: a.name }) }, 200, cors);
  }
  if (path === 'auth/login' && req.method === 'POST') {
    const b = await body(), email = String(b.email || '').trim().toLowerCase();
    const rl = 'rl:' + email, tries = +(await KV.get(rl) || 0);
    if (tries >= 10) return json({ error: 'Too many tries. Please wait 15 minutes and try again.' }, 429, cors);
    const a = await KV.get('acct:' + email, 'json');
    const ok = a && a.pw && await pwCheck(String(b.password || ''), a.pw);
    if (!ok) { await KV.put(rl, String(tries + 1), { expirationTtl: 900 });
      return json({ error: a && !a.pw ? 'This account uses Google. Tap “Continue with Google”.' : 'That email and password don’t match.' }, 401, cors); }
    const u = (await KV.get('user:' + email, 'json')) || { email, name: a.name };
    const session = token(); await KV.put('session:' + session, JSON.stringify({ email, ro: false, created: Date.now() }));
    return json({ session, me: publicUser(u) }, 200, cors);
  }

  const s = await sessionOf(req, KV);
  const cp = s ? await coupleFor(env, KV, s.email) : null;
  if (!s || !cp) return json({ error: 'Please sign in again.', reauth: true }, 401, cors);
  const full = !s.ro, home = cp.id === HOME, K = key => home ? key : `c:${cp.id}:${key}`;

  // --- your couple: who's in it, inviting your partner, the plan ---
  if (path === 'couple' && req.method === 'GET') return json(coupleView(cp, s.email), 200, cors);
  if (path === 'couple/invite' && req.method === 'POST' && full) {
    if (home) return json({ error: 'You’re both already in.' }, 400, cors);
    if (cp.members.length >= 2) return json({ error: 'Your couple already has two people.' }, 400, cors);
    const code = inviteCode(); await KV.put('inv:' + code, JSON.stringify({ couple: cp.id, by: s.email }), { expirationTtl: 7 * 86400 });
    return json({ code, link: (env.APP_URL || 'https://mboadway1.github.io/Partners/') + 'welcome.html?invite=' + code }, 200, cors);
  }
  if (path === 'couple/join' && req.method === 'POST' && full) {
    if (home) return json({ error: 'You’re already in.' }, 400, cors);
    const a = await KV.get('acct:' + s.email, 'json'); const j = await joinCouple(KV, a, (await body()).code);
    if (j.error) return json(j, 400, cors);
    await KV.put('acct:' + s.email, JSON.stringify(a)); return json(coupleView(j.couple, s.email), 200, cors);
  }
  // --- subscription (Stripe) ---
  if (path === 'billing/checkout' && req.method === 'POST' && full) {
    if (home) return json({ error: 'Your account is free.' }, 400, cors);
    if (!env.STRIPE_SECRET_KEY) return json({ error: 'Payments aren’t set up yet.' }, 500, cors);
    const interval = (await body()).interval === 'year' ? 'year' : 'month';
    const price = interval === 'year' ? env.STRIPE_PRICE_YEAR : env.STRIPE_PRICE_MONTH;
    if (!price) return json({ error: 'Payments aren’t set up yet (missing price).' }, 500, cors);
    const app = env.APP_URL || 'https://mboadway1.github.io/Partners/', p = cp.plan || {};
    const f = { mode: 'subscription', 'line_items[0][price]': price, 'line_items[0][quantity]': '1', client_reference_id: cp.id,
      'subscription_data[metadata][couple]': cp.id, 'metadata[couple]': cp.id, allow_promotion_codes: 'true',
      success_url: app + 'account.html?paid=1', cancel_url: app + 'account.html' };
    // Keep what's left of the free trial (Stripe needs at least two days of it).
    if (p.status === 'trialing' && !p.sub && (p.trialEnds || 0) > Date.now() + 2.1 * 864e5) f['subscription_data[trial_end]'] = String(Math.floor(p.trialEnds / 1000));
    if (p.customer) f.customer = p.customer; else f.customer_email = s.email;
    const r = await stripe(env, 'checkout/sessions', f);
    if (r.error) return json({ error: r.error.message || 'Stripe error' }, 502, cors);
    return json({ url: r.url }, 200, cors);
  }
  if (path === 'billing/portal' && req.method === 'POST' && full) {
    const p = cp.plan || {};
    if (!p.customer) return json({ error: 'There’s no subscription to manage yet.' }, 400, cors);
    const r = await stripe(env, 'billing_portal/sessions', { customer: p.customer, return_url: (env.APP_URL || 'https://mboadway1.github.io/Partners/') + 'account.html' });
    if (r.error) return json({ error: r.error.message || 'Stripe error' }, 502, cors);
    return json({ url: r.url }, 200, cors);
  }
  // Trial over and no subscription: only account and billing work until a plan is chosen.
  const OPEN = ['me', 'members', 'couple', 'auth/signout', 'auth/token', 'settings', 'profile', 'prefs', 'couple-photo'];
  if (!canUse(cp) && !OPEN.includes(path)) return json({ error: 'Your free trial has ended. Choose a plan to keep using Partners.', paywall: true }, 402, cors);
  // A fair-use limit on Claude for subscribers, so costs stay predictable.
  if (!home && ['caption', 'rephrase', 'concern-ai', 'classify', 'mail/ai'].includes(path)) {
    const dk = `ai:${cp.id}:${new Date().toISOString().slice(0, 10)}`, n = +(await KV.get(dk) || 0);
    if (n >= AI_PER_DAY) return json({ error: 'You’ve used today’s Claude help. It resets tomorrow.' }, 429, cors);
    await KV.put(dk, String(n + 1), { expirationTtl: 2 * 86400 });
  }

  // --- Mail (each person's own, never shared with the partner) ---
  if (path.startsWith('mail/')) { if (!full) return json({ error: 'Read-only' }, 403, cors); return mailApi(req, env, KV, s, path, body, cors); }

  if (path === 'auth/token' && req.method === 'GET') {
    if (!full) return json({ error: 'Read-only' }, 403, cors);
    const user = await KV.get('user:' + s.email, 'json');
    const t = await accessFor(env, KV, user);
    // Not a Partners sign-in problem (that's 401): this account just has no working Google connection.
    if (!t) return json({ error: user && user.google ? 'Google sign-in expired. Connect Google again in Settings → Account.' : 'Connect your Google account first (Settings → Account → Connect Google).', google: true }, 412, cors);
    return json(t, 200, cors);
  }
  if (path === 'auth/signout' && req.method === 'POST') {
    await KV.delete('session:' + sessionToken(req));
    return json({ ok: true }, 200, cors);
  }
  if (path === 'me' && req.method === 'GET') {
    const user = await KV.get('user:' + s.email, 'json');
    return json({ me: publicUser(user || { email: s.email }), readOnly: !full, couple: coupleView(cp, s.email) }, 200, cors);
  }
  if (path === 'members' && req.method === 'GET') {
    const list = [];
    for (const e of cp.members) {
      const u = await KV.get('user:' + e, 'json'), pr = (await KV.get('profile:' + e, 'json')) || {};
      const m = publicUser(u || { email: e });
      if (pr.name) m.name = pr.name;          // the name each partner chose in Settings
      m.color = pr.color || ''; m.theme = pr.theme || '';
      list.push(m);
    }
    const ph = await KV.get(K('couple:at'));
    return json({ members: list, couplePhoto: ph ? Number(ph) : 0 }, 200, cors);
  }
  // Settings kept in sync between the TV, the Chromebook and both phones. The TV's view-only pass may write these too.
  if (path === 'settings') {
    const raw = (await KV.get(K('settings'), 'json')) || {}, cur = {};
    for (const [k, x] of Object.entries(raw)) { const n = k.replace(/^peggy\./, 'partners.'); if (!cur[n] || cur[n].at < x.at) cur[n] = x; }
    if (req.method === 'GET') return json(cur, 200, cors);
    if (req.method === 'PUT') {
      const { changes } = await body();
      for (let [k, x] of Object.entries(changes || {})) {
        if (!/^(peggy|partners)\.[\w.]{1,60}$/.test(k) || !x || typeof x.at !== 'number') continue;
        k = k.replace(/^peggy\./, 'partners.');
        if (x.v != null && String(x.v).length > 4000) continue;
        if (!cur[k] || cur[k].at < x.at) cur[k] = { v: x.v == null ? null : String(x.v), at: x.at };
      }
      if (JSON.stringify(cur).length < 200000) await KV.put(K('settings'), JSON.stringify(cur));
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
      const d = await KV.get(K('couple:photo'), 'arrayBuffer');
      if (!d) return json({ error: 'No couples photo yet' }, 404, cors);
      return new Response(d, { status: 200, headers: { ...cors, 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, max-age=60' } });
    }
    if (req.method === 'PUT' && full) {
      const buf = await req.arrayBuffer();
      if (!buf.byteLength || buf.byteLength > 4_000_000) return json({ error: 'Photo is too large' }, 400, cors);
      await KV.put(K('couple:photo'), buf); const at = Date.now(); await KV.put(K('couple:at'), String(at));
      return json({ ok: true, at }, 200, cors);
    }
    if (req.method === 'DELETE' && full) { await KV.delete(K('couple:photo')); await KV.delete(K('couple:at')); return json({ ok: true }, 200, cors); }
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
    const key = K('doc:' + dm[1]);
    if (req.method === 'GET') return json(viewFor((await KV.get(key, 'json')) || { v: 0, items: [], lists: [] }, s.email), 200, cors);
    if (req.method === 'POST' && full) {
      const { ops } = await body();
      const doc = (await KV.get(key, 'json')) || { v: 0, items: [], lists: [] };
      for (const op of (ops || []).slice(0, 2000)) if (mayChange(doc, op, s.email)) applyOp(doc, op, s.email);
      doc.v = (doc.v || 0) + 1; doc.updated = Date.now();
      await KV.put(key, JSON.stringify(doc));
      return json(viewFor(doc, s.email), 200, cors);
    }
  }

  // --- shared album photos, kept in Cloudflare R2 (binding PARTNERS_R2) ---
  const pm = path.match(/^photo\/([\w-]{8,64})(?:\/(full))?$/);
  if (pm) {
    const R2 = env.PARTNERS_R2;
    if (!R2) return json({ error: 'Shared albums need the PARTNERS_R2 photo storage connected to the relay.' }, 500, cors);
    const key = (home ? '' : `c/${cp.id}/`) + 'photos/' + pm[1] + '/full';
    if (req.method === 'GET') {
      const o = await R2.get(key);
      if (!o) return json({ error: 'Photo not found' }, 404, cors);
      return new Response(o.body, { status: 200, headers: { ...cors, 'Content-Type': (o.httpMetadata && o.httpMetadata.contentType) || 'image/jpeg', 'Cache-Control': 'private, max-age=31536000, immutable' } });
    }
    if (req.method === 'PUT' && full) {
      const len = +(req.headers.get('Content-Length') || 0);
      if (len > 20e6) return json({ error: 'Photo too big' }, 413, cors);
      const buf = await req.arrayBuffer();
      if (!buf.byteLength || buf.byteLength > 20e6) return json({ error: 'Photo missing or too big' }, 400, cors);
      await R2.put(key, buf, { httpMetadata: { contentType: req.headers.get('Content-Type') || 'image/jpeg' }, customMetadata: { by: s.email } });
      return json({ ok: true, size: buf.byteLength }, 200, cors);
    }
    if (req.method === 'DELETE' && full) { await R2.delete(key); return json({ ok: true }, 200, cors); }
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

  // --- Concerns in Us: help word a complaint, understand one, and find a small next step ---
  if (path === 'concern-ai' && req.method === 'POST' && full) {
    if (!env.ANTHROPIC_API_KEY) return json({ error: 'This needs an ANTHROPIC_API_KEY secret in the relay’s settings.' }, 500, cors);
    const b = await body(), mode = String(b.mode || ''), cut = (v, n) => String(v || '').slice(0, n);
    const user = await KV.get('user:' + s.email, 'json'), me = (user && user.name) || 'Someone', other = cut(b.partner, 40) || 'their partner';
    const feelings = Array.isArray(b.feelingKeys) ? b.feelingKeys.slice(0, 20).map(x => cut(x, 20)) : [];
    const c = b.concern || {}, thread = [
      c.about && `What happened: ${cut(c.about, 1500)}`, c.feelings && c.feelings.length && `Feelings: ${c.feelings.map(x => cut(x, 30)).join(', ')}`,
      c.need && `What they'd like: ${cut(c.need, 800)}`, c.clarify && `They later added: ${cut(c.clarify, 800)}`,
      c.heard && `The partner said back: ${cut(c.heard, 800)}`, c.side && `The partner's side: ${cut(c.side, 1200)}`,
    ].filter(Boolean).join('\n');
    const base = 'You help a loving couple talk about a complaint calmly, using ideas from couples research (gentle start-up, complaint not criticism, reflective listening, validation, small repair steps). Warm, plain, everyday words; no therapy jargon; never take sides or diagnose either person. '
      + 'If anything describes being hurt, threatened, controlled or unsafe, do not coach them to smooth it over: put a short kind note in the "safety" field that they deserve to feel safe and can call or text the National Domestic Violence Hotline (1-800-799-7233, or text START to 88788). Otherwise leave "safety" empty. Reply with only JSON.';
    let ask;
    if (mode === 'shape') ask = [base,
      `${me} wants to raise something with ${other}. Below is what they wrote, maybe messy or angry. Turn it into a calm, specific complaint in their own voice (first person), keeping their real concern; don't add anything they didn't say and don't water it down to nothing.`,
      `JSON: {"about": "one specific situation, no blame, no always/never, written to follow the word 'When' (e.g. 'plans changed last night and I found out last minute')", "feelings": [1-3 keys chosen only from: ${feelings.join(', ')}], "need": "a specific, positive request written to follow 'I'd like' (e.g. 'a heads-up text when plans change')", "tip": "one sentence on timing or tone", "safety": ""}`,
      '---', cut(b.text, 3000)].join('\n');
    else if (mode === 'understand') ask = [base,
      `${other} raised this with ${me}. Help ${me} understand it and show they get it, before any defending or fixing.`,
      `JSON: {"underneath": "2-3 short sentences on what ${other} is probably feeling and needing, and why it may matter so much to them", "reflect": "what ${me} could say back, in first person, starting 'What I heard is', ending with 'Did I get that right?'", "validate": "one or two sentences starting 'It makes sense you'd feel that way'", "avoid": ["2-3 short things not to say right now, e.g. defending or 'you're overreacting'"], "ask": "one gentle question ${me} could ask to understand more", "safety": ""}`,
      '---', thread].join('\n');
    else if (mode === 'steps') ask = [base,
      `${me} and ${other} have talked this through and feel understood. Suggest small, concrete, doable steps that address the need, fair to both. Not big promises.`,
      `JSON: {"steps": ["3 short steps, each under 12 words, starting with a verb"], "note": "one encouraging sentence", "safety": ""}`,
      '---', thread].join('\n');
    else return json({ error: 'Unknown request' }, 400, cors);
    const r = await claude(env, env.CAPTION_MODEL || 'claude-sonnet-5-5', [{ type: 'text', text: ask }], 900);
    if (r.error) return json({ error: r.error }, 502, cors);
    const d = jsonFrom(r.text, {}), str = (v, n) => cut(typeof v === 'string' ? v : '', n), arr = (v, n) => (Array.isArray(v) ? v : []).slice(0, n).map(x => str(x, 200)).filter(Boolean);
    if (mode === 'shape') return json({ about: str(d.about, 600), feelings: arr(d.feelings, 3).filter(k => feelings.includes(k)), need: str(d.need, 400), tip: str(d.tip, 300), safety: str(d.safety, 400) }, 200, cors);
    if (mode === 'understand') return json({ underneath: str(d.underneath, 700), reflect: str(d.reflect, 700), validate: str(d.validate, 400), avoid: arr(d.avoid, 3), ask: str(d.ask, 300), safety: str(d.safety, 400) }, 200, cors);
    return json({ steps: arr(d.steps, 3), note: str(d.note, 300), safety: str(d.safety, 400) }, 200, cors);
  }

  // --- Elks lodges: read the lodge's own elks.org page for RV parking details (cached a week) ---
  if (path === 'elks-rv' && req.method === 'GET') {
    const n = (url.searchParams.get('lodge') || '').replace(/\D/g, '').slice(0, 5);
    if (!n) return json({ error: 'Lodge number missing' }, 400, cors);
    const ck = 'elksrv:' + n, hit = await KV.get(ck, 'json');
    if (hit && Date.now() - hit.at < 7 * 864e5) return json(hit, 200, cors);
    const home = 'https://www.elks.org/lodges/home.cfm?lodge=' + n;
    const get = async u => { try { const r = await fetch(u, { headers: { 'User-Agent': 'Mozilla/5.0 (Partners RV lookup)', 'Accept': 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(7000) }); return r.ok ? (await r.text()).slice(0, 400000) : ''; } catch { return ''; } };
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
      const r = await fetch(u.toString(), { headers: { 'User-Agent': 'Mozilla/5.0 (Partners link preview)', 'Accept': 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(6000) });
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
    for (const e of cp.members) {
      const user = await KV.get('user:' + e, 'json'); if (!user || !user.refresh) continue;
      const prefs = (await KV.get('prefs:' + e, 'json')) || {};
      const cals = (prefs.calendars || []).filter(c => c.show !== false);
      const hid = new Set((prefs.hiddenNames || []).map(n => String(n).toLowerCase()));   // events this person chose to hide by name
      if (!cals.length) continue;
      const t = await accessFor(env, KV, user); if (!t) { problems.push(e); continue; }
      for (const c of cals) {
        const q = new URLSearchParams({ timeMin: from.toISOString(), timeMax: to.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '250' });
        const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(c.id)}/events?${q}`, { headers: { Authorization: 'Bearer ' + t.access_token } });
        if (!r.ok) continue;
        const d = await r.json();
        for (const ev of d.items || []) {
          if (ev.status === 'cancelled') continue;
          if (hid.has(String(ev.summary || '(No title)').trim().replace(/\s+/g, ' ').toLowerCase())) continue;
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

// Private lists (list.private + list.owner): only the owner gets them or their items, and only the owner can change them.
function othersPrivate(doc, email) { return new Set((doc.lists || []).filter(l => l.private && l.owner && l.owner !== email).map(l => l.id)); }
function viewFor(doc, email) {
  const hide = othersPrivate(doc, email); if (!hide.size) return doc;
  return { ...doc, lists: doc.lists.filter(l => !hide.has(l.id)), items: (doc.items || []).filter(t => !hide.has(t.list)) };
}
function mayChange(doc, op, email) {
  if (!op || typeof op !== 'object') return false;
  const hide = othersPrivate(doc, email); if (!hide.size) return true;
  if (op.kind === 'list') return !hide.has(op.op === 'delete' ? op.id : op.item && op.item.id);
  const id = op.op === 'delete' ? op.id : op.item && op.item.id, cur = (doc.items || []).find(x => x.id === id);
  if (cur && hide.has(cur.list)) return false;
  return !(op.item && hide.has(op.item.list));
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
// The app sends X-Partners-Session; pages that haven't updated yet still send the old header name.
function sessionToken(req) { return req.headers.get('X-Partners-Session') || req.headers.get('X-Peggy-Session') || ''; }
async function sessionOf(req, KV) { const t = sessionToken(req); if (!t || t.length < 20) return null; return KV.get('session:' + t, 'json'); }
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

/* ---------------- couples, accounts and subscriptions ---------------- */
// The two ALLOWED_EMAILS are the original "home" couple: their data keeps its original storage names and they never pay.
function homeEmails(env) { return (env.ALLOWED_EMAILS || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean); }
async function coupleFor(env, KV, email) {
  const he = homeEmails(env);
  if (he.includes(email)) return { id: HOME, owner: he[0], members: he, plan: { status: 'free' } };
  const a = await KV.get('acct:' + email, 'json'); if (!a || !a.couple) return null;
  const c = await KV.get('cpl:' + a.couple, 'json'); return c && c.members.includes(email) ? c : null;
}
async function newCouple(KV, email) {
  const c = { id: token().slice(0, 16), owner: email, members: [email], created: Date.now(), plan: { status: 'trialing', trialEnds: Date.now() + TRIAL_DAYS * 864e5 } };
  await KV.put('cpl:' + c.id, JSON.stringify(c)); return c;
}
// Join the couple an invite code belongs to (at most two people). Changes `a` (the account); the caller saves it.
async function joinCouple(KV, a, code) {
  code = String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const inv = code && await KV.get('inv:' + code, 'json'); if (!inv) return { error: 'That invite code isn’t valid or has expired. Ask your partner for a new one.' };
  const c = await KV.get('cpl:' + inv.couple, 'json'); if (!c) return { error: 'That invite is no longer valid.' };
  if (!c.members.includes(a.email)) {
    if (c.members.length >= 2) return { error: 'That couple already has two people.' };
    if (a.couple && a.couple !== c.id) {          // leave your own (new, empty) couple
      const old = await KV.get('cpl:' + a.couple, 'json');
      if (old) { old.members = old.members.filter(x => x !== a.email); if (old.members.length) await KV.put('cpl:' + old.id, JSON.stringify(old)); else if (!(old.plan && old.plan.sub)) await KV.delete('cpl:' + old.id); else await KV.put('cpl:' + old.id, JSON.stringify(old)); }
    }
    c.members.push(a.email); await KV.put('cpl:' + c.id, JSON.stringify(c));
  }
  a.couple = c.id; await KV.delete('inv:' + code);
  return { couple: c };
}
function canUse(c) {
  const p = c.plan || {};
  if (c.id === HOME || ['free', 'active', 'past_due'].includes(p.status)) return true;
  return p.status === 'trialing' && (p.trialEnds || 0) > Date.now();
}
function coupleView(c, me) {
  const p = c.plan || {};
  return { id: c.id === HOME ? HOME : 'c', members: c.members, owner: c.owner === me, canUse: canUse(c), plan: { status: p.status || 'none', trialEnds: p.trialEnds || 0,
    periodEnd: p.periodEnd || 0, interval: p.interval || '', cancelAtEnd: !!p.cancelAtEnd, hasBilling: !!p.customer } };
}
function inviteCode() { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', b = new Uint8Array(8); crypto.getRandomValues(b); return [...b].map(x => A[x % A.length]).join(''); }
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
const unhex = h => new Uint8Array(h.match(/../g).map(x => parseInt(x, 16)));
async function pwHash(pw, saltHex) {
  const salt = saltHex ? unhex(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, key, 256);
  return { salt: hex(salt), hash: hex(bits) };
}
async function pwCheck(pw, saved) { const h = (await pwHash(pw, saved.salt)).hash; let d = h.length ^ saved.hash.length; for (let i = 0; i < h.length; i++) d |= h.charCodeAt(i) ^ (saved.hash.charCodeAt(i) || 0); return d === 0; }
// Stripe's API takes form-encoded fields.
async function stripe(env, path, fields, method) {
  const r = await fetch('https://api.stripe.com/v1/' + path, { method: method || 'POST',
    headers: { Authorization: 'Bearer ' + env.STRIPE_SECRET_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: method === 'GET' ? undefined : new URLSearchParams(fields || {}) });
  return r.json();
}
// Stripe tells the relay when a subscription starts, renews, changes or ends.
async function stripeWebhook(req, env) {
  const KV = env.PARTNERS_KV || env.PEGGY_KV, raw = await req.text(), sig = req.headers.get('Stripe-Signature') || '';
  if (!env.STRIPE_WEBHOOK_SECRET) return new Response('Webhook secret missing', { status: 500 });
  const parts = Object.fromEntries(sig.split(',').map(x => x.split('=')).filter(x => x.length === 2).map(([k, v]) => [k, v]));
  const v1s = sig.split(',').filter(x => x.startsWith('v1=')).map(x => x.slice(3));
  if (!parts.t || !v1s.length || Math.abs(Date.now() / 1000 - +parts.t) > 600) return new Response('Bad signature', { status: 400 });
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = hex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(parts.t + '.' + raw)));
  if (!v1s.includes(mac)) return new Response('Bad signature', { status: 400 });
  const ev = JSON.parse(raw), o = (ev.data && ev.data.object) || {};
  const save = async (cid, fn) => { if (!cid) return; const c = await KV.get('cpl:' + cid, 'json'); if (!c) return; c.plan = { ...(c.plan || {}), ...fn(c.plan || {}) }; await KV.put('cpl:' + cid, JSON.stringify(c)); };
  if (ev.type === 'checkout.session.completed') await save(o.client_reference_id || (o.metadata && o.metadata.couple), () => ({ customer: o.customer, sub: o.subscription }));
  if (/^customer\.subscription\.(created|updated|deleted)$/.test(ev.type)) {
    const item = o.items && o.items.data && o.items.data[0];
    const end = o.current_period_end || (item && item.current_period_end) || 0;
    await save(o.metadata && o.metadata.couple, () => ({ customer: o.customer, sub: o.id, status: ev.type.endsWith('deleted') ? 'canceled' : o.status,
      trialEnds: o.trial_end ? o.trial_end * 1000 : 0, periodEnd: end * 1000, interval: (item && item.price && item.price.recurring && item.price.recurring.interval) || '',
      cancelAtEnd: !!o.cancel_at_period_end }));
  }
  return new Response('ok', { status: 200 });
}

/* ---------------- Mail: each person's own email accounts, private to them ----------------
   Gmail and Outlook/Hotmail connect with their own sign-in (Partners keeps a refresh token and hands the app short-lived
   access tokens). Yahoo, iCloud, AOL and other providers use IMAP with an app password; Partners talks IMAP for the app.
   Passwords and tokens are stored encrypted. Settings for Outlook: MS_CLIENT_ID (text) and MS_CLIENT_SECRET (secret). */
const MS_SCOPE = 'offline_access openid email User.Read Mail.ReadWrite';
async function mailKey(env) {
  const raw = new TextEncoder().encode('partners-mail:' + (env.MAIL_KEY || env.GOOGLE_CLIENT_SECRET || 'partners'));
  return crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', raw), 'AES-GCM', false, ['encrypt', 'decrypt']);
}
const b64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function seal(env, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await mailKey(env), new TextEncoder().encode(JSON.stringify(obj))));
  const out = new Uint8Array(12 + ct.length); out.set(iv); out.set(ct, 12); return b64(out);
}
async function unseal(env, s) {
  const u = unb64(s), pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u.slice(0, 12) }, await mailKey(env), u.slice(12));
  return JSON.parse(new TextDecoder().decode(pt));
}
const MAIL_COLORS = ['#1a73e8', '#d93025', '#188038', '#e37400', '#9334e6', '#00838f', '#c2185b', '#5d4037'];
async function msToken(env, params) {
  const r = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.MS_CLIENT_ID || '', client_secret: env.MS_CLIENT_SECRET || '', scope: MS_SCOPE, ...params }) });
  return r.json();
}

// A tiny IMAP client over a TLS socket: just what Partners needs (log in, list the inbox, read one message, move or flag).
async function imapSession(cfg, fn) {
  const sock = connect({ hostname: cfg.host, port: +cfg.port || 993 }, { secureTransport: 'on', allowHalfOpen: false });
  const w = sock.writable.getWriter(), rd = sock.readable.getReader(), enc = new TextEncoder(), dec = new TextDecoder();
  let chunks = [], have = 0, n = 0;
  const pull = async () => { const { value, done } = await rd.read(); if (done) throw new Error('The mail server closed the connection'); chunks.push(value); have += value.length; };
  const flat = () => { if (chunks.length > 1) { const b = new Uint8Array(have); let o = 0; for (const c of chunks) { b.set(c, o); o += c.length; } chunks = [b]; } return chunks[0] || new Uint8Array(0); };
  const take = k => { const b = flat(); const out = b.slice(0, k); chunks = [b.slice(k)]; have -= k; return out; };
  const line = async () => { for (;;) { const b = flat(); for (let i = 0; i + 1 < b.length; i++) if (b[i] === 13 && b[i + 1] === 10) { const l = take(i); take(2); return dec.decode(l); } await pull(); } };
  const bytes = async k => { while (have < k) await pull(); return take(k); };
  const resp = async () => { let text = ''; const lits = []; for (;;) { const l = await line(), m = l.match(/\{(\d+)\}$/); if (m) { text += l.slice(0, -m[0].length) + '\u0000' + lits.length + '\u0000'; lits.push(await bytes(+m[1])); continue; } return { text: text + l, lits }; } };
  const cmd = async c => { const tag = 'P' + (++n); await w.write(enc.encode(tag + ' ' + c + '\r\n')); const out = [];
    for (;;) { const r = await resp(); if (r.text.startsWith(tag + ' ')) { if (!/^\S+ OK/i.test(r.text)) throw new Error('Mail server: ' + r.text.slice(tag.length + 1).replace(/^(NO|BAD)\s*/i, '').slice(0, 160)); return out; } out.push(r); } };
  const q = s => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  try {
    const hello = await resp(); if (!/^\* (OK|PREAUTH)/i.test(hello.text)) throw new Error('Not an IMAP mail server');
    await cmd(`LOGIN ${q(cfg.user)} ${q(cfg.pass)}`);
    return await fn(cmd, q);
  } finally { try { await w.write(enc.encode('Z LOGOUT\r\n')); } catch {} try { sock.close(); } catch {} }
}
const IMAP_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
async function imapFolders(cmd) {   // special folders by their flags (RFC 6154), else by common names
  const out = {}, all = await cmd('LIST "" "*"');
  for (const r of all) { const m = r.text.match(/^\* LIST \(([^)]*)\) (?:"[^"]*"|NIL) (.*)$/i); if (!m) continue;
    let name = m[2].trim(); const lit = name.match(/^\u0000(\d+)\u0000$/); if (lit) name = new TextDecoder().decode(r.lits[+lit[1]]); else name = name.replace(/^"|"$/g, '').replace(/\\(.)/g, '$1');
    const f = m[1].toLowerCase();
    if (f.includes('\\trash')) out.trash = name; if (f.includes('\\archive')) out.archive = name; if (f.includes('\\junk')) out.junk = name;
    const low = name.toLowerCase();
    if (!out.trashByName && /^(trash|deleted messages|deleted items|deleted)$/.test(low)) out.trashByName = name;
    if (!out.archiveByName && /^(archive|archives)$/.test(low)) out.archiveByName = name; }
  return { trash: out.trash || out.trashByName, archive: out.archive || out.archiveByName };
}

async function mailApi(req, env, KV, s, path, body, cors) {
  const key = 'mail:accts:' + s.email, metaKey = 'mail:meta:' + s.email;
  const accts = async () => (await KV.get(key, 'json')) || [];
  const save = list => KV.put(key, JSON.stringify(list));
  const pub = a => ({ id: a.id, kind: a.kind, address: a.address, color: a.color, provider: a.provider || '', added: a.added });
  const add = async a => { const list = await accts(); const i = list.findIndex(x => x.kind === a.kind && x.address.toLowerCase() === a.address.toLowerCase());
    if (i >= 0) { a.id = list[i].id; a.color = list[i].color; list[i] = a; } else { a.color = MAIL_COLORS[list.length % MAIL_COLORS.length]; list.push(a); }
    await save(list); return pub(a); };

  if (path === 'mail/accounts' && req.method === 'GET')
    return json({ accounts: (await accts()).map(pub), googleClientId: env.GOOGLE_CLIENT_ID || '', msClientId: env.MS_CLIENT_ID || '', ai: !!env.ANTHROPIC_API_KEY }, 200, cors);
  const dm = path.match(/^mail\/accounts\/([\w-]+)$/);
  if (dm && req.method === 'DELETE') { await save((await accts()).filter(a => a.id !== dm[1])); await KV.delete('mail:tok:' + dm[1]); return json({ ok: true }, 200, cors); }

  if (path === 'mail/connect/google' && req.method === 'POST') {
    const { code, redirect_uri } = await body();
    const t = await googleToken(env, { code, redirect_uri, grant_type: 'authorization_code' });
    if (t.error) return json({ error: t.error_description || t.error }, 400, cors);
    if (!/gmail\.modify/.test(t.scope || '')) return json({ error: 'Google didn’t allow access to Gmail. Try again and tick the Gmail box on Google’s screen.' }, 400, cors);
    if (!t.refresh_token) return json({ error: 'Google didn’t give Partners lasting access. Remove Partners at myaccount.google.com/permissions for that account, then try again.' }, 400, cors);
    const address = (decodeJwt(t.id_token).email || '').toLowerCase();
    if (!address) return json({ error: 'Google didn’t share the email address.' }, 400, cors);
    const a = await add({ id: token().slice(0, 12), kind: 'gmail', provider: 'Gmail', address, sec: await seal(env, { refresh: t.refresh_token }), added: Date.now() });
    await KV.put('mail:tok:' + a.id, JSON.stringify({ access: t.access_token, exp: Date.now() + (t.expires_in - 60) * 1000 }), { expirationTtl: 3600 });
    return json({ account: a }, 200, cors);
  }
  if (path === 'mail/connect/microsoft' && req.method === 'POST') {
    if (!env.MS_CLIENT_ID || !env.MS_CLIENT_SECRET) return json({ error: 'Outlook isn’t set up in the relay yet (MS_CLIENT_ID and MS_CLIENT_SECRET).' }, 500, cors);
    const { code, redirect_uri } = await body();
    const t = await msToken(env, { code, redirect_uri, grant_type: 'authorization_code' });
    if (t.error) return json({ error: t.error_description ? t.error_description.split('\r\n')[0] : t.error }, 400, cors);
    const me = await (await fetch('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName', { headers: { Authorization: 'Bearer ' + t.access_token } })).json().catch(() => ({}));
    const address = String(me.mail || me.userPrincipalName || decodeJwt(t.id_token).email || '').toLowerCase();
    const a = await add({ id: token().slice(0, 12), kind: 'ms', provider: 'Outlook', address, sec: await seal(env, { refresh: t.refresh_token }), added: Date.now() });
    await KV.put('mail:tok:' + a.id, JSON.stringify({ access: t.access_token, exp: Date.now() + (t.expires_in - 60) * 1000 }), { expirationTtl: 3600 });
    return json({ account: a }, 200, cors);
  }
  if (path === 'mail/connect/imap' && req.method === 'POST') {
    const b = await body(), cfg = { host: String(b.host || '').trim(), port: +b.port || 993, user: String(b.user || b.address || '').trim(), pass: String(b.pass || '').replace(/\s+/g, '') };
    const address = String(b.address || cfg.user).trim().toLowerCase();
    if (!cfg.host || !cfg.user || !cfg.pass) return json({ error: 'Fill in the email address, the mail server and the app password.' }, 400, cors);
    try { await imapSession(cfg, async cmd => { await cmd('SELECT INBOX'); }); }
    catch (e) { return json({ error: /auth|login|credential|password|invalid/i.test(e.message) ? 'The mail server didn’t accept that address and app password. Check the app password (not your normal password).' : e.message }, 400, cors); }
    return json({ account: await add({ id: token().slice(0, 12), kind: 'imap', provider: String(b.provider || 'Email').slice(0, 20), address, sec: await seal(env, cfg), added: Date.now() }) }, 200, cors);
  }

  // Short-lived access tokens for Gmail and Outlook, so the app reads mail straight from Google and Microsoft.
  const tm = path.match(/^mail\/token\/([\w-]+)$/);
  if (tm && req.method === 'GET') {
    const list = await accts(), a = list.find(x => x.id === tm[1]); if (!a || a.kind === 'imap') return json({ error: 'No such account' }, 404, cors);
    const c = await KV.get('mail:tok:' + a.id, 'json'); if (c && c.exp > Date.now() + 60000) return json({ access_token: c.access, expires_in: Math.floor((c.exp - Date.now()) / 1000) }, 200, cors);
    const sec = await unseal(env, a.sec);
    const t = a.kind === 'gmail' ? await googleToken(env, { refresh_token: sec.refresh, grant_type: 'refresh_token' }) : await msToken(env, { refresh_token: sec.refresh, grant_type: 'refresh_token' });
    if (t.error) return json({ error: `${a.address} needs to be connected again (${t.error}).`, reconnect: true }, 409, cors);
    if (t.refresh_token && t.refresh_token !== sec.refresh) { a.sec = await seal(env, { refresh: t.refresh_token }); await save(list); }   // Microsoft hands out a new one each time
    await KV.put('mail:tok:' + a.id, JSON.stringify({ access: t.access_token, exp: Date.now() + (t.expires_in - 60) * 1000 }), { expirationTtl: 3600 });
    return json({ access_token: t.access_token, expires_in: t.expires_in - 60 }, 200, cors);
  }

  // IMAP accounts: Partners reads the inbox for the app.
  const im = path.match(/^mail\/imap\/([\w-]+)\/(list|get|act)$/);
  if (im && req.method === 'POST') {
    const a = (await accts()).find(x => x.id === im[1]); if (!a || a.kind !== 'imap') return json({ error: 'No such account' }, 404, cors);
    const cfg = await unseal(env, a.sec), b = await body();
    try {
      if (im[2] === 'list') return json(await imapSession(cfg, async cmd => {
        await cmd('SELECT INBOX');
        const d = new Date(Date.now() - Math.min(90, +b.days || 30) * 864e5);
        const found = await cmd(`UID SEARCH SINCE ${d.getUTCDate()}-${IMAP_MON[d.getUTCMonth()]}-${d.getUTCFullYear()}`);
        const uids = found.map(r => r.text).join(' ').replace(/^\* SEARCH/i, '').match(/\d+/g) || [];
        const want = uids.map(Number).sort((x, y) => y - x).slice(0, Math.min(300, +b.max || 200));
        const out = [];
        for (let i = 0; i < want.length; i += 100) {
          const rs = await cmd(`UID FETCH ${want.slice(i, i + 100).join(',')} (UID FLAGS INTERNALDATE BODY.PEEK[HEADER.FIELDS (FROM TO SUBJECT DATE LIST-UNSUBSCRIBE MESSAGE-ID)])`);
          for (const r of rs) { const u = r.text.match(/UID (\d+)/); if (!u) continue;
            out.push({ uid: +u[1], flags: (r.text.match(/FLAGS \(([^)]*)\)/) || [])[1] || '', date: (r.text.match(/INTERNALDATE "([^"]+)"/) || [])[1] || '', head: r.lits[0] ? new TextDecoder().decode(r.lits[0]) : '' }); }
        }
        return { uids: uids.length, messages: out };
      }), 200, cors);
      if (im[2] === 'get') return json(await imapSession(cfg, async cmd => {
        await cmd('SELECT INBOX'); const rs = await cmd(`UID FETCH ${+b.uid} (UID BODY.PEEK[])`);
        const r = rs.find(x => x.lits.length); if (!r) throw new Error('That email isn’t in the inbox anymore');
        const raw = r.lits[0]; return { raw: b64(raw.length > 6e6 ? raw.slice(0, 6e6) : raw), cut: raw.length > 6e6 };
      }), 200, cors);
      if (im[2] === 'act') return json(await imapSession(cfg, async (cmd, q) => {
        const set = (b.uids || []).map(Number).filter(Boolean).join(','); if (!set) return { ok: true };
        await cmd('SELECT INBOX');
        if (b.action === 'read') { await cmd(`UID STORE ${set} +FLAGS.SILENT (\\Seen)`); return { ok: true }; }
        if (b.action === 'unread') { await cmd(`UID STORE ${set} -FLAGS.SILENT (\\Seen)`); return { ok: true }; }
        const f = await imapFolders(cmd), to = b.action === 'delete' ? f.trash : f.archive;
        if (!to) { if (b.action === 'archive') { await cmd(`UID STORE ${set} +FLAGS.SILENT (\\Seen)`); return { ok: true, note: 'no archive folder' }; } throw new Error('No Trash folder found'); }
        try { await cmd(`UID MOVE ${set} ${q(to)}`); }
        catch { await cmd(`UID COPY ${set} ${q(to)}`); await cmd(`UID STORE ${set} +FLAGS.SILENT (\\Deleted)`); await cmd('EXPUNGE'); }
        return { ok: true };
      }), 200, cors);
    } catch (e) { return json({ error: e.message || String(e) }, 502, cors); }
  }

  // What Partners learned about your mail (categories, your spam rules, summaries), shared by your own devices only.
  if (path === 'mail/meta') {
    const m = (await KV.get(metaKey, 'json')) || { cats: {}, rules: {} };
    if (req.method === 'GET') return json(m, 200, cors);
    if (req.method === 'POST') { const b = await body();
      for (const [k, v] of Object.entries(b.cats || {})) { if (v) m.cats[k] = String(v).slice(0, 20); else delete m.cats[k]; }
      for (const [k, v] of Object.entries(b.rules || {})) { if (v) m.rules[String(k).slice(0, 200)] = String(v).slice(0, 20); else delete m.rules[k]; }
      const ks = Object.keys(m.cats); if (ks.length > 6000) for (const k of ks.slice(0, ks.length - 6000)) delete m.cats[k];
      await KV.put(metaKey, JSON.stringify(m)); return json(m, 200, cors); }
  }

  // Claude sorts new mail and writes summaries. Only the sender, subject and the first lines are sent.
  if (path === 'mail/ai' && req.method === 'POST') {
    if (!env.ANTHROPIC_API_KEY) return json({ error: 'Claude needs an ANTHROPIC_API_KEY in the relay’s settings.' }, 500, cors);
    const b = await body(), cut = (v, n) => String(v || '').replace(/\s+/g, ' ').slice(0, n);
    const items = (Array.isArray(b.items) ? b.items : []).slice(0, 60).map((x, i) => `${i + 1}. id=${cut(x.id, 80)} | from: ${cut(x.from, 120)} | subject: ${cut(x.subject, 200)} | preview: ${cut(x.snippet, 240)}${x.hint ? ' | provider says: ' + cut(x.hint, 60) : ''}${x.unsub ? ' | has unsubscribe link' : ''}`).join('\n');
    if (b.mode === 'classify') {
      const r = await claude(env, env.SCAN_MODEL || 'claude-haiku-5-5', [{ type: 'text', text:
        'Sort each email into exactly one category for a personal unified inbox:\n'
        + '- important: needs the person’s attention or action soon (bills due, security alerts they triggered, appointments, replies from real people about something pending, travel)\n'
        + '- personal: written by a real person to them (friends, family, colleagues, clients) that isn’t urgent\n'
        + '- updates: automatic but legitimate notices (receipts, shipping, statements, account notices, calendar, newsletters they likely signed up for)\n'
        + '- promotions: marketing, sales, deals, ads from companies\n'
        + '- social: social networks and forums\n'
        + '- spam: unwanted junk, scams, phishing, fake prizes or invoices, “you have been selected”, crypto or loan pitches, look-alike brands, mismatched sender names, adult content, mass cold outreach\n'
        + 'Be careful: real bills, banks and receipts are not spam. Reply with only JSON: {"<id>": "<category>", ...}\n\n' + items }], 1500);
      if (r.error) return json({ error: r.error }, 502, cors);
      const out = jsonFrom(r.text, {}), ok = ['important', 'personal', 'updates', 'promotions', 'social', 'spam'], cats = {};
      for (const [k, v] of Object.entries(out)) if (ok.includes(v)) cats[k] = v;
      return json({ cats }, 200, cors);
    }
    if (b.mode === 'summary') {
      const one = b.body ? `Email from ${cut(b.from, 120)}, subject “${cut(b.subject, 200)}”:\n${String(b.body).slice(0, 12000)}` : '';
      const r = await claude(env, env.CAPTION_MODEL || 'claude-sonnet-5-5', [{ type: 'text', text: one
        ? 'Summarize this email for a busy person in 1–3 short bullet lines (•). Say plainly what it is, anything they must do and by when, and amounts or dates that matter. If it looks like a scam, say so first. No preamble.\n\n' + one
        : `Summarize these ${b.title ? '“' + cut(b.title, 40) + '” ' : ''}emails for a busy person. Group similar ones on one line (e.g. “3 shipping updates from Amazon”), lead with anything that needs action or has a deadline, and keep it to at most 8 short bullet lines (•). No preamble.\n\n` + items }], 700);
      if (r.error) return json({ error: r.error }, 502, cors);
      return json({ text: r.text.trim() }, 200, cors);
    }
    return json({ error: 'Unknown mode' }, 400, cors);
  }
  return json({ error: 'Not found' }, 404, cors);
}
