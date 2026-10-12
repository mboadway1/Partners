// Partners magic tools: magic eraser (fills painted areas from their surroundings) and blur background.
// Both change the photo's pixels, so the editor keeps the untouched original in p.orig and Revert brings it back.
'use strict';

/* ---------- shared helpers ---------- */
const MAGIC_MAX = 4096;                       // largest photo the magic tools work on (also the download size)
function canvasOf(src, maxDim){
  const w0=src.naturalWidth||src.width, h0=src.naturalHeight||src.height, k=Math.min(1, (maxDim||1e9)/Math.max(w0,h0));
  const c=document.createElement('canvas'); c.width=Math.max(1,Math.round(w0*k)); c.height=Math.max(1,Math.round(h0*k));
  const x=c.getContext('2d'); x.imageSmoothingEnabled=true; x.imageSmoothingQuality='high'; x.drawImage(src,0,0,c.width,c.height); return c;
}
// A smooth blur that works on iPhone too (Safari has no canvas blur filter): shrink in halves, then grow back.
function softBlur(src, radius){
  const W=src.width, H=src.height; if(radius<1) return canvasOf(src);
  let cur=src, w=W, h=H; const steps=[];
  const target=Math.max(1, radius/1.6);
  while(W/w < target && w>2 && h>2){ w=Math.max(1,Math.round(w/2)); h=Math.max(1,Math.round(h/2));
    const c=document.createElement('canvas'); c.width=w; c.height=h; const x=c.getContext('2d'); x.imageSmoothingQuality='high'; x.drawImage(cur,0,0,w,h); steps.push(c); cur=c; }
  while(steps.length>1){ steps.pop(); const up=steps[steps.length-1]; const x=up.getContext('2d'); x.clearRect(0,0,up.width,up.height); x.imageSmoothingQuality='high'; x.drawImage(cur,0,0,up.width,up.height); cur=up; }
  const out=document.createElement('canvas'); out.width=W; out.height=H; const x=out.getContext('2d'); x.imageSmoothingQuality='high'; x.drawImage(cur,0,0,W,H); return out;
}
// Maps the photo's own pixels to the editor's frame (after turns, straightening and flips).
function imageToFrame(img, e){
  const f=frameOf(img, e);
  return new DOMMatrix().translate(f.sw/2, f.sh/2).rotate(f.rot+(e.straight||0)).scale(f.grow*(e.flip?-1:1), f.grow*(e.flipV?-1:1)).translate(-f.iw/2, -f.ih/2);
}
function busy(on, text){ const st=$('#edStage'); st.querySelectorAll('.busy').forEach(b=>b.remove()); if(on) st.append(el('div',{className:'busy',textContent:text||'Working…'})); }

