// Partners color themes. Pink is the default. Loaded in <head> so the colors are right before anything draws.
// Each page says what it is with <html data-partners="phone|words|tv">.
'use strict';
// One-time move of this device's saved data from the app's old name (peggy.*) to partners.*,
// so nothing is lost by the rename. Runs before anything else reads saved data.
(function(){ try{
  if (localStorage.getItem('partners.moved')) return;
  const OLD='peg'+'gy.', ks=[];
  for (let i=0;i<localStorage.length;i++){ const k=localStorage.key(i); if (k && k.indexOf(OLD)===0) ks.push(k); }
  for (const k of ks){ const n='partners.'+k.slice(OLD.length); if (localStorage.getItem(n)==null) localStorage.setItem(n, localStorage.getItem(k)); localStorage.removeItem(k); }
  // the settings-sync stamps name keys inside them too
  const st=localStorage.getItem('partners.syncAt');
  if (st){ const o=JSON.parse(st), out={}; for (const [k,v] of Object.entries(o)) out[k.indexOf(OLD)===0 ? 'partners.'+k.slice(OLD.length) : k]=v; localStorage.setItem('partners.syncAt', JSON.stringify(out)); }
  localStorage.setItem('partners.moved','1');
}catch(_){} })();
const PARTNERS_THEMES = {
  pink:     { name:'Pink',     bg:'#FFE9F1', panel:'#FFF8FB', panel2:'#FBDCE8', line:'#F4C6D8', text:'#4A1D3F', dim:'#9B6B8E', accent:'#D1386E', accentDark:'#A82556', second:'#8B6CE0', bf1:'#F06A9B', bf2:'#9B7BEA', deep:'#2A1230' },
  lavender: { name:'Lavender', bg:'#F1ECFF', panel:'#FBF9FF', panel2:'#E4DAFB', line:'#D3C5F5', text:'#33215C', dim:'#7A68A6', accent:'#7B4FD6', accentDark:'#5A35AE', second:'#D1386E', bf1:'#A98BF0', bf2:'#F06A9B', deep:'#1E1438' },
  ocean:    { name:'Ocean',    bg:'#E6F4FA', panel:'#F7FCFE', panel2:'#CFE9F3', line:'#B5DCEA', text:'#10324A', dim:'#557A92', accent:'#17709F', accentDark:'#0F5376', second:'#0E8F7B', bf1:'#4FB3E8', bf2:'#3DD6B5', deep:'#0C2233' },
  mint:     { name:'Mint',     bg:'#E8F7EF', panel:'#F7FDF9', panel2:'#D2EEDD', line:'#B8E2C9', text:'#173A2A', dim:'#5B806C', accent:'#1B7F51', accentDark:'#13603C', second:'#C9573B', bf1:'#5ED39A', bf2:'#F2C14E', deep:'#102419' },
  sunset:   { name:'Sunset',   bg:'#FFF0E3', panel:'#FFFAF5', panel2:'#FFDFC4', line:'#F7CBA6', text:'#4A2614', dim:'#9A6A4E', accent:'#C24A17', accentDark:'#933510', second:'#B5306F', bf1:'#FF9A4D', bf2:'#E8559A', deep:'#2A140A' },
  midnight: { name:'Midnight', dark:true, bg:'#1C1426', panel:'#261C33', panel2:'#34274A', line:'#43345C', text:'#F5EAFB', dim:'#B9A6CC', accent:'#E0508A', accentDark:'#A83361', second:'#A98BF0', bf1:'#F06A9B', bf2:'#A98BF0', deep:'#120C18' },
};
const PARTNERS_THEME_ORDER = ['pink','lavender','ocean','mint','sunset','midnight'];

function partnersThemeName(){ try{ const t=localStorage.getItem('partners.theme'); return PARTNERS_THEMES[t]?t:'pink'; }catch(_){ return 'pink'; } }
function partnersTheme(){ return PARTNERS_THEMES[partnersThemeName()]; }

// Blend two hex colors; w = share of b.
function partnersMix(a,b,w){ const p=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)); const x=p(a), y=p(b);
  return '#'+x.map((v,i)=>Math.round(v*(1-w)+y[i]*w).toString(16).padStart(2,'0')).join(''); }
