// Partners: each partner's name, color and theme, and the couples photo on the home screens.
// Used by the phone pages (signed in) and the TV (with the view-only pass the phone gives it).
'use strict';
const PARTNER_COLORS = ['#D1386E','#7B4FD6','#17709F','#1B7F51','#C24A17','#B5306F','#0E8F7B','#B8860B'];

function partnersAuth(){
  try{ if (typeof acct!=='undefined' && acct.session) return { relay:acct.relay, session:acct.session, full:true }; }catch(_){}
  try{ const p=JSON.parse(localStorage.getItem('partners.tvplan')||'null'); if (p && p.session) return { relay:p.relay, session:p.session, full:false }; }catch(_){}
  return null;
}
async function partnersFetch(path, opts={}){
  const a=partnersAuth(); if (!a){ const e=new Error('Not signed in'); e.status=401; throw e; }
  const r=await fetch(a.relay+'/api/'+path, { ...opts, headers:{ 'X-Partners-Session':a.session, ...(opts.headers||{}) } });
  if (!r.ok){ let m=''; try{ m=(await r.json()).error||''; }catch(_){} const e=new Error(m||('Error '+r.status)); e.status=r.status; throw e; }
  return r;
}
function partnersCached(){ try{ return JSON.parse(localStorage.getItem('partners.partners')||'null'); }catch(_){ return null; } }
function partnersMyEmail(){ try{ return (typeof acct!=='undefined' && acct.me && acct.me.email) || ''; }catch(_){ return ''; } }

// Both partners, me first when I'm signed in, each with a color.
function partnersList(d){
  d = d || partnersCached(); const ms = (d && d.members) || [], mine = partnersMyEmail();
  const sorted = ms.slice().sort((a,b)=> (b.email===mine) - (a.email===mine));
  return sorted.map((m,i)=>({ ...m, color: m.color || PARTNER_COLORS[i===0?0:1] }));
}
function partnerColorOf(email){ const m=partnersList().find(x=>x.email===email); return m ? m.color : ''; }
function coupleNames(d){ const l=partnersList(d).map(m=>m.name).filter(Boolean); return l.length ? l.join(' & ') : 'Partners'; }

async function partnersLoad(){
  const d = await (await partnersFetch('members')).json();
  try{ localStorage.setItem('partners.partners', JSON.stringify(d)); }catch(_){}
  // My own theme follows me to every device I sign in on.
  const mine = (d.members||[]).find(m=>m.email===partnersMyEmail());
  if (mine && mine.theme && typeof setPartnersTheme==='function' && typeof partnersThemeName==='function' && mine.theme!==partnersThemeName()){ partnersSyncing=true; setPartnersTheme(mine.theme); partnersSyncing=false; }
  document.dispatchEvent(new CustomEvent('partners', { detail:d }));
  partnersEnsureCalendars();
  return d;
}
// The TV shows each partner's chosen calendars. If the relay doesn't have my choices yet (e.g. a new relay),
// send them now from Google, so today's events appear on the TV without opening the Calendar tab first.
async function partnersEnsureCalendars(){
  const a=partnersAuth(); if (!a || !a.full || typeof gapi!=='function') return;
  try{ if (Date.now()-(+localStorage.getItem('partners.calPrefsAt')||0) < 6*3600e3) return; }catch(_){}
  try{
    const prefs = await (await partnersFetch('prefs')).json();
    if (!(prefs.calendars||[]).length){
      const d = await gapi('https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250');
      prefs.calendars = (d.items||[]).filter(c=>!c.hidden).map(c=>({ id:c.id, name:c.summaryOverride||c.summary, color:c.backgroundColor||'#D1386E', show: !!c.primary || !!c.selected }));
      if (prefs.calendars.length) await partnersFetch('prefs', { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(prefs) });
    }
    localStorage.setItem('partners.calPrefsAt', String(Date.now()));
  }catch(_){}
}
let partnersSyncing=false;
async function partnersSaveProfile(fields){
  const r = await partnersFetch('profile', { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(fields) });
  await r.json(); return partnersLoad();
}
// Picking a theme on a phone saves it as that partner's theme.
document.addEventListener('partnerstheme', e=>{ const a=partnersAuth(); if (a && a.full && !partnersSyncing) partnersSaveProfile({ theme:e.detail }).catch(()=>{}); });