/* ---------- magic tab state ---------- */
// ed.mode: 'erase' | 'blur'; ed.strokes: [{r, pts:[[fx,fy],…]}] in fractions of the frame; ed.history: earlier pixel versions for Undo.
function magicEnter(){
  if(!ed) return;
  if(!ed.mode) ed.mode='erase';
  ed.strokes=ed.strokes||[]; ed.history=ed.history||[];
  const big=Math.max(ed.img.naturalWidth||ed.img.width, ed.img.naturalHeight||ed.img.height);
  if(big>MAGIC_MAX || !(ed.img instanceof HTMLCanvasElement)) ed.img=canvasOf(ed.img, MAGIC_MAX);
  magicSync();
}
function magicLeave(){ if(ed){ ed.preview=null; } }
function magicSync(){
  if(!ed) return;
  $('#mgErase').classList.toggle('on', ed.mode==='erase'); $('#mgBlur').classList.toggle('on', ed.mode==='blur');
  $('#mgErasePanel').classList.toggle('hidden', ed.mode!=='erase'); $('#mgBlurPanel').classList.toggle('hidden', ed.mode!=='blur');
  $('#mgUndo').disabled=!(ed.history&&ed.history.length);
  $('#mgDoErase').disabled=!(ed.strokes&&ed.strokes.length); $('#mgUndoStroke').disabled=$('#mgDoErase').disabled; $('#mgClear').disabled=$('#mgDoErase').disabled;
}
// Called by draw() after the frame is on screen.
function magicOverlay(){
  if(!ed||!ed.c||ed.tab!=='magic') return;
  const st=$('#edStage'), sr=st.getBoundingClientRect(), r=ed.c.getBoundingClientRect();
  let pc=st.querySelector('.paint'); if(!pc){ pc=el('canvas',{className:'paint'}); st.append(pc); }
  const dpr=Math.min(devicePixelRatio||1,2);
  pc.width=Math.round(r.width*dpr); pc.height=Math.round(r.height*dpr);
  Object.assign(pc.style,{left:(r.left-sr.left)+'px', top:(r.top-sr.top)+'px', width:r.width+'px', height:r.height+'px'});
  paintStrokes(pc);
}
function paintStrokes(pc){
  pc=pc||$('#edStage .paint'); if(!pc) return; const x=pc.getContext('2d'); x.clearRect(0,0,pc.width,pc.height);
  if(ed.mode!=='erase') return;
  x.strokeStyle='#ff2d7a'; x.fillStyle='#ff2d7a'; x.lineCap='round'; x.lineJoin='round';
  for(const s of ed.strokes){ x.lineWidth=s.r*2*pc.width; x.beginPath();
    s.pts.forEach(([fx,fy],i)=>{ const X=fx*pc.width, Y=fy*pc.height; i?x.lineTo(X,Y):x.moveTo(X,Y); });
    if(s.pts.length===1){ x.arc(s.pts[0][0]*pc.width, s.pts[0][1]*pc.height, s.r*pc.width, 0, Math.PI*2); x.fill(); } else x.stroke(); }
}

/* ---------- painting ---------- */
(function(){
  const st=$('#edStage'); let cur=null;
  const pt=ev=>{ const r=ed.c.getBoundingClientRect(); return [clamp((ev.clientX-r.left)/r.width,0,1), clamp((ev.clientY-r.top)/r.height,0,1)]; };
  st.addEventListener('pointerdown',ev=>{ if(!ed||!ed.c||ed.tab!=='magic'||ed.mode!=='erase'||ed.working) return;
    const r=ed.c.getBoundingClientRect(); cur={r:(+$('#brush').value/2)/r.width, pts:[pt(ev)]}; ed.strokes.push(cur);
    st.setPointerCapture(ev.pointerId); paintStrokes(); magicSync(); });
  st.addEventListener('pointermove',ev=>{ if(!cur) return; cur.pts.push(pt(ev)); paintStrokes(); });
  const end=()=>{ cur=null; }; st.addEventListener('pointerup',end); st.addEventListener('pointercancel',end);
})();
$('#brush').oninput=e=>{ $('#brushV').textContent=e.target.value; };
$('#mgErase').onclick=()=>{ ed.mode='erase'; ed.preview=null; magicSync(); draw(); };
$('#mgBlur').onclick=()=>{ ed.mode='blur'; magicSync(); blurPreview(); };
$('#mgUndoStroke').onclick=()=>{ ed.strokes.pop(); paintStrokes(); magicSync(); };
$('#mgClear').onclick=()=>{ ed.strokes=[]; paintStrokes(); magicSync(); };
$('#mgUndo').onclick=()=>{ if(!ed.history.length) return; ed.img=ed.history.pop(); ed.personMask=null; ed.preview=null; ed.baked=ed.history.length>0||ed.baked; ed.dirty=true;
  magicSync(); if(ed.mode==='blur') blurPreview(); else draw(); buildPresets(); };
function bake(next){ ed.history.push(ed.img); if(ed.history.length>5) ed.history.shift(); ed.img=next; ed.baked=true; ed.dirty=true; ed.personMask=null; ed.preview=null; }