function partnersRgba(h,a){ return `rgba(${[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)).join(',')},${a})`; }

function applyPartnersTheme(name){
  const t = PARTNERS_THEMES[name] || PARTNERS_THEMES.pink, kind = document.documentElement.dataset.partners || 'phone';
  const st = document.documentElement.style, set=(k,v)=>st.setProperty(k,v);
  window.PARTNERS_BF = [t.bf1, t.bf2];
  if (kind === 'tv'){
    // The TV is always a dark room: the theme's deep color with its bright accents.
    const bg=t.deep;
    set('--bg',bg); set('--panel',partnersMix(bg,'#ffffff',.08)); set('--panel2',partnersMix(bg,'#ffffff',.15)); set('--line',partnersMix(bg,'#ffffff',.22));
    set('--text',partnersMix(t.bf1,'#ffffff',.88)); set('--dim',partnersMix(t.bf1,'#ffffff',.55)); set('--accent',t.bf1); set('--lilac',t.bf2);
    set('--photo',partnersMix(bg,'#000000',.35)); set('--scrim',partnersRgba(partnersMix(bg,'#000000',.4),.78));
  } else {
    set('--bg',t.bg); set('--panel',t.panel); set('--panel2',t.panel2); set('--line',t.line); set('--text',t.text); set('--dim',t.dim);
    set('--accent',t.accent); set('--accent2',t.accent); set('--accentDark',t.accentDark); set('--lilac',t.second); set('--photo',t.deep);
    set('--headerbg',partnersRgba(t.bg,.9)); set('--inputbg',t.dark?partnersMix(t.panel,'#000000',.2):'#ffffff');
    set('--wash1',partnersRgba(t.bg,.72)); set('--wash2',partnersRgba(t.bg,.5)); set('--card',partnersRgba(t.panel,.86));
    set('--onaccent','#ffffff');
    if (kind === 'words'){
      set('--surface',t.panel); set('--fg',t.text); set('--muted',t.dim); set('--s1',t.accent); set('--s2',t.second);
    }
    const m=document.querySelector('meta[name=theme-color]'); if(m) m.setAttribute('content',t.bg);
    st.colorScheme = t.dark ? 'dark' : 'light';
  }
  document.documentElement.dataset.theme = name;
}
function setPartnersTheme(name){
  if (!PARTNERS_THEMES[name]) return;
  try{ localStorage.setItem('partners.theme', name); }catch(_){}
  applyPartnersTheme(name);
  document.dispatchEvent(new CustomEvent('partnerstheme',{detail:name}));
}
// A row of color swatches; tapping one switches the theme everywhere.
function partnersThemePicker(){
  const wrap=document.createElement('div'); wrap.className='themepick'; wrap.setAttribute('role','radiogroup'); wrap.setAttribute('aria-label','Theme color');
  const draw=()=>{ wrap.replaceChildren(...PARTNERS_THEME_ORDER.map(k=>{ const t=PARTNERS_THEMES[k], b=document.createElement('button');
    b.type='button'; b.className='swatch'+(k===partnersThemeName()?' on':''); b.title=`${t.name} theme`; b.setAttribute('role','radio'); b.setAttribute('aria-checked',k===partnersThemeName());
    b.style.background=`linear-gradient(135deg, ${t.bf1}, ${t.bf2})`; b.style.setProperty('--ring', t.accent);
    const l=document.createElement('span'); l.textContent=t.name; b.append(l);
    b.onclick=()=>{ setPartnersTheme(k); draw(); }; return b; })); };
  draw(); return wrap;
}
applyPartnersTheme(partnersThemeName());

