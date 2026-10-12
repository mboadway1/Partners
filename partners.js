// Partners: each partner's name, color and theme, and the couples photo on the home screens.
// Used by the phone pages (signed in) and the TV (with the view-only pass the phone gives it).
'use strict';
const PARTNER_COLORS = ['#D1386E','#7B4FD6','#17709F','#1B7F51','#C24A17','#B5306F','#0E8F7B','#B8860B'];

function partnersAuth(){
  try{ if (typeof acct!=='undefined' && acct.session) return { relay:acct.relay, session:acct.session, full:true }; }catch(_){}
  try{ const p=JSON.parse(localStorage.getItem('peggy.tvplan')||'null'); if (p && p.session) return { relay:p.relay, session:p.session, full:false }; }catch(_){}
  return null;
}
async function partnersFetch(path, opts={}){
  const a=partnersAuth(); if (!a){ const e=new Error('Not signed in'); e.status=401; throw e; }
  const r=await fetch(a.relay+'/api/'+path, { ...opts, headers:{ 'X-Peggy-Session':a.session, ...(opts.headers||{}) } });
  if (!r.ok){ let m=''; try{ m=(await r.json()).error||''; }catch(_){} const e=new Error(m||('Error '+r.status)); e.status=r.status; throw e; }
  return r;
}
function partnersCached(){ try{ return JSON.parse(localStorage.getItem('peggy.partners')||'null'); }catch(_){ return null; } }
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
  try{ localStorage.setItem('peggy.partners', JSON.stringify(d)); }catch(_){}
  // My own theme follows me to every device I sign in on.
  const mine = (d.members||[]).find(m=>m.email===partnersMyEmail());
  if (mine && mine.theme && typeof setPeggyTheme==='function' && typeof peggyThemeName==='function' && mine.theme!==peggyThemeName()){ partnersSyncing=true; setPeggyTheme(mine.theme); partnersSyncing=false; }
  document.dispatchEvent(new CustomEvent('partners', { detail:d }));
  return d;
}
let partnersSyncing=false;
async function partnersSaveProfile(fields){
  const r = await partnersFetch('profile', { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(fields) });
  await r.json(); return partnersLoad();
}
// Picking a theme on a phone saves it as that partner's theme.
document.addEventListener('peggytheme', e=>{ const a=partnersAuth(); if (a && a.full && !partnersSyncing) partnersSaveProfile({ theme:e.detail }).catch(()=>{}); });

/* ---- couples photo: kept on this device too, so it shows instantly and offline ---- */
function couplePhotoCached(){ try{ return JSON.parse(localStorage.getItem('peggy.couple')||'null'); }catch(_){ return null; } }
async function couplePhotoURL(){
  const d = partnersCached(), at = (d && d.couplePhoto) || 0, c = couplePhotoCached();
  if (!at) return c ? c.url : '';
  if (c && c.at===at) return c.url;
  try{
    const b = await (await partnersFetch('couple-photo')).blob();
    const url = await new Promise(res=>{ const f=new FileReader(); f.onload=()=>res(String(f.result)); f.readAsDataURL(b); });
    try{ localStorage.setItem('peggy.couple', JSON.stringify({ at, url })); }catch(_){}
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
  localStorage.removeItem('peggy.couple');
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
(function(){ if (document.documentElement.dataset.peggy==='tv') return;
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
