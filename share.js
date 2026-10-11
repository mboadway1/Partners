// Peggy shared albums: an album both people see. Photos live in Cloudflare R2 through Peggy's relay;
// each phone keeps its own copy so they're quick to browse and work offline.
// The relay's "shared" document holds the albums (lists) and which photos are in them (items, id "album:photo").
'use strict';

const SHARED_KNOWN = 'peggy.sharedKnown';     // the album/photo pairs both sides had at the last sync
const shared = { doc:null, busy:false, again:false, timer:0, warned:false, partner:null };
const knownGet = () => { try{ return new Set(JSON.parse(localStorage.getItem(SHARED_KNOWN)||'[]')); }catch(_){ return new Set(); } };
const knownSet = s => { try{ localStorage.setItem(SHARED_KNOWN, JSON.stringify([...s])); }catch(_){} };
const sharedPid = p => p.sid || p.id;          // the photo's name in shared storage

async function sharedBlob(pid){
  const r=await fetch(acct.relay+'/api/photo/'+pid+'/full',{headers:{'X-Peggy-Session':acct.session}});
  if(!r.ok){ let m='Error '+r.status; try{ m=(await r.json()).error||m; }catch(_){} throw new Error(m); }
  return r.blob();
}
async function sharedUpload(p){
  const img=await loadImage(p.blob), b=await toBlob(render(img, p.edits||DEF, 2560),'image/jpeg',.9);
  const r=await fetch(acct.relay+'/api/photo/'+sharedPid(p)+'/full',{method:'PUT', headers:{'X-Peggy-Session':acct.session,'Content-Type':'image/jpeg'}, body:b});
  if(!r.ok){ let m='Error '+r.status; try{ m=(await r.json()).error||m; }catch(_){} throw new Error(m); }
  if(!p.sid){ p.sid=p.id; await dbPut('photos',p); }
}
const sharedOps = ops => ops.length ? peggyApi('data/shared',{method:'POST', body:JSON.stringify({ops})}) : null;

// Called after any change in the app; batches up and syncs a moment later.
function sharedSoon(ms){ clearTimeout(shared.timer); shared.timer=setTimeout(sharedSync, ms==null?1500:ms); }