/* ---------- magic eraser ---------- */
$('#mgDoErase').onclick=async()=>{
  if(!ed||!ed.strokes.length||ed.working) return;
  ed.working=true; busy(true,'Erasing…');
  try{ const out=await eraseStrokes(ed.img, ed.e, ed.strokes); bake(out); ed.strokes=[]; draw(); buildPresets(); toast('Erased ✨'); }
  catch(err){ console.error(err); toast('Could not erase: '+err.message, 5000); }
  finally{ ed.working=false; busy(false); magicSync(); }
};
async function eraseStrokes(img, e, strokes){
  const iw=img.width, ih=img.height, f=frameOf(img,e);
  // 1. The painted area, in the photo's own pixels.
  const mask=document.createElement('canvas'); mask.width=iw; mask.height=ih; const mx=mask.getContext('2d');
  const inv=imageToFrame(img,e).inverse(); mx.setTransform(inv.a,inv.b,inv.c,inv.d,inv.e,inv.f);
  mx.strokeStyle='#000'; mx.fillStyle='#000'; mx.lineCap='round'; mx.lineJoin='round';
  for(const s of strokes){ const w=s.r*2*f.sw*1.12; mx.lineWidth=w; mx.beginPath();
    s.pts.forEach(([fx,fy],i)=>{ const X=fx*f.sw, Y=fy*f.sh; i?mx.lineTo(X,Y):mx.moveTo(X,Y); });
    if(s.pts.length===1){ mx.arc(s.pts[0][0]*f.sw, s.pts[0][1]*f.sh, w/2, 0, Math.PI*2); mx.fill(); } else mx.stroke(); }
  mx.setTransform(1,0,0,1,0,0);
  // 2. Work on a box around it, with room to borrow texture from.
  const md=mx.getImageData(0,0,iw,ih).data; let x0=iw,y0=ih,x1=-1,y1=-1;
  for(let y=0;y<ih;y+=2) for(let x=0;x<iw;x+=2) if(md[(y*iw+x)*4+3]>8){ if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y; }
  if(x1<0) throw new Error('nothing painted on the photo');
  const bw=x1-x0+1, bh=y1-y0+1, m=Math.round(Math.max(24, .8*Math.max(bw,bh)));
  const rx=Math.max(0,x0-m), ry=Math.max(0,y0-m), rw=Math.min(iw,x1+m+2)-rx, rh=Math.min(ih,y1+m+2)-ry;
  const ws=Math.min(1, 460/Math.max(rw,rh)), W=Math.max(8,Math.round(rw*ws)), H=Math.max(8,Math.round(rh*ws));
  const wc=document.createElement('canvas'); wc.width=W; wc.height=H; const wx=wc.getContext('2d',{willReadFrequently:true}); wx.imageSmoothingQuality='high';
  wx.drawImage(img, rx,ry,rw,rh, 0,0,W,H); const pix=wx.getImageData(0,0,W,H);
  const wm=document.createElement('canvas'); wm.width=W; wm.height=H; const wmx=wm.getContext('2d',{willReadFrequently:true}); wmx.drawImage(mask, rx,ry,rw,rh, 0,0,W,H);
  const ma=wmx.getImageData(0,0,W,H).data, hole=new Uint8Array(W*H); for(let i=0;i<W*H;i++) hole[i]=ma[i*4+3]>10?1:0;
  // 3. Fill it from its surroundings (in a background worker so the screen stays smooth).
  const filled=await runInpaint(pix.data, hole, W, H);
  wx.putImageData(new ImageData(filled,W,H),0,0);
  // 4. Blend the fill back in with a soft edge.
  const soft=document.createElement('canvas'); soft.width=rw; soft.height=rh; const sx=soft.getContext('2d');
  const sm=document.createElement('canvas'); sm.width=Math.max(1,Math.round(rw/6)); sm.height=Math.max(1,Math.round(rh/6));
  const smx=sm.getContext('2d'); smx.imageSmoothingQuality='high'; smx.drawImage(mask, rx,ry,rw,rh, 0,0,sm.width,sm.height);
  sx.imageSmoothingQuality='high'; sx.drawImage(sm,0,0,rw,rh); sx.drawImage(mask, rx,ry,rw,rh, 0,0,rw,rh);
  sx.globalCompositeOperation='source-in'; sx.drawImage(wc,0,0,rw,rh);
  const out=canvasOf(img); out.getContext('2d').drawImage(soft, rx, ry); return out;
}
let inpaintWorker=null;
function runInpaint(data, hole, W, H){
  if(!inpaintWorker) inpaintWorker=new Worker(URL.createObjectURL(new Blob(['('+inpaintCode.toString()+')()'],{type:'text/javascript'})));
  return new Promise((res,rej)=>{ inpaintWorker.onmessage=e=>e.data.error?rej(new Error(e.data.error)):res(new Uint8ClampedArray(e.data.out));
    inpaintWorker.onerror=e=>rej(new Error(e.message||'worker failed'));
    const d=new Uint8ClampedArray(data); inpaintWorker.postMessage({data:d.buffer, hole:hole.buffer, W, H},[d.buffer, hole.buffer]); });
}
// Patch-based filling (in the spirit of "content-aware fill"): coarse to fine, each hole pixel is rebuilt
// from the best-matching patches found elsewhere in the picture.
function inpaintCode(){
  const R=3;
  function down(L){ const {img,hole,W,H}=L, w=Math.ceil(W/2), h=Math.ceil(H/2), o=new Float32Array(w*h*3), oh=new Uint8Array(w*h);
    for(let y=0;y<h;y++) for(let x=0;x<w;x++){ let n=0,r=0,g=0,b=0,any=0;
      for(let dy=0;dy<2;dy++) for(let dx=0;dx<2;dx++){ const X=2*x+dx, Y=2*y+dy; if(X>=W||Y>=H) continue; const i=Y*W+X;
        if(hole[i]) any=1; else { r+=img[i*3]; g+=img[i*3+1]; b+=img[i*3+2]; n++; } }
      const j=y*w+x; oh[j]=any; if(n){ o[j*3]=r/n; o[j*3+1]=g/n; o[j*3+2]=b/n; } }
    return {img:o, hole:oh, W:w, H:h}; }
  function diffuse(L){ const {img,hole,W,H}=L, known=new Uint8Array(W*H); let left=0;
    for(let i=0;i<W*H;i++){ known[i]=hole[i]?0:1; if(hole[i]) left++; }
    if(left===W*H){ img.fill(128); return; }
    while(left>0){ const add=[];
      for(let y=0;y<H;y++) for(let x=0;x<W;x++){ const i=y*W+x; if(known[i]) continue; let n=0,r=0,g=0,b=0;
        for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++){ const X=x+dx,Y=y+dy; if(X<0||Y<0||X>=W||Y>=H) continue; const j=Y*W+X; if(known[j]){ r+=img[j*3]; g+=img[j*3+1]; b+=img[j*3+2]; n++; } }
        if(n) add.push(i, r/n, g/n, b/n); }
      if(!add.length) break;
      for(let k=0;k<add.length;k+=4){ const i=add[k]; img[i*3]=add[k+1]; img[i*3+1]=add[k+2]; img[i*3+2]=add[k+3]; known[i]=1; left--; } } }
  function integral(hole,W,H){ const S=new Int32Array((W+1)*(H+1)); for(let y=0;y<H;y++){ let row=0; for(let x=0;x<W;x++){ row+=hole[y*W+x]; S[(y+1)*(W+1)+x+1]=S[y*(W+1)+x+1]+row; } } return S; }
  const boxSum=(S,W,x0,y0,x1,y1)=>S[(y1+1)*(W+1)+x1+1]-S[y0*(W+1)+x1+1]-S[(y1+1)*(W+1)+x0]+S[y0*(W+1)+x0];
  function solve(L, prev, iters){
    const {img,hole,W,H}=L, S=integral(hole,W,H), N=W*H;
    const valid=new Uint8Array(N), src=[];
    for(let y=R;y<H-R;y++) for(let x=R;x<W-R;x++) if(!boxSum(S,W,x-R,y-R,x+R,y+R)){ valid[y*W+x]=1; src.push(y*W+x); }
    if(!src.length) return null;
    const T=[], tIdx=new Int32Array(N).fill(-1);
    for(let y=0;y<H;y++) for(let x=0;x<W;x++) if(boxSum(S,W,Math.max(0,x-R),Math.max(0,y-R),Math.min(W-1,x+R),Math.min(H-1,y+R))){ tIdx[y*W+x]=T.length; T.push(y*W+x); }
    const nn=new Int32Array(T.length), D=new Float64Array(T.length);
    const rnd=()=>src[(Math.random()*src.length)|0];
    for(let k=0;k<T.length;k++){ let s=-1; const p=T[k];
      if(prev){ const x=p%W, y=(p/W)|0, cx=x>>1, cy=y>>1; const j=cy<prev.H&&cx<prev.W?prev.tIdx[cy*prev.W+cx]:-1;
        if(j>=0){ const q=prev.nn[j], qx=(q%prev.W)*2+(x&1), qy=((q/prev.W)|0)*2+(y&1); if(qx<W&&qy<H&&valid[qy*W+qx]) s=qy*W+qx; } }
      nn[k]=s>=0?s:rnd(); }
    const dist=(p,q,best)=>{ const px=p%W, py=(p/W)|0, qx=q%W, qy=(q/W)|0; let d=0;
      for(let dy=-R;dy<=R;dy++){ const Y=py+dy; if(Y<0||Y>=H) continue; const qr=(qy+dy)*W;
        for(let dx=-R;dx<=R;dx++){ const X=px+dx; if(X<0||X>=W) continue; const a=(Y*W+X)*3, b=(qr+qx+dx)*3;
          const e0=img[a]-img[b], e1=img[a+1]-img[b+1], e2=img[a+2]-img[b+2]; d+=e0*e0+e1*e1+e2*e2; }
        if(d>best) return d; }
      return d; };
    const acc=new Float64Array(N*3), wsum=new Float64Array(N);
    for(let it=0;it<iters;it++){
      for(let k=0;k<T.length;k++) D[k]=dist(T[k],nn[k],Infinity);
      for(let pass=0;pass<2;pass++){ const dir=pass?-1:1;
        for(let n=0;n<T.length;n++){ const k=pass?T.length-1-n:n, p=T[k], x=p%W, y=(p/W)|0; let best=D[k], bs=nn[k];
          const tryq=q=>{ if(q<0||q>=N||!valid[q]||q===bs) return; const d=dist(p,q,best); if(d<best){ best=d; bs=q; } };
          if(x-dir>=0&&x-dir<W){ const j=tIdx[p-dir]; if(j>=0){ const q=nn[j]+dir, qx=nn[j]%W+dir; if(qx>=0&&qx<W) tryq(q); } }
          if(y-dir>=0&&y-dir<H){ const j=tIdx[p-dir*W]; if(j>=0) tryq(nn[j]+dir*W); }
          const bx=bs%W, by=(bs/W)|0;
          for(let rad=Math.max(W,H);rad>=1;rad>>=1){ const qx=bx+Math.round((Math.random()*2-1)*rad), qy=by+Math.round((Math.random()*2-1)*rad);
            if(qx>=R&&qy>=R&&qx<W-R&&qy<H-R) tryq(qy*W+qx); }
          nn[k]=bs; D[k]=best; } }
      const sorted=Array.from(D).sort((a,b)=>a-b), sig=Math.max(1, sorted[Math.floor(sorted.length*.75)]||1);
      acc.fill(0); wsum.fill(0);
      for(let k=0;k<T.length;k++){ const p=T[k], px=p%W, py=(p/W)|0, q=nn[k], qx=q%W, qy=(q/W)|0, w=Math.exp(-D[k]/(2*sig));
        for(let dy=-R;dy<=R;dy++){ const Y=py+dy; if(Y<0||Y>=H) continue;
          for(let dx=-R;dx<=R;dx++){ const X=px+dx; if(X<0||X>=W) continue; const i=Y*W+X; if(!hole[i]) continue;
            const b=((qy+dy)*W+qx+dx)*3; acc[i*3]+=w*img[b]; acc[i*3+1]+=w*img[b+1]; acc[i*3+2]+=w*img[b+2]; wsum[i]+=w; } } }
      for(let i=0;i<N;i++) if(hole[i]&&wsum[i]>0){ img[i*3]=acc[i*3]/wsum[i]; img[i*3+1]=acc[i*3+1]/wsum[i]; img[i*3+2]=acc[i*3+2]/wsum[i]; }
    }
    return {tIdx, nn, W, H};
  }
  self.onmessage=e=>{ try{
    const {W,H}=e.data, rgba=new Uint8ClampedArray(e.data.data), hole0=new Uint8Array(e.data.hole);
    const hole=new Uint8Array(W*H);                                   // grow the hole by 1px to swallow edges
    for(let y=0;y<H;y++) for(let x=0;x<W;x++){ let h=0; for(let dy=-1;dy<=1&&!h;dy++) for(let dx=-1;dx<=1;dx++){ const X=x+dx,Y=y+dy; if(X>=0&&Y>=0&&X<W&&Y<H&&hole0[Y*W+X]){ h=1; break; } } hole[y*W+x]=h; }
    const img=new Float32Array(W*H*3); for(let i=0;i<W*H;i++){ img[i*3]=rgba[i*4]; img[i*3+1]=rgba[i*4+1]; img[i*3+2]=rgba[i*4+2]; }
    const levels=[{img,hole,W,H}]; while(Math.max(levels[0].W,levels[0].H)>40 && levels.length<7) levels.unshift(down(levels[0]));
    diffuse(levels[0]); let prev=null;
    for(let l=0;l<levels.length;l++){ const L=levels[l];
      if(l>0){ const C=levels[l-1]; for(let y=0;y<L.H;y++) for(let x=0;x<L.W;x++){ const i=y*L.W+x; if(!L.hole[i]) continue;
        const j=Math.min(C.H-1,y>>1)*C.W+Math.min(C.W-1,x>>1); L.img[i*3]=C.img[j*3]; L.img[i*3+1]=C.img[j*3+1]; L.img[i*3+2]=C.img[j*3+2]; } }
      const iters = l===0 ? 6 : (l===levels.length-1 ? 2 : 4);
      prev=solve(L, prev, iters) || null; }
    const out=new Uint8ClampedArray(W*H*4);
    for(let i=0;i<W*H;i++){ out[i*4]=img[i*3]; out[i*4+1]=img[i*3+1]; out[i*4+2]=img[i*3+2]; out[i*4+3]=255; }
    self.postMessage({out:out.buffer},[out.buffer]);
  }catch(err){ self.postMessage({error:String(err&&err.message||err)}); } };
}

