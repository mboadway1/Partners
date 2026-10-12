// Partners costumes: Claude looks through the photos for costumes, notes the pieces (wigs, hats, capes…) in a
// closet you both share, and suggests new costumes made from what you already own.
// Each photo's result is kept on the photo (p.costume); the closet is the relay's shared "closet" document:
// items = pieces {id, name, kind, count}, lists = costumes worn {id, name, count}.
'use strict';

const COSTUME_V = 1;
const KINDS = [['clothing','👗','Clothing'],['hat','🎩','Hats'],['wig','💇','Wigs'],['accessory','💍','Accessories'],['shoes','👢','Shoes'],['prop','🪄','Props'],['makeup','💄','Makeup']];
const kindOf = k => KINDS.find(x=>x[0]===k) || KINDS[3];
const slug = s => String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60);
const costume = { closet:null, scanning:false, stop:false, ideas:[] };
const unscanned = () => photos.filter(p=>!p.costume || p.costume.v!==COSTUME_V);

async function closetLoad(){ try{ costume.closet=await peggyApi('data/closet'); }catch(e){ costume.closet=costume.closet||{items:[],lists:[]}; } return costume.closet; }
async function closetOps(ops){ if(!ops.length) return; costume.closet=await peggyApi('data/closet',{method:'POST', body:JSON.stringify({ops})}); }

async function scanJpeg(p){ const img=await loadImage(p.blob); const b=await toBlob(render(img, p.edits||DEF, 512),'image/jpeg',.72);
  return new Promise(r=>{ const f=new FileReader(); f.onload=()=>r(String(f.result).split(',')[1]); f.readAsDataURL(b); }); }

// Look through every photo not checked yet, a few at a time.
async function scanCostumes(onProgress){
  if(costume.scanning) return; if(!acct.session){ toast('Sign in with Google first (Settings → Sign in).', 5000); return; }
  costume.scanning=true; costume.stop=false;
  const todo=unscanned(), total=todo.length; let done=0, found=0;
  try{
    await closetLoad();
    for(let i=0;i<todo.length && !costume.stop;i+=6){
      const batch=todo.slice(i,i+6);
      const images=await Promise.all(batch.map(async p=>({id:p.id, data:await scanJpeg(p)})));
      const d=await peggyApi('costume-scan',{method:'POST', body:JSON.stringify({images})});
      const byId=new Map((d.results||[]).map(r=>[r.id,r]));
      const ops=[], have=new Map((costume.closet.items||[]).map(x=>[x.id,x])), worn=new Map((costume.closet.lists||[]).map(x=>[x.id,x]));
      for(const p of batch){ const r=byId.get(p.id)||{costume:false,items:[]};
        p.costume={v:COSTUME_V, is:!!r.costume, name:r.costume?String(r.name||'Costume').slice(0,60):'', items:r.costume?(r.items||[]).map(x=>String(x.name||'').slice(0,50)).filter(Boolean):[], at:Date.now()};
        await dbPut('photos',p);
        if(!r.costume) continue; found++;
        for(const it of (r.items||[])){ const id=slug(it.name); if(!id) continue; const cur=have.get(id);
          const item={id, name:cur?cur.name:String(it.name).slice(0,50), kind:cur?cur.kind:(KINDS.some(k=>k[0]===it.kind)?it.kind:'accessory'), count:(cur?cur.count||1:0)+1};
          have.set(id,item); ops.push({op:'upsert', item}); }
        const cid=slug(p.costume.name); if(cid){ const cur=worn.get(cid); const L={id:cid, name:cur?cur.name:p.costume.name, count:(cur?cur.count||1:0)+1}; worn.set(cid,L); ops.push({kind:'list', op:'upsert', item:L}); }
      }
      await closetOps(ops);
      done+=batch.length; onProgress && onProgress(done,total,found);
    }
    renderAll();
    toast(found?`Found ${found} costume photo${found>1?'s':''} 🎭`:'No new costume photos found', 4000);
  }catch(e){ toast('Costume search stopped: '+e.message, 6000); }
  finally{ costume.scanning=false; onProgress && onProgress(done,total,found,true); }
}

