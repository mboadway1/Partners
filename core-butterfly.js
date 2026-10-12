'use strict';
// Partners' butterfly: one original drawing used across the app. `flutter` animates the wings.
let _bfly=0;
function butterfly({size=40, flutter=false, cls='', a=(window.PEGGY_BF||['#F06A9B'])[0], b=(window.PEGGY_BF||[0,'#9B7BEA'])[1], title=''}={}){
  const id='bf'+(++_bfly);
  return `<svg class="bfly ${flutter?'flutter':''} ${cls}" width="${size}" height="${Math.round(size*.8)}" viewBox="0 0 100 80" ${title?`role="img" aria-label="${title}"`:'aria-hidden="true"'}>
  <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>
  <linearGradient id="${id}l" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${b}"/><stop offset="1" stop-color="${a}"/></linearGradient></defs>
  <g class="wing wl">
    <path d="M50 38C40 12 14 2 6 16C0 30 22 44 50 41Z" fill="url(#${id})"/>
    <path d="M50 43C32 44 14 54 20 69C27 82 45 64 50 47Z" fill="url(#${id}l)"/>
    <circle cx="22" cy="21" r="5" fill="#fff" opacity=".55"/><circle cx="31" cy="60" r="3.5" fill="#fff" opacity=".5"/>
  </g>
  <g class="wing wr">
    <path d="M50 38C60 12 86 2 94 16C100 30 78 44 50 41Z" fill="url(#${id})"/>
    <path d="M50 43C68 44 86 54 80 69C73 82 55 64 50 47Z" fill="url(#${id}l)"/>
    <circle cx="78" cy="21" r="5" fill="#fff" opacity=".55"/><circle cx="69" cy="60" r="3.5" fill="#fff" opacity=".5"/>
  </g>
  <ellipse cx="50" cy="44" rx="3.2" ry="17" fill="#4A1D3F"/>
  <path d="M49 29C46 18 41 12 35 9M51 29C54 18 59 12 65 9" stroke="#4A1D3F" stroke-width="2" fill="none" stroke-linecap="round"/>
  <circle cx="35" cy="9" r="2.2" fill="#4A1D3F"/><circle cx="65" cy="9" r="2.2" fill="#4A1D3F"/>
</svg>`;
}