/* ---------- blur background ---------- */
// Finds people with Google's MediaPipe selfie model (loaded the first time, about 16 MB, then cached by the browser).
const MP_VER='0.10.14', MP_CDN=`https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}`;
const MP_MODEL='https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite';
let segP=null;
function getSegmenter(){
  if(!segP){ segP=(async()=>{ const v=await import(MP_CDN+'/vision_bundle.mjs');
    const fs=await v.FilesetResolver.forVisionTasks(MP_CDN+'/wasm');
    return v.ImageSegmenter.createFromOptions(fs,{baseOptions:{modelAssetPath:MP_MODEL, delegate:'CPU'}, runningMode:'IMAGE', outputCategoryMask:false, outputConfidenceMasks:true}); })();
    segP.catch(()=>{ segP=null; }); }
  return segP;
}
// A canvas whose alpha is how sure the model is that each spot is a person.
async function personMask(img){
  const seg=await getSegmenter(), input=canvasOf(img, 1024);
  let mc=null, found=0;
  seg.segment(input, res=>{
    const m=res.confidenceMasks[0], w=m.width, h=m.height, bg=m.getAsFloat32Array();
    mc=document.createElement('canvas'); mc.width=w; mc.height=h; const x=mc.getContext('2d'), d=x.createImageData(w,h);
    for(let i=0;i<w*h;i++){ const p=clamp((1-bg[i]-.25)/.5,0,1); d.data[i*4+3]=Math.round(p*255); if(p>.6) found++; }
    x.putImageData(d,0,0);
    res.confidenceMasks.forEach(k=>k.close&&k.close());
  });
  if(!mc) throw new Error('no result');
  mc._found=found/(mc.width*mc.height);
  return mc;
}
// People stay sharp; the rest is blurred. Colors of the people don't bleed into the blur.
function blurComposite(src, mask, amount){
  const W=src.width, H=src.height, radius=(amount/100)*.035*Math.max(W,H);
  const pm=document.createElement('canvas'); pm.width=W; pm.height=H; const px=pm.getContext('2d'); px.imageSmoothingQuality='high'; px.drawImage(mask,0,0,W,H);
  const bgOnly=canvasOf(src); const bx=bgOnly.getContext('2d'); bx.globalCompositeOperation='destination-out'; bx.drawImage(pm,0,0);
  const out=softBlur(src, radius*.8), ox=out.getContext('2d');
  const bgb=softBlur(bgOnly, radius); ox.drawImage(bgb,0,0); ox.drawImage(bgb,0,0);
  const person=canvasOf(src), sx=person.getContext('2d'); sx.globalCompositeOperation='destination-in'; sx.drawImage(pm,0,0);
  ox.drawImage(person,0,0);
  return out;
}
async function ensureMask(){
  if(ed.personMask) return ed.personMask;
  const first=!segP; $('#mgBlurHint').textContent=first?'Getting the people finder ready (first time only)…':'Finding people…';
  busy(true, first?'Getting ready… (first time only)':'Finding people…');
  try{ ed.personMask=await personMask(ed.img); }
  finally{ busy(false); $('#mgBlurHint').textContent='Keeps people sharp and softens everything behind them, like portrait mode.'; }
  if(ed.personMask._found<.003){ toast('I couldn’t find a person in this photo, so the whole picture would blur.', 5000); }
  return ed.personMask;
}
let blurT=0;
async function blurPreview(force){
  if(!ed||ed.tab!=='magic'||ed.mode!=='blur') return;
  if(ed.blurDone && !force){ draw(); return; }                    // just applied: show the result, not a second blur
  ed.blurDone=false;
  try{ const m=await ensureMask(); if(!ed||ed.mode!=='blur') return;
    const small=canvasOf(ed.img, 1200); ed.preview=blurComposite(small, m, +$('#blurAmt').value); draw(); }
  catch(err){ console.error(err); ed.preview=null; draw(); toast('Blur isn’t available right now. Check your internet connection and try again.', 5000); }
}
$('#blurAmt').oninput=e=>{ $('#blurV').textContent=e.target.value; clearTimeout(blurT); blurT=setTimeout(()=>blurPreview(true), 120); };
$('#mgBlurApply').onclick=async()=>{
  if(!ed||ed.working) return; ed.working=true; busy(true,'Blurring…');
  try{ const m=await ensureMask(); await sleep(30); const out=blurComposite(ed.img, m, +$('#blurAmt').value);
    bake(out); ed.blurDone=true; draw(); buildPresets(); toast('Background blurred ✨'); }
  catch(err){ console.error(err); toast('Blur isn’t available right now. Check your internet connection and try again.', 5000); }
  finally{ ed.working=false; busy(false); magicSync(); }
};