function openCostumes(){
  sheet(async (sh,close)=>{
    sh.append(el('h3',{textContent:'🎭 Costumes'}));
    if(!acct.session){ sh.append(el('p',{textContent:'Sign in with Google first (Settings → Sign in). Then Partners can look through your photos for costumes.'}));
      const c=el('button',{className:'ghost',textContent:'Close',style:'width:100%'}); c.onclick=()=>close(); sh.append(c); return; }
    // --- find costumes ---
    const scanBox=el('div',{className:'card'});
    const sTitle=el('div',{className:'cardh'}), sBar=el('div',{className:'progress hidden'},el('div')), sBtn=el('button',{className:'primary'});
    const drawScan=(d,t,f,end)=>{ const n=unscanned().length, all=photos.filter(p=>p.costume&&p.costume.is).length;
      sTitle.replaceChildren(el('b',{textContent:'Find costumes in your photos'}), el('span',{className:'hint',textContent: costume.scanning?`Looking… ${d||0} of ${t||n}`:`${all} costume photo${all===1?'':'s'} so far · ${n} not checked yet`}));
      sBar.classList.toggle('hidden', !costume.scanning); if(t) sBar.firstChild.style.width=(100*(d||0)/t)+'%';
      sBtn.textContent = costume.scanning ? 'Stop' : n ? `🔍 Check ${n} photo${n>1?'s':''}` : '✓ All photos checked';
      sBtn.disabled = !costume.scanning && !n;
      if(end){ drawCloset(); } };
    sBtn.onclick=()=>{ if(costume.scanning){ costume.stop=true; return; } scanCostumes(drawScan); drawScan(0, unscanned().length, 0); };
    const show=el('button',{textContent:'Show costume photos',title:'Show every photo with a costume'}); show.onclick=()=>{ close(); view='costume'; selecting=false; selected.clear(); renderAll(); };
    scanBox.append(sTitle, sBar, sBtn, show,
      el('p',{className:'hint',textContent:'Claude looks at a small copy of each photo once. Checking 1,000 photos costs only a few cents.'}));
    // --- closet ---
    const closetBox=el('div',{className:'card'});
    const drawCloset=()=>{
      const items=((costume.closet&&costume.closet.items)||[]).slice().sort((a,b)=>(b.count||0)-(a.count||0)||a.name.localeCompare(b.name));
      const wrap=el('div');
      for(const [k,e,l] of KINDS){ const its=items.filter(x=>x.kind===k); if(!its.length) continue;
        wrap.append(el('div',{className:'lab2',textContent:`${e} ${l}`}));
        const row=el('div',{className:'chips closet'});
        for(const x of its){ const c=el('button',{title:`Seen in ${x.count||1} photo${(x.count||1)>1?'s':''}. Tap to remove from the closet`}); c.append(x.name, el('span',{className:'n',textContent:x.count||1}));
          c.onclick=async()=>{ if(confirm(`Remove “${x.name}” from the closet?`)){ await closetOps([{op:'delete', id:x.id}]); drawCloset(); } }; row.append(c); }
        wrap.append(row); }
      if(!items.length) wrap.append(el('p',{className:'hint',textContent:'Empty for now. Check your photos above, or add things you own below.'}));
      const add=el('input',{type:'text',placeholder:'Add something you own (e.g. witch hat)',title:'Add a costume piece by hand'});
      const kind=el('select',{title:'What kind of thing it is'}); KINDS.forEach(([k,e,l])=>kind.append(el('option',{value:k,textContent:`${e} ${l}`})));
      const ab=el('button',{textContent:'Add',title:'Add it to the closet'});
      ab.onclick=async()=>{ const n=add.value.trim(); if(!n) return add.focus(); const id=slug(n), cur=((costume.closet&&costume.closet.items)||[]).find(x=>x.id===id);
        await closetOps([{op:'upsert', item:{id, name:cur?cur.name:n, kind:kind.value, count:(cur&&cur.count)||1}}]); drawCloset(); };
      closetBox.replaceChildren(el('div',{className:'cardh'}, el('b',{textContent:'👚 Your costume closet'}), el('span',{className:'hint',textContent:`${items.length} piece${items.length===1?'':'s'}, shared with ${(shared.partner&&shared.partner.name)||'your partner'}`})),
        wrap, el('div',{className:'addrow'}, add, kind, ab));
    };
    // --- ideas ---
    const ideaBox=el('div',{className:'card'});
    const wish=el('input',{type:'text',placeholder:'Looking for… (optional: “couples Halloween”, “easy, under $20”)',title:'Tell Claude what kind of costume you want'});
    const go=el('button',{className:'primary',textContent:'💡 Suggest costumes',title:'Ideas made mostly from what’s in your closet'});
    const out=el('div',{className:'ideas'});
    const drawIdeas=()=>{ const own=new Set(((costume.closet&&costume.closet.items)||[]).map(x=>x.name.toLowerCase()));
      out.replaceChildren(...costume.ideas.map(i=>{ const c=el('div',{className:'idea'});
        c.append(el('h4',{textContent:i.name}), el('div',{className:'meta',textContent:i.for||''}));
        if((i.uses||[]).length){ const u=el('div',{className:'chips uses'}); i.uses.forEach(n=>u.append(el('span',{className:own.has(String(n).toLowerCase())?'have':'',textContent:'✓ '+n}))); c.append(el('div',{className:'lab2',textContent:'From your closet'}),u); }
        if((i.need||[]).length){ const u=el('div',{className:'chips need'}); i.need.forEach(n=>u.append(el('span',{textContent:'+ '+n}))); c.append(el('div',{className:'lab2',textContent:'You’d need'}),u); }
        if(i.how) c.append(el('p',{textContent:i.how}));
        if((i.need||[]).length){ const t=el('button',{textContent:'🛒 Add what’s needed to Tasks',title:'Make a shared task for each thing to get'});
          t.onclick=async()=>{ const ops=i.need.map(n=>({op:'upsert', item:{id:uid(), title:`Get ${n} (for ${i.name} costume)`, done:false, important:false, due:null, time:null, list:null, assignee:'', repeat:'', notes:'From Partners costume ideas', updatedAt:Date.now()}}));
            try{ await peggyApi('data/tasks',{method:'POST', body:JSON.stringify({ops})}); t.textContent='✓ Added to Tasks'; t.disabled=true; }catch(e){ toast('Couldn’t add tasks: '+e.message); } };
          c.append(t); }
        return c; })); };
    go.onclick=async()=>{ go.disabled=true; go.textContent='💡 Thinking…';
      try{ const cl=costume.closet||await closetLoad();
        const d=await peggyApi('costume-ideas',{method:'POST', body:JSON.stringify({closet:(cl.items||[]).map(x=>x.name), past:(cl.lists||[]).map(x=>x.name), wish:wish.value.trim()})});
        costume.ideas=d.ideas||[]; drawIdeas(); if(!costume.ideas.length) out.replaceChildren(el('p',{className:'hint',textContent:'No ideas came back. Try again.'})); }
      catch(e){ out.replaceChildren(el('p',{className:'hint',textContent:'Couldn’t get ideas: '+e.message})); }
      finally{ go.disabled=false; go.textContent='💡 More ideas'; } };
    ideaBox.append(el('div',{className:'cardh'}, el('b',{textContent:'💡 New costume ideas'}), el('span',{className:'hint',textContent:'Made mostly from what you already have'})), wish, go, out);
    const c=el('button',{className:'ghost',textContent:'Close',style:'width:100%;margin-top:6px'}); c.onclick=()=>close();
    sh.append(scanBox, closetBox, ideaBox, c);
    closetBox.append(el('p',{className:'hint',textContent:'Loading the closet…'}));
    drawScan(); await closetLoad(); drawCloset(); drawIdeas();
    if(!shared.partner) sharedPartner().then(()=>drawCloset());
  });
}
