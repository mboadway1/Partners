// Peggy shared engine: used by the phone app (index.html) and the TV app (tv.html).
// Edits are stored as settings and applied on the fly, so originals are never changed.
'use strict';
const DEF = {rot:0, flip:false, aspect:'orig', zoom:1, panX:0, panY:0, bright:0, contrast:0, sat:0, warmth:0, preset:'none'};
const ASPECTS = [['orig','Original'],['1','Square'],['0.8','Portrait 4:5'],['1.7778','Wide 16:9'],['0.5625','Story 9:16']];
const PRESETS = {
  none:{name:'Original'}, vivid:{name:'Vivid',sat:35,contrast:15}, warm:{name:'Warm',warmth:35,sat:10,bright:4},
  cool:{name:'Cool',warmth:-35,contrast:5}, punch:{name:'Punch',contrast:30,sat:20,bright:-4},
  fade:{name:'Fade',contrast:-25,bright:10,sat:-25}, bw:{name:'B&W',sat:-100,contrast:15}, noir:{name:'Noir',sat:-100,contrast:45,bright:-6},
};
const SLIDERS = [['bright','Brightness'],['contrast','Contrast'],['sat','Saturation'],['warmth','Warmth']];

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
const el = (tag, props={}, ...kids) => { const e=document.createElement(tag); Object.assign(e, props); for(const k of kids) e.append(k); return e; };
const clamp = (v,a,b) => Math.min(b, Math.max(a, v));
const sleep = ms => new Promise(r=>setTimeout(r,ms));
let toastT;
function toast(msg, ms=3200){ document.querySelectorAll('.toast').forEach(t=>t.remove()); const t=el('div',{className:'toast',textContent:msg}); document.body.append(t); clearTimeout(toastT); toastT=setTimeout(()=>t.remove(), ms); }
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)+Math.random().toString(36).slice(2));

/* ---------- IndexedDB ---------- */
let db;
function openDB(){ return new Promise((res,rej)=>{ const r=indexedDB.open('peggy',1);
  r.onupgradeneeded=()=>{ const d=r.result; d.createObjectStore('photos',{keyPath:'id'}); d.createObjectStore('albums',{keyPath:'id'}); };
  r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }); }
function tx(store, mode, fn){ return new Promise((res,rej)=>{ const t=db.transaction(store,mode); const r=fn(t.objectStore(store)); let out;
  if(r) r.onsuccess=()=>{ out=r.result; }; t.oncomplete=()=>res(out); t.onerror=()=>rej(t.error); t.onabort=()=>rej(t.error); }); }
const dbAll = s => tx(s,'readonly',st=>st.getAll());
const dbPut = (s,v) => tx(s,'readwrite',st=>st.put(v));
const dbDel = (s,k) => tx(s,'readwrite',st=>st.delete(k));

/* ---------- image pipeline ---------- */
function loadImage(blob){ return new Promise((res,rej)=>{ const u=URL.createObjectURL(blob); const i=new Image();
  i.onload=()=>{ res(i); setTimeout(()=>URL.revokeObjectURL(u), 1000); }; i.onerror=()=>{ URL.revokeObjectURL(u); rej(new Error('Could not read image')); }; i.src=u; }); }
function toBlob(c, type='image/jpeg', q=.9){ return new Promise((res,rej)=>c.toBlob(b=>b?res(b):rej(new Error('Export failed')), type, q)); }

function adjust(ctx, w, h, e){
  const p = PRESETS[e.preset] || {};
  const B=(e.bright||0)+(p.bright||0), C=clamp((e.contrast||0)+(p.contrast||0),-100,100),
        S=clamp((e.sat||0)+(p.sat||0),-100,100), W=(e.warmth||0)+(p.warmth||0);
  if(!B && !C && !S && !W) return;
  const d = ctx.getImageData(0,0,w,h), a = d.data;
  const b = B*1.28, c = C*1.28, f = (259*(c+255))/(255*(259-c)), s = 1+S/100, wr = W*.6, wg = W*.1, wb = -W*.6;
  for(let i=0;i<a.length;i+=4){
    let r=f*(a[i]+b-128)+128, g=f*(a[i+1]+b-128)+128, bl=f*(a[i+2]+b-128)+128;
    const y=.299*r+.587*g+.114*bl;
    a[i]=y+(r-y)*s+wr; a[i+1]=y+(g-y)*s+wg; a[i+2]=y+(bl-y)*s+wb;
  }
  ctx.putImageData(d,0,0);
}

function render(img, e, maxDim){
  const iw=img.naturalWidth, ih=img.naturalHeight, rot=((e.rot%360)+360)%360;
  const sw = rot%180 ? ih : iw, sh = rot%180 ? iw : ih;
  const A = e.aspect==='orig' ? sw/sh : parseFloat(e.aspect);
  let cw, ch; if(sw/sh > A){ ch=sh; cw=sh*A; } else { cw=sw; ch=sw/A; }
  cw/=e.zoom; ch/=e.zoom;
  const cx = sw/2 + e.panX*(sw-cw)/2, cy = sh/2 + e.panY*(sh-ch)/2;
  const k = Math.min(1, maxDim/Math.max(cw,ch));
  const W=Math.max(1,Math.round(cw*k)), H=Math.max(1,Math.round(ch*k));
  const c = document.createElement('canvas'); c.width=W; c.height=H;
  const x = c.getContext('2d',{willReadFrequently:true});
  x.imageSmoothingEnabled=true; x.imageSmoothingQuality='high';
  x.scale(k,k); x.translate(-(cx-cw/2), -(cy-ch/2)); x.translate(sw/2, sh/2);
  x.rotate(rot*Math.PI/180); if(e.flip) x.scale(-1,1);
  x.drawImage(img, -iw/2, -ih/2);
  x.setTransform(1,0,0,1,0,0);
  adjust(x, W, H, e);
  c._geom = {sw, sh, cw, ch};
  return c;
}
async function makeThumb(blob, edits){ const img=await loadImage(blob); return toBlob(render(img, edits||DEF, 480), 'image/jpeg', .82); }
function edited(p){ const e=p.edits; if(!e) return false; return Object.keys(DEF).some(k=>e[k]!==DEF[k]); }

// Re-encode a photo so its long edge is at most `max` px (keeps smaller photos as they are).
async function downscale(blob, max){
  const img=await loadImage(blob);
  if(Math.max(img.naturalWidth,img.naturalHeight)<=max && /jpe?g/i.test(blob.type)) return blob;
  return toBlob(render(img, DEF, max), 'image/jpeg', .92);
}
const PEER_PREFIX='peggy-tv-';
const CODE_ALPH='ACDEFHJKMNPRTWXY3479';
