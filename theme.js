// Partners color themes. Pink is the default. Loaded in <head> so the colors are right before anything draws.
// Each page says what it is with <html data-peggy="phone|words|tv">.
'use strict';
const PEGGY_THEMES = {
  pink:     { name:'Pink',     bg:'#FFE9F1', panel:'#FFF8FB', panel2:'#FBDCE8', line:'#F4C6D8', text:'#4A1D3F', dim:'#9B6B8E', accent:'#D1386E', accentDark:'#A82556', second:'#8B6CE0', bf1:'#F06A9B', bf2:'#9B7BEA', deep:'#2A1230' },
  lavender: { name:'Lavender', bg:'#F1ECFF', panel:'#FBF9FF', panel2:'#E4DAFB', line:'#D3C5F5', text:'#33215C', dim:'#7A68A6', accent:'#7B4FD6', accentDark:'#5A35AE', second:'#D1386E', bf1:'#A98BF0', bf2:'#F06A9B', deep:'#1E1438' },
  ocean:    { name:'Ocean',    bg:'#E6F4FA', panel:'#F7FCFE', panel2:'#CFE9F3', line:'#B5DCEA', text:'#10324A', dim:'#557A92', accent:'#17709F', accentDark:'#0F5376', second:'#0E8F7B', bf1:'#4FB3E8', bf2:'#3DD6B5', deep:'#0C2233' },
  mint:     { name:'Mint',     bg:'#E8F7EF', panel:'#F7FDF9', panel2:'#D2EEDD', line:'#B8E2C9', text:'#173A2A', dim:'#5B806C', accent:'#1B7F51', accentDark:'#13603C', second:'#C9573B', bf1:'#5ED39A', bf2:'#F2C14E', deep:'#102419' },
  sunset:   { name:'Sunset',   bg:'#FFF0E3', panel:'#FFFAF5', panel2:'#FFDFC4', line:'#F7CBA6', text:'#4A2614', dim:'#9A6A4E', accent:'#C24A17', accentDark:'#933510', second:'#B5306F', bf1:'#FF9A4D', bf2:'#E8559A', deep:'#2A140A' },
  midnight: { name:'Midnight', dark:true, bg:'#1C1426', panel:'#261C33', panel2:'#34274A', line:'#43345C', text:'#F5EAFB', dim:'#B9A6CC', accent:'#E0508A', accentDark:'#A83361', second:'#A98BF0', bf1:'#F06A9B', bf2:'#A98BF0', deep:'#120C18' },
};
const PEGGY_THEME_ORDER = ['pink','lavender','ocean','mint','sunset','midnight'];

function peggyThemeName(){ try{ const t=localStorage.getItem('peggy.theme'); return PEGGY_THEMES[t]?t:'pink'; }catch(_){ return 'pink'; } }
function peggyTheme(){ return PEGGY_THEMES[peggyThemeName()]; }

// Blend two hex colors; w = share of b.
function peggyMix(a,b,w){ const p=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)); const x=p(a), y=p(b);
  return '#'+x.map((v,i)=>Math.round(v*(1-w)+y[i]*w).toString(16).padStart(2,'0')).join(''); }
function peggyRgba(h,a){ return `rgba(${[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)).join(',')},${a})`; }

function applyPeggyTheme(name){
  const t = PEGGY_THEMES[name] || PEGGY_THEMES.pink, kind = document.documentElement.dataset.peggy || 'phone';
  const st = document.documentElement.style, set=(k,v)=>st.setProperty(k,v);
  window.PEGGY_BF = [t.bf1, t.bf2];
  if (kind === 'tv'){
    // The TV is always a dark room: the theme's deep color with its bright accents.
    const bg=t.deep;
    set('--bg',bg); set('--panel',peggyMix(bg,'#ffffff',.08)); set('--panel2',peggyMix(bg,'#ffffff',.15)); set('--line',peggyMix(bg,'#ffffff',.22));
    set('--text',peggyMix(t.bf1,'#ffffff',.88)); set('--dim',peggyMix(t.bf1,'#ffffff',.55)); set('--accent',t.bf1); set('--lilac',t.bf2);
    set('--photo',peggyMix(bg,'#000000',.35)); set('--scrim',peggyRgba(peggyMix(bg,'#000000',.4),.78));
  } else {
    set('--bg',t.bg); set('--panel',t.panel); set('--panel2',t.panel2); set('--line',t.line); set('--text',t.text); set('--dim',t.dim);
    set('--accent',t.accent); set('--accent2',t.accent); set('--accentDark',t.accentDark); set('--lilac',t.second); set('--photo',t.deep);
    set('--headerbg',peggyRgba(t.bg,.9)); set('--inputbg',t.dark?peggyMix(t.panel,'#000000',.2):'#ffffff');
    set('--wash1',peggyRgba(t.bg,.72)); set('--wash2',peggyRgba(t.bg,.5)); set('--card',peggyRgba(t.panel,.86));
    set('--onaccent','#ffffff');
    if (kind === 'words'){
      set('--surface',t.panel); set('--fg',t.text); set('--muted',t.dim); set('--s1',t.accent); set('--s2',t.second);
    }
    const m=document.querySelector('meta[name=theme-color]'); if(m) m.setAttribute('content',t.bg);
    st.colorScheme = t.dark ? 'dark' : 'light';
  }
  document.documentElement.dataset.theme = name;
}
function setPeggyTheme(name){
  if (!PEGGY_THEMES[name]) return;
  try{ localStorage.setItem('peggy.theme', name); }catch(_){}
  applyPeggyTheme(name);
  document.dispatchEvent(new CustomEvent('peggytheme',{detail:name}));
}
// A row of color swatches; tapping one switches the theme everywhere.
function peggyThemePicker(){
  const wrap=document.createElement('div'); wrap.className='themepick'; wrap.setAttribute('role','radiogroup'); wrap.setAttribute('aria-label','Theme color');
  const draw=()=>{ wrap.replaceChildren(...PEGGY_THEME_ORDER.map(k=>{ const t=PEGGY_THEMES[k], b=document.createElement('button');
    b.type='button'; b.className='swatch'+(k===peggyThemeName()?' on':''); b.title=`${t.name} theme`; b.setAttribute('role','radio'); b.setAttribute('aria-checked',k===peggyThemeName());
    b.style.background=`linear-gradient(135deg, ${t.bf1}, ${t.bf2})`; b.style.setProperty('--ring', t.accent);
    const l=document.createElement('span'); l.textContent=t.name; b.append(l);
    b.onclick=()=>{ setPeggyTheme(k); draw(); }; return b; })); };
  draw(); return wrap;
}
applyPeggyTheme(peggyThemeName());

/* ---------- bottom menu: the "More" button opens Links and Words ---------- */
(function(){
  const MORE=[['plan.html#us','💞','Us','Check-ins, appreciations, talking it through, Words'],['plan.html#fuel','⛽','Fuel','Cheapest fuel nearby or on the way'],['plan.html#links','🔗','Links','Shared link favorites']];
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
