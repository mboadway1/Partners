'use strict';
// Partners' symbol: the little drawing beside "Partners" and around the app. A butterfly by default; you can
// pick another style in Settings (it's shared by both of you on every device). All are original drawings,
// colored by the theme. The function keeps its old name, butterfly(), so every page keeps working.
let _bfly=0;
const PARTNERS_SYMBOLS=[
  ['butterfly','Butterfly'],['hearts','Two hearts'],['infinity','Infinity'],['flower','Flower'],['star','Star'],
  ['moon','Moon & star'],['leaves','Leaves'],['sun','Sun'],['camper','Camper'],['wave','Wave'],
];
function partnersSymbol(){ try{ const s=localStorage.getItem('partners.symbol'); return PARTNERS_SYMBOLS.some(x=>x[0]===s)?s:'butterfly'; }catch(_){ return 'butterfly'; } }
const _heart=(x,y,s,f)=>`<path transform="translate(${x} ${y}) scale(${s})" d="M0 12C-14 3-20-6-15-13C-10-19-3-17 0-11C3-17 10-19 15-13C20-6 14 3 0 12Z" fill="${f}"/>`;
function _symbolBody(kind,id){
  const A=`url(#${id})`, B=`url(#${id}l)`, ink='#4A1D3F';
  switch(kind){
    case 'hearts': return `<g class="pulse">${_heart(37,40,1.55,A)}${_heart(64,36,1.35,B)}<circle cx="27" cy="27" r="4" fill="#fff" opacity=".55"/><circle cx="56" cy="26" r="3" fill="#fff" opacity=".5"/></g>`;
    case 'infinity': return `<g class="pulse"><path d="M50 40C40 22 16 20 16 40C16 60 40 58 50 40C60 22 84 20 84 40C84 60 60 58 50 40Z" fill="none" stroke="${A}" stroke-width="10" stroke-linejoin="round"/><circle cx="26" cy="32" r="3" fill="#fff" opacity=".6"/></g>`;
    case 'flower': return `<g class="spin">${[0,72,144,216,288].map((r,i)=>`<ellipse cx="50" cy="22" rx="11" ry="18" fill="${i%2?B:A}" transform="rotate(${r} 50 40)"/>`).join('')}<circle cx="50" cy="40" r="10" fill="#FFD66B"/><circle cx="47" cy="37" r="3" fill="#fff" opacity=".7"/></g>`;
    case 'star': { const pts=[...Array(10)].map((_,i)=>{ const r=i%2?15:34, a=-Math.PI/2+i*Math.PI/5; return `${(50+r*Math.cos(a)).toFixed(1)},${(43+r*Math.sin(a)).toFixed(1)}`; }).join(' ');
      return `<g class="pulse"><polygon points="${pts}" fill="${A}" stroke="${B}" stroke-width="4" stroke-linejoin="round"/><path d="M84 10l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" fill="${B}"/><path d="M15 58l1.5 4 4 1.5-4 1.5-1.5 4-1.5-4-4-1.5 4-1.5z" fill="${A}"/><circle cx="42" cy="34" r="3.5" fill="#fff" opacity=".55"/></g>`; }
    case 'moon': return `<g class="pulse"><path d="M56 8A32 32 0 1 0 82 58A26 26 0 1 1 56 8Z" fill="${A}"/><path d="M78 16l2.5 7 7 2.5-7 2.5-2.5 7-2.5-7-7-2.5 7-2.5z" fill="${B}"/><circle cx="36" cy="30" r="4" fill="#fff" opacity=".45"/></g>`;
    case 'leaves': return `<g class="sway"><path d="M50 74C50 56 50 40 50 30" stroke="${ink}" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M50 50C34 52 16 42 14 18C34 16 48 28 50 50Z" fill="${A}"/><path d="M50 40C60 22 76 12 92 14C90 36 72 46 50 40Z" fill="${B}"/><path d="M50 50C38 44 26 32 20 22M50 40C62 34 74 24 84 18" stroke="#fff" stroke-width="1.6" opacity=".55" fill="none"/></g>`;
    case 'sun': return `<g class="spin">${[...Array(8)].map((_,i)=>`<rect x="47" y="2" width="6" height="14" rx="3" fill="${i%2?B:A}" transform="rotate(${i*45} 50 40)"/>`).join('')}<circle cx="50" cy="40" r="19" fill="${A}"/><circle cx="43" cy="33" r="5" fill="#fff" opacity=".5"/></g>`;
    case 'camper': return `<g class="bob"><rect x="10" y="20" width="64" height="38" rx="9" fill="${A}"/><path d="M74 32h8c5 0 9 4 9 9v17H74Z" fill="${B}"/><rect x="18" y="28" width="16" height="12" rx="3" fill="#fff" opacity=".8"/><rect x="40" y="28" width="16" height="12" rx="3" fill="#fff" opacity=".8"/><path d="M78 36h6c2 0 4 2 4 4v4H78Z" fill="#fff" opacity=".8"/><rect x="10" y="46" width="81" height="4" fill="#fff" opacity=".35"/><circle cx="28" cy="62" r="8" fill="${ink}"/><circle cx="28" cy="62" r="3" fill="#fff"/><circle cx="76" cy="62" r="8" fill="${ink}"/><circle cx="76" cy="62" r="3" fill="#fff"/></g>`;
    case 'wave': return `<g class="sway"><path d="M6 52C18 52 18 30 34 30C50 30 46 52 62 52C76 52 74 22 94 22" fill="none" stroke="${A}" stroke-width="10" stroke-linecap="round"/><path d="M6 68C18 68 20 54 34 54C48 54 48 68 62 68C76 68 78 48 94 46" fill="none" stroke="${B}" stroke-width="6" stroke-linecap="round" opacity=".85"/><circle cx="80" cy="10" r="5" fill="${B}"/></g>`;
    default: return `<g class="wing wl">
    <path d="M50 38C40 12 14 2 6 16C0 30 22 44 50 41Z" fill="${A}"/>
    <path d="M50 43C32 44 14 54 20 69C27 82 45 64 50 47Z" fill="${B}"/>
    <circle cx="22" cy="21" r="5" fill="#fff" opacity=".55"/><circle cx="31" cy="60" r="3.5" fill="#fff" opacity=".5"/>
  </g>
  <g class="wing wr">
    <path d="M50 38C60 12 86 2 94 16C100 30 78 44 50 41Z" fill="${A}"/>
    <path d="M50 43C68 44 86 54 80 69C73 82 55 64 50 47Z" fill="${B}"/>
    <circle cx="78" cy="21" r="5" fill="#fff" opacity=".55"/><circle cx="69" cy="60" r="3.5" fill="#fff" opacity=".5"/>
  </g>
  <ellipse cx="50" cy="44" rx="3.2" ry="17" fill="${ink}"/>
  <path d="M49 29C46 18 41 12 35 9M51 29C54 18 59 12 65 9" stroke="${ink}" stroke-width="2" fill="none" stroke-linecap="round"/>
  <circle cx="35" cy="9" r="2.2" fill="${ink}"/><circle cx="65" cy="9" r="2.2" fill="${ink}"/>`;
  }
}
function butterfly({size=40, flutter=false, cls='', a=(window.PARTNERS_BF||['#F06A9B'])[0], b=(window.PARTNERS_BF||[0,'#9B7BEA'])[1], title='', kind=partnersSymbol()}={}){
  const id='bf'+(++_bfly);
  return `<svg class="bfly ${flutter?'flutter':''} ${cls}" data-size="${size}" data-kind="${kind}" width="${size}" height="${Math.round(size*.8)}" viewBox="0 0 100 80" ${title?`role="img" aria-label="${title}"`:'aria-hidden="true"'}>
  <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>
  <linearGradient id="${id}l" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${b}"/><stop offset="1" stop-color="${a}"/></linearGradient></defs>
  ${_symbolBody(kind,id)}
</svg>`;
}
// Gentle motion for the other symbols (the butterfly's wings flap with each page's own CSS).
(function(){ const st=document.createElement('style'); st.textContent=`
.bfly .pulse,.bfly .spin,.bfly .sway,.bfly .bob{transform-box:view-box;transform-origin:50px 40px}
.bfly.flutter .pulse{animation:bfPulse 2.4s ease-in-out infinite} .bfly.flutter .spin{animation:bfSpin 14s linear infinite}
.bfly.flutter .sway{animation:bfSway 3s ease-in-out infinite} .bfly.flutter .bob{animation:bfBob 1.6s ease-in-out infinite}
@keyframes bfPulse{50%{transform:scale(1.08)}} @keyframes bfSpin{to{transform:rotate(360deg)}}
@keyframes bfSway{50%{transform:rotate(-6deg)}} @keyframes bfBob{50%{transform:translateY(-3px)}}
@media (prefers-reduced-motion:reduce){.bfly .pulse,.bfly .spin,.bfly .sway,.bfly .bob{animation:none!important}}
.sympick{display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:8px;margin:6px 0 12px}
.sympick button{display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 4px;border-radius:14px;background:var(--panel2);border:2px solid transparent;min-height:0}
.sympick button.on{border-color:var(--accent);background:var(--panel)} .sympick button span{font-size:12px;font-weight:800;color:var(--dim)}`;
  (document.head||document.documentElement).append(st); })();
