// Peggy account: one Google sign-in per person, kept by the relay so nobody signs in again.
// Used by index.html (photos) and plan.html (tasks, calendar, links).
'use strict';
const PEGGY = {
  clientId: '833687773280-mv05v281evtfpk4sod86ouoeci3s56ud.apps.googleusercontent.com',
  relay: 'https://peggy-relay.mboadway1.workers.dev',
  scopes: ['openid', 'email', 'profile',
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/tasks.readonly',
    'https://www.googleapis.com/auth/photospicker.mediaitems.readonly'],
};
const acct = {
  get session(){ try{ return localStorage.getItem('peggy.session')||''; }catch(_){ return ''; } },
  get me(){ try{ return JSON.parse(localStorage.getItem('peggy.me')||'null'); }catch(_){ return null; } },
  get relay(){ try{ return ((localStorage.getItem('peggy.relay')||'').trim()||PEGGY.relay).replace(/\/+$/,''); }catch(_){ return PEGGY.relay; } },
  get clientId(){ try{ return (localStorage.getItem('peggy.clientId')||'').trim()||PEGGY.clientId; }catch(_){ return PEGGY.clientId; } },
  set(session, me){ localStorage.setItem('peggy.session', session); localStorage.setItem('peggy.me', JSON.stringify(me)); },
  clear(){ ['peggy.session','peggy.me','peggy.gtoken'].forEach(k=>localStorage.removeItem(k)); },
};
const peggyRedirect = () => location.origin + location.pathname.replace(/[^/]*$/,'');   // the Peggy folder, e.g. …/Peggy/

// Send the person to Google; they come back to Peggy's main page, which finishes and returns them to `returnTo`.
function peggySignIn(returnTo){
  const state = Math.random().toString(36).slice(2)+Date.now().toString(36);
  localStorage.setItem('peggy.authState', state);
  let framed=false; try{ framed = window.top!==window && window.top.location.origin===location.origin; }catch(_){}
  localStorage.setItem('peggy.authReturn', framed ? 'tv.html' : (returnTo || location.pathname.split('/').pop() + location.hash));
  (framed ? window.top : window).location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: acct.clientId, redirect_uri: peggyRedirect(), response_type: 'code', scope: PEGGY.scopes.join(' '),
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state });
}
// Called on page load. Returns the page to go back to after a successful sign-in, or null.
async function peggyFinishSignIn(){
  const q = new URLSearchParams(location.search);
  if (!q.get('code') && !q.get('error')) return null;
  const clean = () => history.replaceState(null, '', location.pathname + location.hash);
  if (q.get('error')){ clean(); throw new Error('Google sign-in was cancelled'); }
  if (q.get('state') !== localStorage.getItem('peggy.authState')){ clean(); throw new Error('Sign-in check failed, please try again'); }
  const r = await fetch(acct.relay + '/api/auth/exchange', { method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ code: q.get('code'), redirect_uri: peggyRedirect() }) });
  const raw = await r.text(); let d={}; try{ d=JSON.parse(raw); }catch(_){}
  clean();
  if (!r.ok) throw new Error(d.error || `Sign-in failed. The relay answered ${r.status}: ${raw.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0,120) || '(no message)'}`);
  if (!d.session) throw new Error('Sign-in failed. The relay is still running its old code: paste the new worker.js into Cloudflare and click Deploy.');
  acct.set(d.session, d.me);
  localStorage.setItem('peggy.gtoken', JSON.stringify({ v: d.access_token, exp: Date.now() + d.expires_in*1000 }));
  const back = localStorage.getItem('peggy.authReturn') || ''; localStorage.removeItem('peggy.authReturn');
  return back || 'index.html';
}
// Calls Peggy's relay with this person's session.
async function peggyApi(path, opts={}){
  if (!acct.session){ const e=new Error('Not signed in'); e.status=401; throw e; }
  const r = await fetch(acct.relay + '/api/' + path, { ...opts, headers: { 'X-Peggy-Session': acct.session, ...(opts.body?{'Content-Type':'application/json'}:{}), ...(opts.headers||{}) } });
  const d = await r.json().catch(()=>({}));
  if (!r.ok){ const e=new Error(d.error || ('Error '+r.status)); e.status=r.status; e.reauth=!!d.reauth; if (e.status===401) acct.clear(); throw e; }
  return d;
}
// A fresh Google access token for this person (calendar, tasks import, photos).
async function googleAccess(){
  try{ const t = JSON.parse(localStorage.getItem('peggy.gtoken')||'null'); if (t && t.exp > Date.now()+30000) return t.v; }catch(_){}
  const d = await peggyApi('auth/token');
  localStorage.setItem('peggy.gtoken', JSON.stringify({ v: d.access_token, exp: Date.now() + d.expires_in*1000 }));
  return d.access_token;
}
// Calls a Google API directly with this person's token.
async function gapi(url, opts={}){
  const t = await googleAccess();
  const r = await fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + t, ...(opts.body?{'Content-Type':'application/json'}:{}), ...(opts.headers||{}) } });
  if (r.status === 204) return {};
  const d = await r.json().catch(()=>({}));
  if (r.status === 401){ localStorage.removeItem('peggy.gtoken'); }
  if (!r.ok){ const e = new Error((d.error && d.error.message) || ('Google error ' + r.status)); e.status = r.status; throw e; }
  return d;
}
