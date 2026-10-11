// Peggy shared engine: used by the phone app (index.html) and the TV app (tv.html).
// Edits are stored as settings and applied on the fly, so originals are never changed.
'use strict';
// crop: {x,y,w,h} as fractions of the (rotated) photo, or null to use the older aspect/zoom/pan settings.
// straight: fine rotation in degrees (−45…45); the photo is enlarged just enough that no blank corners show.
const DEF = {rot:0, flip:false, flipV:false, straight:0, aspect:'orig', crop:null, zoom:1, panX:0, panY:0, bright:0, contrast:0, sat:0, warmth:0, preset:'none'};
const ASPECTS = [['free','Free'],['orig','Original'],['1','Square'],['0.8','4:5'],['0.75','3:4'],['0.6667','2:3'],['1.5','3:2'],['1.3333','4:3'],['1.7778','16:9'],['0.5625','9:16']];
const ASPECT_TIPS = {free:'Crop to any shape', orig:'Keep the photo’s own shape', '1':'Square, good for Instagram and profile pictures', '0.8':'Portrait 4:5, fills the most space in a Facebook or Instagram feed',
  '0.75':'Portrait 3:4', '0.6667':'Portrait 2:3, like a 4×6 print', '1.5':'Landscape 3:2, like a 6×4 print', '1.3333':'Landscape 4:3', '1.7778':'Wide 16:9, fills a TV screen', '0.5625':'Tall 9:16, for stories and phone wallpaper'};
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
function openDB(){ return new Promise((res,rej)=>{ const r=indexedDB.open('peggy',2);
  r.onupgradeneeded=()=>{ const d=r.result;
    for(const s of ['photos','albums','meta']) if(!d.objectStoreNames.contains(s)) d.createObjectStore(s,{keyPath:'id'}); };
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

// The photo after 90° turns: its width and height, and how much straightening enlarges it.
function frameOf(img, e){
  const iw=img.naturalWidth||img.width, ih=img.naturalHeight||img.height, rot=((e.rot%360)+360)%360;
  const sw = rot%180 ? ih : iw, sh = rot%180 ? iw : ih;
  const t=Math.abs(e.straight||0)*Math.PI/180, co=Math.cos(t), si=Math.sin(t);
  const grow=Math.max(co+(sh/sw)*si, (sw/sh)*si+co);
  return {iw, ih, rot, sw, sh, grow};
}
const aspectOf = (e, sw, sh) => { const a=parseFloat(e.aspect); return isFinite(a)&&a>0 ? a : sw/sh; };
// Largest crop of pixel shape A, centred: as fractions of the frame.
function maxCrop(A, sw, sh){ let w=1, h=1; if(sw/sh > A) w=(sh*A)/sw; else h=(sw/A)/sh; return {x:(1-w)/2, y:(1-h)/2, w, h}; }
// The crop as fractions of the frame, from the new crop box or the older aspect/zoom/pan settings.
function cropOf(e, sw, sh){
  if(e.crop) return e.crop;
  const m=maxCrop(aspectOf(e,sw,sh), sw, sh), z=e.zoom||1, w=m.w/z, h=m.h/z;
  return {x:(1-w)/2+(e.panX||0)*(1-w)/2, y:(1-h)/2+(e.panY||0)*(1-h)/2, w, h};
}
// opts.full: draw the whole frame, ignoring the crop (used while cropping).
function render(img, e, maxDim, opts={}){
  const f=frameOf(img, e), {iw, ih, sw, sh}=f;
  const cr = opts.full ? {x:0,y:0,w:1,h:1} : cropOf(e, sw, sh);
  const x0=cr.x*sw, y0=cr.y*sh, cw=Math.max(1,cr.w*sw), ch=Math.max(1,cr.h*sh);
  const k = Math.min(1, maxDim/Math.max(cw,ch));
  const W=Math.max(1,Math.round(cw*k)), H=Math.max(1,Math.round(ch*k));
  const c = document.createElement('canvas'); c.width=W; c.height=H;
  const x = c.getContext('2d',{willReadFrequently:true});
  x.imageSmoothingEnabled=true; x.imageSmoothingQuality='high';
  x.scale(k,k); x.translate(-x0, -y0); x.translate(sw/2, sh/2);
  x.rotate((f.rot+(e.straight||0))*Math.PI/180); x.scale(f.grow*(e.flip?-1:1), f.grow*(e.flipV?-1:1));
  x.drawImage(img, -iw/2, -ih/2);
  x.setTransform(1,0,0,1,0,0);
  adjust(x, W, H, e);
  c._geom = {sw, sh, cw, ch, crop:cr};
  return c;
}
async function makeThumb(blob, edits){ const img=await loadImage(blob); return toBlob(render(img, edits||DEF, 480), 'image/jpeg', .82); }
function editsChanged(e){
  if(!e) return false; e={...DEF, ...e};
  const c=e.crop, cropped = c ? (c.x>.002||c.y>.002||c.w<.996||c.h<.996)
    : ((e.aspect!=='orig'&&e.aspect!=='free') || e.zoom!==1);
  return cropped || ((e.rot%360)+360)%360!==0 || e.flip || e.flipV || !!e.straight
    || ['bright','contrast','sat','warmth'].some(k=>e[k]) || e.preset!=='none';
}
function edited(p){ return !!p.orig || editsChanged(p.edits); }

// Re-encode a photo so its long edge is at most `max` px (keeps smaller photos as they are).
async function downscale(blob, max){
  const img=await loadImage(blob);
  if(Math.max(img.naturalWidth,img.naturalHeight)<=max && /jpe?g/i.test(blob.type)) return blob;
  return toBlob(render(img, DEF, max), 'image/jpeg', .92);
}
// When a JPEG was taken, from its EXIF data (DateTimeOriginal), or null.
async function photoTaken(blob){
  photoTaken.make='';
  try{
    const b=new DataView(await blob.slice(0, 262144).arrayBuffer());
    if(b.getUint16(0)!==0xFFD8) return null;
    let o=2;
    while(o+4<b.byteLength){
      const m=b.getUint16(o), len=b.getUint16(o+2);
      if(m===0xFFE1 && b.getUint32(o+4)===0x45786966){            // "Exif"
        const t=o+10, le=b.getUint16(t)===0x4949, u16=x=>b.getUint16(t+x,le), u32=x=>b.getUint32(t+x,le);
        const str=(off,n)=>{ let r=''; for(let i=0;i<n-1;i++) r+=String.fromCharCode(b.getUint8(t+off+i)); return r; };
        const find=(ifd,tag)=>{ const n=u16(ifd); for(let i=0;i<n;i++){ const e=ifd+2+i*12; if(u16(e)===tag) return e; } return 0; };
        const ifd0=u32(4); let when='';
        const mk=find(ifd0,0x010F); if(mk){ const n=u32(mk+4); photoTaken.make = n>4 ? str(u32(mk+8),Math.min(n,40)) : str(mk+8,n); }
        const ex=find(ifd0,0x8769); if(ex){ const sub=u32(ex+8), e=find(sub,0x9003)||find(sub,0x9004); if(e) when=str(u32(e+8),20); }
        if(!when){ const e=find(ifd0,0x0132); if(e) when=str(u32(e+8),20); }
        const m2=when.match(/^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/);
        return m2 ? new Date(+m2[1], m2[2]-1, +m2[3], +m2[4], +m2[5], +m2[6]).getTime() : null;
      }
      if((m&0xFF00)!==0xFF00) break; o+=2+len;
    }
  }catch(_){}
  return null;
}
/* ---------- duplicate detection ---------- */
// A "looks like" fingerprint: the photo shrunk to 16×16 grey dots (one hex digit each) plus its overall colour.
// The same photo saved at another size, quality or name gives almost the same fingerprint.
function photoHash(img){
  const c=document.createElement('canvas'); c.width=16; c.height=16; const x=c.getContext('2d',{willReadFrequently:true});
  x.imageSmoothingEnabled=true; x.imageSmoothingQuality='high'; x.drawImage(img,0,0,16,16);
  const d=x.getImageData(0,0,16,16).data; let hex='', r=0, g=0, b=0;
  for(let i=0;i<256;i++){ const R=d[i*4], G=d[i*4+1], B=d[i*4+2]; r+=R; g+=G; b+=B; hex+=Math.min(15,Math.round((R*.299+G*.587+B*.114)/17)).toString(16); }
  return 'v2'+hex+[r,g,b].map(v=>Math.min(15,Math.round(v/256/17)).toString(16)).join('');
}
// Average difference per dot (0 = identical, 15 = opposite); 99 when the colours or versions don't match.
function hashDist(a,b){
  if(!a||!b||a.length!==b.length||!a.startsWith('v2')) return 99;
  for(let i=258;i<261;i++) if(Math.abs(parseInt(a[i],16)-parseInt(b[i],16))>1) return 99;
  let d=0; for(let i=2;i<258;i++) d+=Math.abs(parseInt(a[i],16)-parseInt(b[i],16)); return d/256;
}
// Same photo: nearly identical fingerprint, or a close one taken at the same moment.
function sameShot(a, b){
  const d=hashDist(a.hash,b.hash);
  // Measured: a re-saved or resized copy differs by about 0.02; quick burst shots of a moving scene by 0.14 or more.
  if(d<=.08) return true;
  return d<=.11 && a.created && b.created && Math.abs(a.created-b.created)<=2000;
}
// Screenshots: named like one, or a PNG with no camera information. Real photos and exports from
// Lightroom or the camera carry the camera's make.
const SHOT_NAME=/screen ?shot|screenshot|screen_shot|scrnli|^simulator/i;
const skipShots = () => { try{ return localStorage.getItem('peggy.skipShots')!=='0'; }catch(_){ return true; } };
function looksLikeScreenshot({name, type, make}){ return SHOT_NAME.test(name||'') || (/png/i.test(type||'') && !make); }
const PEER_PREFIX='peggy-tv-';
const CODE_ALPH='ACDEFHJKMNPRTWXY3479';