// Redraw every symbol already on the page (after a new pick, here or on another device).
function partnersRedrawSymbols(){ document.querySelectorAll('svg.bfly').forEach(s=>{ if(s.dataset.kind===partnersSymbol() || s.closest('.sympick')) return;
  const size=+s.dataset.size||+s.getAttribute('width')||40, t=document.createElement('div');
  t.innerHTML=butterfly({size, flutter:s.classList.contains('flutter'), cls:[...s.classList].filter(c=>c!=='bfly'&&c!=='flutter').join(' ')});
  const n=t.firstElementChild; if(s.getAttribute('style')) n.setAttribute('style',s.getAttribute('style')); s.replaceWith(n); }); }
// The picker shown in Settings, under the theme colors.
function partnersSymbolPicker(){
  const wrap=document.createElement('div'); wrap.className='sympick'; wrap.setAttribute('role','radiogroup'); wrap.setAttribute('aria-label','Symbol');
  const draw=()=>{ const cur=partnersSymbol(); wrap.replaceChildren(...PARTNERS_SYMBOLS.map(([k,l])=>{ const b=document.createElement('button');
    b.type='button'; b.className=k===cur?'on':''; b.setAttribute('role','radio'); b.setAttribute('aria-checked',k===cur); b.title=l;
    b.innerHTML=butterfly({size:44, kind:k}); const s=document.createElement('span'); s.textContent=l; b.append(s);
    b.onclick=()=>{ try{ localStorage.setItem('partners.symbol',k); }catch(_){} draw(); partnersRedrawSymbols(); }; return b; })); };
  draw(); return wrap;
}
document.addEventListener('partnerssettings',e=>{ if(!e.detail || e.detail.includes('partners.symbol')) partnersRedrawSymbols(); });
