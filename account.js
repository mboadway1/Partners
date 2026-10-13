// Partners account: one Google sign-in per person, kept by the relay so nobody signs in again.
// Used by index.html (photos) and plan.html (tasks, calendar, links).
'use strict';
const PARTNERS = {
  clientId: '68594475798-uselqr3ae7tkirld3vv0sam5hgbjameu.apps.googleusercontent.com',
  relay: (/(^|\.)ezrad\.com$/.test(location.hostname)?'https://api.ezrad.com/partners':/\.pages\.dev$/.test(location.hostname)?'https://ezrad-com.mboadway1.workers.dev/partners':'https://ezrad-partners-relay.mboadway1.workers.dev'),
  scopes: ['openid', 'email', 'profile',
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/tasks',
    'https://www.googleapis.com/auth/photospicker.mediaitems.readonly'],
};
const acct = {
  get session(){ try{ return localStorage.getItem('partners.session')||''; }catch(_){ return ''; } },
  get me(){ try{ return JSON.parse(localStorage.getItem('partners.me')||'null'); }catch(_){ return null; } },
  get relay(){ try{ return ((localStorage.getItem('partners.relay')||'').trim()||PARTNERS.relay).replace(/\/+$/,''); }catch(_){ return PARTNERS.relay; } },
  get clientId(){ try{ return (localStorage.getItem('partners.clientId')||'').trim()||PARTNERS.clientId; }catch(_){ return PARTNERS.clientId; } },
  set(session, me){ localStorage.setItem('partners.session', session); localStorage.setItem('partners.me', JSON.stringify(me)); },
  clear(){ ['partners.session','partners.me','partners.gtoken'].forEach(k=>localStorage.removeItem(k)); },
};
const partnersRedirect = () => location.origin + location.pathname.replace(/[^/]*$/,'');   // the Partners folder, e.g. …/Partners/