/* ---- couples photo: kept on this device too, so it shows instantly and offline ---- */
function couplePhotoCached(){ try{ return JSON.parse(localStorage.getItem('partners.couple')||'null'); }catch(_){ return null; } }
async function couplePhotoURL(){
  const d = partnersCached(), at = (d && d.couplePhoto) || 0, c = couplePhotoCached();
  if (!at) return c ? c.url : '';
  if (c && c.at===at) return c.url;
  try{
    const b = await (await partnersFetch('couple-photo')).blob();
    const url = await new Promise(res=>{ const f=new FileReader(); f.onload=()=>res(String(f.result)); f.readAsDataURL(b); });
    try{ localStorage.setItem('partners.couple', JSON.stringify({ at, url })); }catch(_){}
    return url;
  }catch(_){ return c ? c.url : ''; }
}
async function couplePhotoUpload(file){
  const img = await new Promise((res,rej)=>{ const i=new Image(); i.onload=()=>res(i); i.onerror=()=>rej(new Error('That photo couldn’t be opened')); i.src=URL.createObjectURL(file); });
  const s = Math.min(1, 1920/Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement('canvas'); c.width=Math.round(img.naturalWidth*s); c.height=Math.round(img.naturalHeight*s);
  c.getContext('2d').drawImage(img,0,0,c.width,c.height);
  const blob = await new Promise(r=>c.toBlob(r,'image/jpeg',.85));
  await partnersFetch('couple-photo', { method:'PUT', headers:{'Content-Type':'image/jpeg'}, body:blob });
  localStorage.removeItem('partners.couple');
  await partnersLoad();
  return couplePhotoURL();
}

/* ---- phone pieces ---- */
// The couples photo with both names, for the top of the phone home screen.
function partnersHero(){
  const h=document.createElement('div'); h.className='couplehero';
  const draw=async()=>{
    const url=await couplePhotoURL(), names=coupleNames();
    h.replaceChildren(); h.classList.toggle('nophoto', !url);
    if (url){ const i=document.createElement('img'); i.src=url; i.alt=names; h.append(i); }
    const n=document.createElement('div'); n.className='names';
    partnersList().forEach((m,i)=>{ if(i) n.append(document.createTextNode(' & ')); const s=document.createElement('span'); s.textContent=m.name; s.style.color=m.color; n.append(s); });
    if (!n.childNodes.length) n.textContent='Partners';
    h.append(n);
    if (!url){ const p=document.createElement('small'); p.textContent='Add your couples photo in Settings → Partners'; h.append(p); }
  };
  draw(); document.addEventListener('partners', draw);
  return h;
}
// Settings → Partners: your name, your color, your theme, and the couples photo.
function partnersSettings(onDone){
  const box=document.createElement('div'); box.className='partnerset';
  const a=partnersAuth();
  if (!a || !a.full){ box.textContent='Sign in to set your name, color and the couples photo.'; return box; }
  const me=partnersList().find(m=>m.email===partnersMyEmail()) || {};
  const other=partnersList().find(m=>m.email!==partnersMyEmail());
  const lab=t=>{ const l=document.createElement('label'); l.className='f'; l.textContent=t; return l; };
  const name=document.createElement('input'); name.value=me.name||''; name.placeholder='Your name'; name.maxLength=40;
  const sw=document.createElement('div'); sw.className='pcolors'; let color=me.color||PARTNER_COLORS[0];
  const drawSw=()=>sw.replaceChildren(...PARTNER_COLORS.map(c=>{ const b=document.createElement('button'); b.type='button'; b.className='pc'+(c===color?' on':''); b.style.background=c; b.title='Use this color'; b.onclick=()=>{ color=c; drawSw(); }; return b; }));
  drawSw();
  const save=document.createElement('button'); save.className='primary'; save.textContent='Save my name and color';
  save.onclick=async()=>{ save.disabled=true; try{ await partnersSaveProfile({ name:name.value.trim(), color }); if(typeof toast==='function') toast('Saved ✓ Both of you and the TV see it'); onDone&&onDone(); }catch(e){ if(typeof toast==='function') toast(e.status===404?'The relay needs the newest code (Partners checklist).':e.message,6000); } finally{ save.disabled=false; } };
  const ph=document.createElement('input'); ph.type='file'; ph.accept='image/*'; ph.style.display='none';
  const pick=document.createElement('button'); pick.textContent='📷 Choose couples photo';
  pick.onclick=()=>ph.click();
  ph.onchange=async()=>{ const f=ph.files[0]; if(!f) return; pick.disabled=true; pick.textContent='Uploading…';
    try{ await couplePhotoUpload(f); if(typeof toast==='function') toast('Couples photo saved ✓ It shows on both phones and the TV'); }
    catch(e){ if(typeof toast==='function') toast(e.status===404?'The relay needs the newest code (Partners checklist).':e.message,6000); }
    finally{ pick.disabled=false; pick.textContent='📷 Choose couples photo'; } };
  box.append(lab('Your name'), name, lab('Your color'), sw, save, lab('Couples photo (home screens and TV)'), pick, ph);
  if (other){ const p=document.createElement('p'); p.className='hint'; p.textContent=`${other.name} sets their own name, color and theme on their phone.`; box.append(p); }
  return box;
}

/* ---- shared styles for the phone pages ---- */
(function(){ if (document.documentElement.dataset.partners==='tv') return;
  const st=document.createElement('style'); st.textContent=`
.couplehero{position:relative;border-radius:18px;overflow:hidden;margin:4px 0 12px;background:var(--panel2);min-height:84px;display:flex;flex-direction:column;justify-content:flex-end}
.couplehero img{display:block;width:100%;max-height:46vh;object-fit:cover}
.couplehero .names{position:absolute;left:0;right:0;bottom:0;padding:28px 14px 10px;font:600 24px/1.15 var(--display,inherit);color:#fff;background:linear-gradient(transparent,rgba(0,0,0,.6))}
.couplehero .names span{filter:brightness(1.6) saturate(.9);text-shadow:0 1px 6px rgba(0,0,0,.5)}
.couplehero.nophoto .names{position:static;background:none;padding:14px 14px 2px}
.couplehero.nophoto .names span{filter:none;text-shadow:none}
.couplehero small{display:block;padding:0 14px 12px;color:var(--dim)}
.partnerset input{width:100%}
.pcolors{display:flex;gap:10px;flex-wrap:wrap;margin:6px 0 10px}
.pcolors .pc{width:36px;height:36px;border-radius:50%;border:3px solid transparent;padding:0}
.pcolors .pc.on{border-color:var(--text);box-shadow:0 0 0 2px var(--bg) inset}
.partnerset button{width:100%;margin-top:6px}`;
  document.head.append(st); })();

/* ---- settings kept in sync between the Fire Stick, the Chromebook and the iPhones ----
   Every change to one of these is stamped and sent to the relay; each device pulls the newest
   on open, every few minutes and when it comes back to the screen. Newest change wins.
   Not synced on purpose: Screen fit (each TV is different), sign-ins, caches. */
const SYNC_KEYS = ['partners.tv.interval','partners.tv.shuffle','partners.tv.zoom','partners.tv.driveStart','partners.tv.driveFolder','partners.tv.driveKey',
  'partners.driveFolder','partners.driveKey','partners.skipShots','partners.skipBursts','partners.albumSort','partners.calTasks','partners.homeAirport',
  'partners.aiTone','partners.audience','partners.tv.kinds'];
const isSynced = k => SYNC_KEYS.includes(k) || k.startsWith('partners.fuel.') && k!=='partners.fuel.last';
// The phone keeps the Drive folder under one name and the TV under another: keep both the same.
const SYNC_TWINS = { 'partners.driveFolder':'partners.tv.driveFolder', 'partners.tv.driveFolder':'partners.driveFolder', 'partners.driveKey':'partners.tv.driveKey', 'partners.tv.driveKey':'partners.driveKey' };
let syncOut = {}, syncT = 0, syncApplying = false;
function syncStamps(){ try{ return JSON.parse(localStorage.getItem('partners.syncAt')||'{}'); }catch(_){ return {}; } }
(function(){
  const S = Storage.prototype, set0 = S.setItem, rem0 = S.removeItem;
  const note = (store, k, v) => {
    if (syncApplying || store !== window.localStorage || !isSynced(k)) return;
    const at = Date.now(), st = syncStamps(); st[k] = at; set0.call(localStorage, 'partners.syncAt', JSON.stringify(st));
    syncOut[k] = { v, at }; clearTimeout(syncT); syncT = setTimeout(syncPush, 1500);
  };
  S.setItem = function(k, v){ set0.call(this, k, v); note(this, k, String(v)); };
  S.removeItem = function(k){ rem0.call(this, k); note(this, k, null); };
})();
async function syncPush(){
  const changes = syncOut; syncOut = {}; if (!Object.keys(changes).length) return;
  try{ await partnersFetch('settings', { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ changes }) }); }
  catch(_){ syncOut = { ...changes, ...syncOut }; }   // try again with the next change or pull
}
async function syncPull(){
  let remote; try{ remote = await (await partnersFetch('settings')).json(); }catch(_){ return; }
  const st = syncStamps(), changed = [];
  syncApplying = true;
  try{
    for (const [k, x] of Object.entries(remote || {})){
      if (!isSynced(k) || !x || (st[k] || 0) >= x.at) continue;
      const keys = [k, SYNC_TWINS[k]].filter(Boolean);
      for (const kk of keys){ if (x.v == null) localStorage.removeItem(kk); else localStorage.setItem(kk, x.v); st[kk] = x.at; }
      changed.push(k);
    }
    localStorage.setItem('partners.syncAt', JSON.stringify(st));
  } finally { syncApplying = false; }
  // Send up anything this device changed that the relay hasn't heard about (for example, set before syncing existed).
  const up = {}; for (const [k, at] of Object.entries(st)) if (!remote[k] || remote[k].at < at){ const v = localStorage.getItem(k); up[k] = { v, at }; }
  if (Object.keys(up).length){ Object.assign(syncOut, up); syncPush(); }
  if (changed.length) document.dispatchEvent(new CustomEvent('partnerssettings', { detail: changed }));
}
// First time on this device: offer the settings it already has, marked as old so newer ones elsewhere win.
(function(){ try{ if (localStorage.getItem('partners.syncAt')) return; const st={};
  for (let i=0;i<localStorage.length;i++){ const k=localStorage.key(i); if (isSynced(k)) st[k]=1; }
  localStorage.setItem('partners.syncAt', JSON.stringify(st)); }catch(_){} })();
// Start syncing once this device can reach the relay.
setTimeout(()=>{ if (partnersAuth()) syncPull(); }, 800);
setInterval(()=>{ if (!document.hidden && partnersAuth()) syncPull(); }, 3*60*1000);
document.addEventListener('visibilitychange', ()=>{ if (!document.hidden && partnersAuth()) syncPull(); });

