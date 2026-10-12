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
  const MORE=[['plan.html#us','💞','Us','Share a concern, Taking Turns'],['plan.html#fuel','⛽','Fuel','Cheapest fuel nearby or on the way'],['plan.html#links','🔗','Links','Shared link favorites']];
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
      const inMore=/words\.html$/.test(location.pathname) || /plan\.html$/.test(location.pathname)&&['#links','#fuel','#us'].includes(location.hash); more.classList.toggle('on', inMore);
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
    links:'<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'};
  const add=()=>{ const nav=document.querySelector('.bnav'), more=nav&&nav.querySelector('.more'); if(!nav||!more) return;
    for (const [k,l] of [['fuel','Fuel'],['us','Us'],['links','Links']]){
      if (nav.querySelector(`[data-k="${k}"]`)) continue;
      const a=document.createElement('a'); a.href='plan.html#'+k; a.dataset.k=k; a.className='wideonly'; a.title=l;
      a.innerHTML=`<svg class="ic" viewBox="0 0 24 24">${ICON[k]}</svg>${l}`; nav.insertBefore(a, more); } };
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', add); else add();
})();