// On ezRAD.com, sign-in uses ezRAD.com's Google project (one for every app): ask the server which one.
const PARTNERS_ON_EZRAD = /(^|\.)ezrad\.com$|\.pages\.dev$/.test(location.hostname);   // ezrad.com, or Cloudflare's free address before go-live
async function partnersGoogleClient(){
  if (!PARTNERS_ON_EZRAD) return acct.clientId;
  try{ const c=localStorage.getItem('partners.clientId'); if (c) return c;
    const d = await (await fetch(acct.relay + '/api/config')).json(); if (d.googleClientId){ localStorage.setItem('partners.clientId', d.googleClientId); return d.googleClientId; } }catch(_){}
  return acct.clientId;
}
if (PARTNERS_ON_EZRAD) partnersGoogleClient();
// Send the person to Google; they come back to Partners' main page, which finishes and returns them to `returnTo`.
async function partnersSignIn(returnTo){
  const clientId = await partnersGoogleClient();
  const state = Math.random().toString(36).slice(2)+Date.now().toString(36);
  localStorage.setItem('partners.authState', state);
  let framed=false; try{ framed = window.top!==window && window.top.location.origin===location.origin; }catch(_){}
  localStorage.setItem('partners.authReturn', framed ? 'tv.html' : (returnTo || location.pathname.split('/').pop() + location.hash));
  (framed ? window.top : window).location.href = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: clientId, redirect_uri: partnersRedirect(), response_type: 'code', scope: PARTNERS.scopes.join(' '),
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state });
}
// Called on page load. Returns the page to go back to after a successful sign-in, or null.
async function partnersFinishSignIn(){
  const q = new URLSearchParams(location.search);
  if (!q.get('code') && !q.get('error')) return null;
  const clean = () => history.replaceState(null, '', location.pathname + location.hash);
  if (q.get('error')){ clean(); const wasMail=localStorage.getItem('partners.mailAuth'); localStorage.removeItem('partners.mailAuth'); throw new Error(wasMail?'Adding the email account was cancelled'+(q.get('error_description')?': '+q.get('error_description').slice(0,160):''):'Google sign-in was cancelled'); }
  if (q.get('state') !== localStorage.getItem('partners.authState')){ clean(); throw new Error('Sign-in check failed, please try again'); }
  // Adding an email account to Mail (Gmail or Outlook): hand the code to the relay, which keeps that account's access.
  const mailKind = localStorage.getItem('partners.mailAuth');
  if (mailKind){ localStorage.removeItem('partners.mailAuth');
    const r = await fetch(acct.relay + '/api/mail/connect/' + (mailKind==='microsoft'?'microsoft':'google'), { method:'POST', headers:{'Content-Type':'application/json','X-Partners-Session':acct.session},
      body: JSON.stringify({ code: q.get('code'), redirect_uri: partnersRedirect() }) });
    const d = await r.json().catch(()=>({})); clean();
    const back = localStorage.getItem('partners.authReturn') || 'plan.html#mail'; localStorage.removeItem('partners.authReturn');
    if (!r.ok) throw new Error(d.error || ('Couldn’t add that email account (' + r.status + ')'));
    try{ localStorage.setItem('partners.mailAdded', d.account ? d.account.address : '1'); }catch(_){}
    return back; }
  // Signed in with email already? Then this connects Google to that account. A saved invite joins the partner's couple.
  let invite=''; try{ invite=localStorage.getItem('partners.invite')||''; }catch(_){}
  const r = await fetch(acct.relay + '/api/auth/exchange', { method:'POST', headers:{'Content-Type':'application/json', ...(acct.session?{'X-Partners-Session':acct.session}:{})},
    body: JSON.stringify({ code: q.get('code'), redirect_uri: partnersRedirect(), invite }) });
  const raw = await r.text(); let d={}; try{ d=JSON.parse(raw); }catch(_){}
  clean();
  if (!r.ok) throw new Error(d.error || `Sign-in failed. The relay answered ${r.status}: ${raw.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim().slice(0,120) || '(no message)'}`);
  if (!d.session) throw new Error('Sign-in failed. The relay is still running its old code: paste the new worker.js into Cloudflare and click Deploy.');
  acct.set(d.session, d.me); try{ localStorage.removeItem('partners.invite'); }catch(_){}
  localStorage.setItem('partners.gtoken', JSON.stringify({ v: d.access_token, exp: Date.now() + d.expires_in*1000, scope: d.scope||'' }));
  const back = localStorage.getItem('partners.authReturn') || ''; localStorage.removeItem('partners.authReturn');
  return back || 'index.html';
}
// Calls Partners' relay with this person's session.
async function partnersApi(path, opts={}){
  if (!acct.session){ const e=new Error('Not signed in'); e.status=401; throw e; }
  const r = await fetch(acct.relay + '/api/' + path, { ...opts, headers: { 'X-Partners-Session': acct.session, ...(opts.body?{'Content-Type':'application/json'}:{}), ...(opts.headers||{}) } });
  const d = await r.json().catch(()=>({}));
  if (!r.ok){ const e=new Error(d.error || ('Error '+r.status)); e.status=r.status; e.reauth=!!d.reauth; if (e.status===401) acct.clear();
    // Free trial over and no plan yet: show the plans.
    // A feature this couple doesn't have (Partners on ezRAD.com): offer it. Trial over with nothing at all: show the plans.
    if (e.status===402 && d.feature){ e.feature=d.feature; }   // a feature this couple doesn't have: the page offers it
    else if (e.status===402 && !/account\.html$/.test(location.pathname) && window.top===window) location.href='account.html?ended=1';
    throw e; }
  return d;
}
// Accounts with email and password (Google sign-in is partnersSignIn above).
async function partnersAuthCall(path, body){
  const r = await fetch(acct.relay + '/api/' + path, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  const d = await r.json().catch(()=>({}));
  if (!r.ok || !d.session) throw new Error(d.error || ('Something went wrong ('+r.status+'). Please try again.'));
  acct.set(d.session, d.me); return d;
}
const partnersSignup = b => partnersAuthCall('auth/signup', b);
const partnersLogin = b => partnersAuthCall('auth/login', b);
// A fresh Google access token for this person (calendar, tasks import, photos).
async function googleAccess(){
  try{ const t = JSON.parse(localStorage.getItem('partners.gtoken')||'null'); if (t && t.exp > Date.now()+30000) return t.v; }catch(_){}
  const d = await partnersApi('auth/token');
  localStorage.setItem('partners.gtoken', JSON.stringify({ v: d.access_token, exp: Date.now() + d.expires_in*1000, scope: d.scope||'' }));
  return d.access_token;
}
// Calls a Google API directly with this person's token.
async function gapi(url, opts={}){
  const t = await googleAccess();
  const r = await fetch(url, { ...opts, headers: { Authorization: 'Bearer ' + t, ...(opts.body?{'Content-Type':'application/json'}:{}), ...(opts.headers||{}) } });
  if (r.status === 204) return {};
  const d = await r.json().catch(()=>({}));
  if (r.status === 401){ localStorage.removeItem('partners.gtoken'); }
  if (!r.ok){ const e = new Error((d.error && d.error.message) || ('Google error ' + r.status)); e.status = r.status; throw e; }
  return d;
}