// Brings both sides together. For each shared album and photo:
//   both have it → fine · only the server → partner added it (or I removed it, if we both had it before)
//   only here → I added it (or partner removed it, if we both had it before)
async function sharedSync(){
  if(!acct.session || typeof photos==='undefined' || !db) return;
  if(shared.busy){ shared.again=true; return; }
  shared.busy=true;
  try{
    let doc=await peggyApi('data/shared');
    const known=knownGet(), lists=(doc.lists||[]), live=new Set(lists.map(l=>l.id));
    let changed=false;
    // Albums
    for(const L of lists){
      let a=albums.find(x=>x.id===L.id);
      if(!a){ a={id:L.id, name:L.name, created:L.createdAt||Date.now(), shared:true, owner:L.createdBy}; albums.push(a); await dbPut('albums',a); changed=true; }
      else if(!a.shared || a.name!==L.name){ a.shared=true; a.name=L.name; a.owner=a.owner||L.createdBy; await dbPut('albums',a); changed=true; }
    }
    for(const a of albums) if(a.shared && !live.has(a.id) && !a.sharing){ a.shared=false; await dbPut('albums',a); changed=true; toast(`“${a.name}” isn’t shared any more. Its photos stay here.`, 5000); }
    // Photos
    const server=new Map((doc.items||[]).filter(i=>live.has(i.list)).map(i=>[i.id,i]));
    const here=new Map();
    for(const p of photos) for(const aid of p.albums) if(live.has(aid)) here.set(aid+':'+sharedPid(p), p);
    const ops=[], gets=[], drop=[], up=[];
    for(const [id,it] of server){ if(here.has(id)) continue; if(known.has(id)) ops.push({op:'delete', id}); else gets.push(it); }
    for(const [id,p] of here){ if(server.has(id)) continue; const aid=id.slice(0,id.indexOf(':')); if(known.has(id)) drop.push([p,aid]); else up.push([p,aid,id]); }
    // Partner removed these
    for(const [p,aid] of drop){ p.albums=p.albums.filter(x=>x!==aid);
      if(p.src==='shared' && !p.albums.length && !p.fav && !edited(p) && !p.postedAt){ await dbDel('photos',p.id); dropURL(p.id); photos=photos.filter(x=>x!==p); }
      else await dbPut('photos',p); changed=true; }
    // Partner added these
    if(gets.length) toast(`Getting ${gets.length} shared photo${gets.length>1?'s':''}…`, 2500);
    for(const it of gets){
      let p=photos.find(x=>sharedPid(x)===it.photo);
      if(!p){ try{ const blob=await sharedBlob(it.photo), img=await loadImage(blob);
          p={id:uid(), sid:it.photo, src:'shared', by:it.createdBy, name:it.name||'photo', created:it.taken||Date.now(), added:Date.now(), blob,
             thumb:await toBlob(render(img, DEF, 480),'image/jpeg',.82), size:blob.size, hash:photoHash(img), edits:null, fav:false, albums:[], postedAt:null};
          photos.push(p); }catch(e){ console.warn('shared get', e); continue; } }
      if(!p.albums.includes(it.list)) p.albums.push(it.list);
      await dbPut('photos',p); changed=true;
    }
    // I added these
    for(const [p,aid,id] of up){
      try{ if(!p.sid || !(doc.items||[]).some(i=>i.photo===sharedPid(p))) await sharedUpload(p);
        ops.push({op:'upsert', item:{id, list:aid, photo:sharedPid(p), name:p.name, taken:p.created}}); }
      catch(e){ if(!shared.warned){ shared.warned=true; toast('Couldn’t share photos: '+e.message, 6000); } }
      if(ops.length>=20){ doc=await sharedOps(ops.splice(0)); }
    }
    if(ops.length) doc=await sharedOps(ops);
    // Shared photos nobody uses any more: tidy them out of storage.
    const used=new Set((doc.items||[]).map(i=>i.photo));
    for(const it of server.values()) if(!used.has(it.photo) && it.createdBy===(acct.me&&acct.me.email)) fetch(acct.relay+'/api/photo/'+it.photo+'/full',{method:'DELETE',headers:{'X-Peggy-Session':acct.session}}).catch(()=>{});
    shared.doc=doc;
    knownSet(new Set((doc.items||[]).map(i=>i.id)));
    if(changed) renderAll(true);
  }catch(e){ if(e.status!==401) console.warn('shared sync', e); }
  finally{ shared.busy=false; if(shared.again){ shared.again=false; sharedSoon(400); } }
}
async function sharedPartner(){
  if(shared.partner) return shared.partner;
  try{ const d=await peggyApi('members'); shared.partner=(d.members||[]).find(m=>m.email!==(acct.me&&acct.me.email))||null; }catch(_){}
  return shared.partner;
}
async function shareAlbum(a){
  if(!acct.session){ toast('Sign in with Google first (Settings → Sign in), then share the album.', 5000); return; }
  a.sharing=true;
  try{ await sharedOps([{kind:'list', op:'upsert', item:{id:a.id, name:a.name}}]); a.shared=true; await dbPut('albums',a);
    const who=(await sharedPartner())||{}; toast(`Sharing “${a.name}” with ${who.name||'your partner'}. Photos are on their way 🦋`, 5000); renderAll(); await sharedSync(); }
  catch(e){ toast('Couldn’t share the album: '+e.message, 6000); }
  finally{ delete a.sharing; }
}
async function unshareAlbum(a){
  const doc=shared.doc||await peggyApi('data/shared');
  const ops=[{kind:'list', op:'delete', id:a.id}, ...(doc.items||[]).filter(i=>i.list===a.id).map(i=>({op:'delete', id:i.id}))];
  await sharedOps(ops); a.shared=false; await dbPut('albums',a);
  // Free up online storage for my photos that no other shared album uses.
  const left=new Set((doc.items||[]).filter(i=>i.list!==a.id).map(i=>i.photo)), me=acct.me&&acct.me.email;
  for(const i of (doc.items||[])) if(i.list===a.id && i.createdBy===me && !left.has(i.photo)) fetch(acct.relay+'/api/photo/'+i.photo+'/full',{method:'DELETE',headers:{'X-Peggy-Session':acct.session}}).catch(()=>{});
  const k=knownGet(); for(const id of [...k]) if(id.startsWith(a.id+':')) k.delete(id); knownSet(k);
  renderAll(); sharedSoon(0);
}
async function renameShared(a){ if(a.shared) await sharedOps([{kind:'list', op:'upsert', item:{id:a.id, name:a.name}}]).catch(()=>{}); }

addEventListener('visibilitychange',()=>{ if(!document.hidden) sharedSoon(300); });
setInterval(()=>{ if(!document.hidden && albums.some(a=>a.shared)) sharedSync(); }, 30000);