/* ---------- bottom menu: the "More" button opens Links and Words ---------- */
(function(){
  const MORE=[['plan.html#mail','✉️','Mail','All your email in one inbox (only you see it)'],['plan.html#us','💞','Us','Share a concern, Taking Turns'],['plan.html#fuel','⛽','Fuel','Cheapest fuel nearby or on the way'],['plan.html#links','🔗','Links','Shared link favorites']];
  function setup(){
    const more=document.querySelector('.bnav a.more'); if(!more) return;
    const st=document.createElement('style');
    st.textContent='.bnav{gap:0}.bnav a{min-width:0}.moremenu{position:fixed;right:max(10px,env(safe-area-inset-right));bottom:calc(64px + env(safe-area-inset-bottom));z-index:40;background:var(--panel,#fff);border:1px solid var(--line,#eee);border-radius:16px;box-shadow:0 8px 30px rgba(40,16,40,.22);padding:6px;display:flex;flex-direction:column;min-width:190px}.moremenu a{display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:12px;color:var(--text,#333);text-decoration:none;font-weight:800}.moremenu a:hover,.moremenu a:focus-visible{background:var(--panel2,#fde)}.moremenu small{display:block;font-weight:600;color:var(--dim,#888);font-size:12px}.moremenu[hidden]{display:none}';
    document.head.append(st);
    const menu=document.createElement('div'); menu.className='moremenu'; menu.hidden=true;
    for(const [href,e,l,t] of MORE){ const a=document.createElement('a'); a.href=href; a.title=t; a.innerHTML=`<span style="font-size:20px">${e}</span><span>${l}<small>${t}</small></span>`; a.onclick=()=>{ menu.hidden=true; }; menu.append(a); }
    document.body.append(menu);
    more.addEventListener('click',e=>{ e.preventDefault(); menu.hidden=!menu.hidden; });
    document.addEventListener('click',e=>{ if(!menu.hidden && !menu.contains(e.target) && !more.contains(e.target)) menu.hidden=true; });
    const mark=()=>{ if(/(^|\/)(index\.html)?$/.test(location.pathname)) document.querySelectorAll('.bnav a[data-k="photos"]').forEach(a=>a.classList.add('on'));
      const inMore=/words\.html$/.test(location.pathname) || /plan\.html$/.test(location.pathname)&&['#links','#fuel','#us','#mail'].includes(location.hash); more.classList.toggle('on', inMore);
      if(/words\.html$/.test(location.pathname)) document.querySelectorAll('.bnav a[data-k="words"]').forEach(a=>a.classList.remove('on')); };
    mark(); addEventListener('hashchange', mark);
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', setup); else setup();
})();

// Big screens (Chromebook, laptop): lay pages out like the Fire TV: every section in the bottom bar
// (no More menu), pages use the full width, and the calendar month fills the screen.
(function(){
  const kind=document.documentElement.dataset.partners||'phone'; if (kind==='tv') return;
  const mq=window.matchMedia('(min-width: 900px)');
  const set=()=>document.documentElement.classList.toggle('wide', mq.matches);
  set(); try{ mq.addEventListener('change', set); }catch(_){ mq.addListener(set); }
  const st=document.createElement('style'); st.textContent=`
html.wide main{max-width:none!important;padding-left:28px;padding-right:28px}
html.wide .wrap{max-width:none!important}
html.wide .bnav a{max-width:none!important;font-size:13px}
html.wide .bnav .more{display:none!important}
html.wide .bnav .tvonly,html.wide .bnav .wideonly{display:flex!important}
html.wide:not(.tv) .bnav #navTv{display:none!important}
html.wide:not(.tv) .bnav .notv{display:flex!important}
html.wide:not(.tv) .bnav .notv.more{display:none!important}
.bnav .wideonly{display:none}
html.framed .bnav #navTv,html.wide.framed .bnav #navTv{display:flex!important}
html.framed .bnav .notv,html.wide.framed:not(.tv) .bnav .notv{display:none!important}`;
  document.head.append(st);
  const ICON={fuel:'<rect x="4" y="3" width="10" height="18" rx="2"/><path d="M4 10h10M14 7l4 3v8a2 2 0 0 1-4 0v-4"/>',
    us:'<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>',
    mail:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
    links:'<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'};
  const add=()=>{ const nav=document.querySelector('.bnav'), more=nav&&nav.querySelector('.more'); if(!nav||!more) return;
    for (const [k,l] of [['mail','Mail'],['fuel','Fuel'],['us','Us'],['links','Links']]){
      if (nav.querySelector(`[data-k="${k}"]`)) continue;
      const a=document.createElement('a'); a.href='plan.html#'+k; a.dataset.k=k; a.className='wideonly'; a.title=l;
      a.innerHTML=`<svg class="ic" viewBox="0 0 24 24">${ICON[k]}</svg>${l}`; nav.insertBefore(a, more); } };
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', add); else add();
})();

/* ---------- Pay per feature (when Partners runs on ezRAD.com): show only the features this couple can use ----------
   The relay answers /api/features with { perFeature, keys, list, trial }. On the old relay (404) nothing changes. */
(function(){
  const NAV={photos:'photos',tasks:'tasks',calendar:'calendar',money:'money',flights:'flights',fuel:'fuel',us:'us',links:'links',mail:'mail'};
  const auth=()=>{ try{ const s=localStorage.getItem('partners.session'); if(!s) return null;
      const relay=((localStorage.getItem('partners.relay')||'').trim()||(/(^|\.)ezrad\.com$/.test(location.hostname)?'https://api.ezrad.com/partners':/\.pages\.dev$/.test(location.hostname)?'https://ezrad-com.mboadway1.workers.dev/partners':'https://ezrad-partners-relay.mboadway1.workers.dev')).replace(/\/+$/,'');
      return {s,relay}; }catch(_){ return null; } };
  const call=async(path,body)=>{ const a=auth(); if(!a) throw new Error('Not signed in');
    const r=await fetch(a.relay+'/api/'+path,{method:body?'POST':'GET',headers:{'X-Partners-Session':a.s,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
    const d=await r.json().catch(()=>({})); if(!r.ok){ const e=new Error(d.error||('Error '+r.status)); e.status=r.status; throw e; } return d; };
  const cached=()=>{ try{ return JSON.parse(localStorage.getItem('partners.features')||'null'); }catch(_){ return null; } };
  window.partnersHas=k=>{ const f=cached(); return !f||!f.perFeature||(f.keys||[]).includes(k); };
  function apply(f){
    if(!f||!f.perFeature) return; const keys=new Set(f.keys||[]);
    document.querySelectorAll('.bnav a[data-k], .moremenu a').forEach(a=>{ const k=a.dataset.k||((a.getAttribute('href')||'').split('#')[1]||''); if(NAV[k]){ if(keys.has(NAV[k])) a.style.removeProperty('display'); else a.style.setProperty('display','none','important'); } });
    const extra=(f.list||[]).filter(x=>!keys.has(x.key)&&x.forSale);
    const nav=document.querySelector('.bnav'), more=nav&&nav.querySelector('.more'), menu=document.querySelector('.moremenu');
    let b=document.querySelector('.bnav .ezmore'); if(b) b.remove(); let m=document.querySelector('.moremenu .ezmore'); if(m) m.remove();
    if(!extra.length||!nav) return;
    b=document.createElement('a'); b.href='#features'; b.className='ezmore wideonly'; b.title='Add features';
    b.innerHTML='<svg class="ic" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>More features'; b.onclick=e=>{ e.preventDefault(); shop(); };
    if(more) nav.insertBefore(b,more); else nav.append(b);
    if(menu){ m=document.createElement('a'); m.href='#features'; m.className='ezmore'; m.innerHTML='<span style="font-size:20px">＋</span><span>More features<small>Add what you’d like to use</small></span>'; m.onclick=e=>{ e.preventDefault(); menu.hidden=true; shop(); }; menu.append(m); }
  }
  async function refresh(force){ const c=cached(); if(c) apply(c);
    if(!auth() || (!force && c && Date.now()-(c.at||0)<5*60e3)) return;
    try{ const f=await call('features'); f.at=Date.now(); localStorage.setItem('partners.features',JSON.stringify(f)); apply(f); }
    catch(e){ if(e.status===404){ localStorage.setItem('partners.features',JSON.stringify({perFeature:false,at:Date.now()})); } } }
  window.partnersFeaturesRefresh=refresh;
  async function shop(){
    let f; try{ f=await call('features'); }catch(e){ return alert(e.message); }
    const fmt=c=>'$'+(c/100).toFixed(2), h=(t,s)=>{ const e=document.createElement(t); if(s) e.style.cssText=s; return e; };
    const wrap=h('div','position:fixed;inset:0;z-index:9999;'); wrap.className='ezshop-open'; wrap.style.cssText+=('background:rgba(40,16,40,.45);display:flex;align-items:flex-end;justify-content:center');
    const box=h('div','background:var(--panel);color:var(--text);width:100%;max-width:540px;max-height:88vh;overflow:auto;border-radius:20px 20px 0 0;padding:18px 16px calc(env(safe-area-inset-bottom) + 20px)');
    const t=h('h3','margin:0 0 4px;font:600 21px var(--display,inherit)'); t.textContent='Partners features'; box.append(t);
    const sub=h('p','margin:0 0 12px;color:var(--dim);font-size:14px'); sub.textContent=f.trial?'You can use everything during your free trial. Pick what to keep.':'Pay only for what you use. Add or remove any time.'; box.append(sub);
    const paid=new Set(f.paid||[]), given=new Set(f.given||[]); let iv='month'; const ivRow=h('div','display:flex;gap:6px;margin-bottom:10px');
    if(!paid.size) ['month','year'].forEach(k=>{ const b=h('button','flex:1;border-radius:999px;min-height:40px'); b.textContent=k==='month'?'Monthly':'Yearly'; b.dataset.k=k; b.onclick=()=>{ iv=k; draw(); }; ivRow.append(b); });
    box.append(ivRow); const list=h('div'); box.append(list); const pick=new Set();
    const go=h('button','width:100%;margin-top:12px'); go.className='primary'; const cl=h('button','width:100%;margin-top:6px'); cl.className='ghost'; cl.textContent='Close'; cl.onclick=()=>wrap.remove();
    const draw=()=>{ ivRow.querySelectorAll('button').forEach(b=>{ const on=b.dataset.k===iv; b.style.background=on?'var(--accent)':'var(--panel2)'; b.style.color=on?'#fff':'inherit'; });
      list.replaceChildren(); let tot=0;
      (f.list||[]).filter(x=>x.forSale||x.free||paid.has(x.key)||given.has(x.key)).forEach(x=>{
        const owned=paid.has(x.key)||given.has(x.key)||x.free, row=h('label','display:flex;gap:10px;align-items:center;padding:10px 2px;border-bottom:1px solid var(--line)');
        const cb=h('input','width:22px;height:22px;accent-color:var(--accent);flex:none'); cb.type='checkbox'; cb.checked=owned||pick.has(x.key); cb.disabled=x.free||given.has(x.key);
        cb.onchange=async()=>{ if(owned){ if(!cb.checked && confirm(`Stop paying for ${x.name}? You keep it until the end of what you’ve paid for.`)){ try{ await call('billing/features',{remove:[x.key]}); wrap.remove(); refresh(true); }catch(e){ alert(e.message); cb.checked=true; } } else cb.checked=true; return; }
          cb.checked?pick.add(x.key):pick.delete(x.key); draw(); };
        const tx=h('span','flex:1;min-width:0'); const nb=h('b'); nb.textContent=(x.icon?x.icon+' ':'')+x.name; const ds=h('small','display:block;color:var(--dim);font-size:13px'); ds.textContent=x.description||''; tx.append(nb,ds);
        const pr=h('span','font-weight:800;white-space:nowrap'); pr.textContent=x.free?'Free':given.has(x.key)?'Included':paid.has(x.key)?'✓ Yours':(iv==='year'?fmt(x.yearCents)+'/yr':fmt(x.monthCents)+'/mo');
        if(pick.has(x.key)) tot+=iv==='year'?x.yearCents:x.monthCents; row.append(cb,tx,pr); list.append(row); });
      go.textContent=pick.size?`Add ${pick.size} for ${fmt(tot)}/${iv==='year'?'yr':'mo'}`:'Tick the features you want'; go.disabled=!pick.size; };
    go.onclick=async()=>{ go.disabled=true; go.textContent='One moment…';
      try{ const d=await call('billing/features',{add:[...pick],interval:iv,success_url:location.href,cancel_url:location.href}); if(d.url){ location.href=d.url; return; } wrap.remove(); refresh(true); }
      catch(e){ alert(e.message); draw(); } };
    box.append(go,cl); wrap.append(box); wrap.addEventListener('click',e=>{ if(e.target===wrap) wrap.remove(); }); document.body.append(wrap); draw(); }
  window.partnersShop=shop;
  const start=()=>setTimeout(()=>refresh(false),50);
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start); else start();
  document.addEventListener('visibilitychange',()=>{ if(!document.hidden) refresh(false); });
})();
