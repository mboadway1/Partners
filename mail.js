// Partners Mail: all your email accounts in one inbox (Gmail, Outlook/Hotmail, Yahoo, iCloud, AOL and other IMAP),
// sorted by Claude into Important, Personal, Updates, Promotions and Social, with junk gathered in a Partners Spam
// folder (it stays where it is in the real account). Each person's mail is private: your partner never sees it.
'use strict';
const MAIL = { accts:[], cfg:{}, msgs:[], meta:{cats:{},rules:{}}, view:'inbox', acct:'all', open:null, syncing:false, errs:{}, at:0, sums:{}, loaded:false, tok:{}, imgs:false, groupOpen:new Set(), q:'' };
const MCATS = [['important','⭐','Important'],['personal','💬','Personal'],['updates','🔔','Updates'],['promotions','🏷️','Promotions'],['social','👥','Social']];
const MS_SCOPE_APP = 'offline_access openid email User.Read Mail.ReadWrite';

/* ---------- small helpers ---------- */
const mKey = () => 'partners.mail.' + (me().email || '');
function mSave(){ try{ localStorage.setItem(mKey(), JSON.stringify({ msgs:MAIL.msgs.slice(0,1500), at:MAIL.at })); }catch(_){ try{ localStorage.setItem(mKey(), JSON.stringify({ msgs:MAIL.msgs.slice(0,500), at:MAIL.at })); }catch(__){} } }
function mLoad(){ try{ const c=JSON.parse(localStorage.getItem(mKey())||'null'); if(c){ MAIL.msgs=c.msgs||[]; MAIL.at=c.at||0; } }catch(_){} }
const mAcct = id => MAIL.accts.find(a=>a.id===id) || {address:'?',color:'#999',kind:''};
const mDomain = addr => String(addr||'').split('@')[1]||'';
function mCat(m){
  const r=MAIL.meta.rules||{}, a=String(m.from.addr||'').toLowerCase();
  const rule=r['from:'+a]||r['dom:'+mDomain(a)];
  const ai=(MAIL.meta.cats||{})[m.id];
  if(rule==='notspam') return ai && ai!=='spam' ? ai : 'personal';
  return rule || ai || 'new';
}
function mWhen(t){ const d=new Date(t), n=new Date(); if(d.toDateString()===n.toDateString()) return d.toLocaleTimeString(undefined,{hour:'numeric',minute:'2-digit'});
  const y=new Date(n); y.setDate(n.getDate()-1); if(d.toDateString()===y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, d.getFullYear()===n.getFullYear()?{month:'short',day:'numeric'}:{month:'short',day:'numeric',year:'numeric'}); }
const mEsc = s => String(s).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function mParseAddr(s){ s=String(s||'').trim(); const m=s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>/); if(m) return {name:m[1].trim()||m[2], addr:m[2].trim().toLowerCase()};
  return {name:s.replace(/@.*/,''), addr:s.toLowerCase()}; }

/* ---------- reading raw email (for IMAP accounts) ---------- */
const binStr = u8 => { let s=''; for(let i=0;i<u8.length;i+=0x8000) s+=String.fromCharCode.apply(null,u8.subarray(i,i+0x8000)); return s; };
const strBin = s => { const u=new Uint8Array(s.length); for(let i=0;i<s.length;i++) u[i]=s.charCodeAt(i)&255; return u; };
function mDecodeText(u8, cs){ try{ return new TextDecoder((cs||'utf-8').toLowerCase().replace(/^(us-ascii|ascii)$/,'utf-8')).decode(u8); }catch(_){ return new TextDecoder().decode(u8); } }
function mQP(s){ return strBin(s.replace(/=\r?\n/g,'').replace(/=([0-9A-Fa-f]{2})/g,(_,h)=>String.fromCharCode(parseInt(h,16)))); }
function mWords(s){ // =?charset?B|Q?text?= in headers
  return String(s||'').replace(/(=\?[^?]+\?[BbQq]\?[^?]*\?=)\s+(?==\?)/g,'$1').replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g,(_,cs,e,t)=>{
    try{ const b= e.toUpperCase()==='B' ? strBin(atob(t)) : mQP(t.replace(/_/g,' ')); return mDecodeText(b,cs); }catch(_){ return t; } }); }
function mHeaders(text){ const h={}; text.replace(/\r?\n[ \t]+/g,' ').split(/\r?\n/).forEach(l=>{ const i=l.indexOf(':'); if(i>0){ const k=l.slice(0,i).trim().toLowerCase(); if(!(k in h)) h[k]=mWords(l.slice(i+1).trim()); } }); return h; }
function mParam(v,name){ const m=String(v||'').match(new RegExp(name+'\\*?=\\s*(?:"([^"]*)"|([^;\\s]+))','i')); return m?(m[1]||m[2]):''; }
function mMime(bin){ // bin: "binary string" of one MIME entity → {h, parts:[{type,text,name}]}
  const i=bin.search(/\r?\n\r?\n/), head=i<0?bin:bin.slice(0,i), body=i<0?'':bin.slice(i).replace(/^\r?\n\r?\n/,'');
  const h=mHeaders(head), ct=h['content-type']||'text/plain', type=ct.split(';')[0].trim().toLowerCase(), out=[];
  if(type.startsWith('multipart/')){ const bd=mParam(ct,'boundary'); if(bd){ const segs=body.split(new RegExp('\\r?\\n?--'+bd.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?:--)?[ \\t]*\\r?\\n?'));
      segs.slice(1).forEach(seg=>{ if(seg.trim()) out.push(...mMime(seg).parts); }); } return {h,parts:out}; }
  const te=(h['content-transfer-encoding']||'').toLowerCase(); let u8;
  if(te==='base64'){ try{ u8=strBin(atob(body.replace(/[^A-Za-z0-9+/=]/g,''))); }catch(_){ u8=strBin(body); } } else if(te==='quoted-printable') u8=mQP(body); else u8=strBin(body);
  const name=mParam(h['content-disposition'],'filename')||mParam(ct,'name'), att=/attachment/i.test(h['content-disposition']||'')||(!!name&&!type.startsWith('text/'));
  out.push({type, text: att||!type.startsWith('text/') ? '' : mDecodeText(u8, mParam(ct,'charset')), name: att?mWords(name)||'attachment':'' , att});
  return {h,parts:out};
}

/* ---------- talking to each kind of account ---------- */
async function mToken(a){ const c=MAIL.tok[a.id]; if(c && c.exp>Date.now()+30000) return c.v;
  const d=await partnersApi('mail/token/'+a.id); MAIL.tok[a.id]={v:d.access_token, exp:Date.now()+d.expires_in*1000}; return d.access_token; }
async function mApi(a, url, opts={}){
  const t=await mToken(a); const r=await fetch(url,{...opts,headers:{Authorization:'Bearer '+t,...(opts.body?{'Content-Type':'application/json'}:{}),...(opts.headers||{})}});
  if(r.status===204) return {}; const d=await r.json().catch(()=>({}));
  if(r.status===401) delete MAIL.tok[a.id];
  if(!r.ok){ const e=new Error((d.error&&(d.error.message||d.error))||('Error '+r.status)); e.status=r.status; throw e; } return d; }
async function pool(list, n, fn){ const out=[]; let i=0; await Promise.all(Array.from({length:Math.min(n,list.length)},async()=>{ while(i<list.length){ const k=i++; try{ out[k]=await fn(list[k]); }catch(e){ out[k]=null; } } })); return out; }
const GM='https://gmail.googleapis.com/gmail/v1/users/me', GR='https://graph.microsoft.com/v1.0/me';

async function mListGmail(a, known){
  let ids=[], pt='';
  do{ const q=new URLSearchParams({q:'in:inbox newer_than:30d',maxResults:'100'}); if(pt) q.set('pageToken',pt);
    const d=await mApi(a,`${GM}/messages?${q}`); ids.push(...(d.messages||[]).map(x=>x.id)); pt=d.nextPageToken||''; }while(pt && ids.length<300);
  const fresh=ids.filter(id=>!known.has(a.id+':'+id));
  const got=await pool(fresh,8,id=>mApi(a,`${GM}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=List-Unsubscribe`));
  const add=got.filter(Boolean).map(d=>{ const h={}; (d.payload&&d.payload.headers||[]).forEach(x=>h[x.name.toLowerCase()]=x.value);
    const L=d.labelIds||[], hint=L.includes('CATEGORY_PROMOTIONS')?'promotions':L.includes('CATEGORY_SOCIAL')?'social':L.includes('CATEGORY_UPDATES')?'updates':L.includes('IMPORTANT')?'important':'';
    return { id:a.id+':'+d.id, acct:a.id, mid:d.id, from:mParseAddr(h.from), to:h.to||'', subject:h.subject||'(no subject)', snippet:mDecodeEntities(d.snippet||''), date:+d.internalDate, unread:L.includes('UNREAD'), unsub:h['list-unsubscribe']||'', hint }; });
  return { ids:new Set(ids.map(id=>a.id+':'+id)), add };
}
async function mListMs(a, known){
  const since=new Date(Date.now()-30*864e5).toISOString(); let url=`${GR}/mailFolders/inbox/messages?$top=100&$select=id,subject,from,toRecipients,receivedDateTime,isRead,bodyPreview,inferenceClassification&$filter=receivedDateTime ge ${since}&$orderby=receivedDateTime desc`;
  const all=[]; while(url && all.length<300){ const d=await mApi(a,url); all.push(...(d.value||[])); url=d['@odata.nextLink']; }
  const add=all.filter(m=>!known.has(a.id+':'+m.id)).map(m=>({ id:a.id+':'+m.id, acct:a.id, mid:m.id, from:{name:(m.from&&m.from.emailAddress&&m.from.emailAddress.name)||'',addr:String((m.from&&m.from.emailAddress&&m.from.emailAddress.address)||'').toLowerCase()},
    to:(m.toRecipients||[]).map(x=>x.emailAddress&&x.emailAddress.address).join(', '), subject:m.subject||'(no subject)', snippet:m.bodyPreview||'', date:Date.parse(m.receivedDateTime), unread:!m.isRead, unsub:'', hint:m.inferenceClassification==='other'?'other (not focused)':'' }));
  // Read/unread changes made elsewhere
  const st={}; all.forEach(m=>st[a.id+':'+m.id]=!m.isRead);
  return { ids:new Set(all.map(m=>a.id+':'+m.id)), add, unread:st };
}
async function mListImap(a, known){
  const d=await partnersApi(`mail/imap/${a.id}/list`,{method:'POST',body:JSON.stringify({days:30,max:250})});
  const st={}, ids=new Set(), add=[];
  for(const m of d.messages||[]){ const id=a.id+':'+m.uid; ids.add(id); st[id]=!/\\Seen/i.test(m.flags); if(known.has(id)) continue;
    const h=mHeaders(m.head||''); add.push({ id, acct:a.id, mid:String(m.uid), from:mParseAddr(h.from), to:h.to||'', subject:h.subject||'(no subject)', snippet:'', date:Date.parse(h.date)||Date.parse(m.date)||Date.now(), unread:st[id], unsub:h['list-unsubscribe']||'', hint:'' }); }
  return { ids, add, unread:st };
}
function mDecodeEntities(s){ const t=document.createElement('textarea'); t.innerHTML=s; return t.value; }

async function mSync(manual){
  if(MAIL.syncing || !acct.session) return; MAIL.syncing=true; if(tab==='mail') renderMailBar();
  try{
    const d=await partnersApi('mail/accounts'); MAIL.accts=d.accounts||[]; MAIL.cfg=d;
    try{ MAIL.meta=await partnersApi('mail/meta'); }catch(_){}
    const known=new Set(MAIL.msgs.map(m=>m.id)); MAIL.errs={};
    await Promise.all(MAIL.accts.map(async a=>{
      try{ const r = a.kind==='gmail' ? await mListGmail(a,known) : a.kind==='ms' ? await mListMs(a,known) : await mListImap(a,known);
        // keep what's still in that inbox, add the new ones
        MAIL.msgs = MAIL.msgs.filter(m=>m.acct!==a.id || r.ids.has(m.id)).concat(r.add);
        if(r.unread) MAIL.msgs.forEach(m=>{ if(m.acct===a.id && m.id in r.unread) m.unread=r.unread[m.id]; });
      }catch(e){ MAIL.errs[a.id]=e.message||String(e); }
    }));
    MAIL.msgs = MAIL.msgs.filter(m=>MAIL.accts.some(a=>a.id===m.acct)).sort((x,y)=>y.date-x.date);
    MAIL.at=Date.now(); mSave(); if(tab==='mail') render();
    await mClassify();
  }catch(e){ if(manual) toast(e.message,5000); }
  finally{ MAIL.syncing=false; if(tab==='mail') render(); }
}
// Claude sorts mail it hasn't seen yet (only sender, subject and the first lines are sent).
async function mClassify(){
  if(!MAIL.cfg.ai) return;
  const todo=MAIL.msgs.filter(m=>mCat(m)==='new').slice(0,160);
  for(let i=0;i<todo.length;i+=40){
    const batch=todo.slice(i,i+40);
    try{ const r=await partnersApi('mail/ai',{method:'POST',body:JSON.stringify({mode:'classify',items:batch.map(m=>({id:m.id,from:`${m.from.name} <${m.from.addr}>`,subject:m.subject,snippet:m.snippet,hint:m.hint,unsub:!!m.unsub}))})});
      if(r.cats && Object.keys(r.cats).length){ MAIL.meta=await partnersApi('mail/meta',{method:'POST',body:JSON.stringify({cats:r.cats})}); if(tab==='mail') render(); } }
    catch(e){ if(e.status===429) break; }
  }
}
async function mSetCat(m, cat, always){
  const cats={[m.id]:cat}, rules={}; if(always) rules['from:'+m.from.addr]= cat==='spam'?'spam':(cat==='notspam'?'notspam':cat);
  if(cat==='notspam'){ cats[m.id]=(MAIL.meta.cats[m.id]&&MAIL.meta.cats[m.id]!=='spam')?MAIL.meta.cats[m.id]:'personal'; }
  Object.assign(MAIL.meta.cats,cats); Object.assign(MAIL.meta.rules,rules); render();
  try{ MAIL.meta=await partnersApi('mail/meta',{method:'POST',body:JSON.stringify({cats,rules})}); }catch(e){ toast(e.message); }
}

/* ---------- actions on the real accounts ---------- */
async function mAct(list, action){ // action: archive | trash | read | unread
  const by={}; list.forEach(m=>(by[m.acct]=by[m.acct]||[]).push(m));
  for(const [aid,ms] of Object.entries(by)){ const a=mAcct(aid);
    try{
      if(a.kind==='gmail'){ const ids=ms.map(m=>m.mid);
        if(action==='trash') await pool(ids,6,id=>mApi(a,`${GM}/messages/${id}/trash`,{method:'POST'}));
        else await mApi(a,`${GM}/messages/batchModify`,{method:'POST',body:JSON.stringify({ids, ...(action==='archive'?{removeLabelIds:['INBOX']}:action==='read'?{removeLabelIds:['UNREAD']}:{addLabelIds:['UNREAD']})})}); }
      else if(a.kind==='ms') await pool(ms,6,m=> action==='read'||action==='unread' ? mApi(a,`${GR}/messages/${m.mid}`,{method:'PATCH',body:JSON.stringify({isRead:action==='read'})})
        : mApi(a,`${GR}/messages/${m.mid}/move`,{method:'POST',body:JSON.stringify({destinationId:action==='trash'?'deleteditems':'archive'})}));
      else await partnersApi(`mail/imap/${a.id}/act`,{method:'POST',body:JSON.stringify({uids:ms.map(m=>m.mid),action:action==='trash'?'delete':action})});
    }catch(e){ toast(`${a.address}: ${e.message}`,5000); return false; }
  }
  if(action==='archive'||action==='trash'){ const gone=new Set(list.map(m=>m.id)); MAIL.msgs=MAIL.msgs.filter(m=>!gone.has(m.id)); if(MAIL.open&&gone.has(MAIL.open.id)) MAIL.open=null; }
  else list.forEach(m=>m.unread=action==='unread');
  mSave(); render(); return true;
}
async function mBody(m){
  const a=mAcct(m.acct);
  if(a.kind==='gmail'){ const d=await mApi(a,`${GM}/messages/${m.mid}?format=full`); const parts=[];
    const walk=p=>{ if(!p) return; if(p.parts) p.parts.forEach(walk); else { const dec=s=>{ try{ return mDecodeText(strBin(atob(s.replace(/-/g,'+').replace(/_/g,'/'))),'utf-8'); }catch(_){ return ''; } };
      parts.push({type:(p.mimeType||'').toLowerCase(), text:p.body&&p.body.data?dec(p.body.data):'', name:p.filename||'', att:!!p.filename}); } };
    walk(d.payload); const h={}; (d.payload.headers||[]).forEach(x=>h[x.name.toLowerCase()]=x.value); return {parts, to:h.to||'', cc:h.cc||''}; }
  if(a.kind==='ms'){ const d=await mApi(a,`${GR}/messages/${m.mid}?$select=body,toRecipients,ccRecipients,hasAttachments`,{headers:{Prefer:'outlook.body-content-type="html"'}});
    return {parts:[{type:d.body&&d.body.contentType==='html'?'text/html':'text/plain', text:(d.body&&d.body.content)||''}], to:(d.toRecipients||[]).map(x=>x.emailAddress.address).join(', '), cc:(d.ccRecipients||[]).map(x=>x.emailAddress.address).join(', '), atts:d.hasAttachments}; }
  const d=await partnersApi(`mail/imap/${a.id}/get`,{method:'POST',body:JSON.stringify({uid:m.mid})});
  const r=mMime(atob(d.raw)); return {parts:r.parts, to:r.h.to||'', cc:r.h.cc||''};
}
function mHtmlDoc(b, imgs){
  const html=b.parts.find(p=>p.type==='text/html'&&p.text), txt=b.parts.find(p=>p.type==='text/plain'&&p.text);
  const csp=`default-src 'none'; style-src 'unsafe-inline'${imgs?' https: http:':''}; img-src data:${imgs?' https: http:':''}; font-src data:${imgs?' https:':''}`;
  const head=`<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank"><style>body{font:15px/1.5 -apple-system,system-ui,sans-serif;margin:0;padding:4px;color:#222;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%!important}pre{white-space:pre-wrap}</style>`;
  if(html) return `<!doctype html><html><head>${head}</head><body>${html.text.replace(/<script[\s\S]*?<\/script>/gi,'')}</body></html>`;
  const t=txt?txt.text:'(This email has no text.)';
  return `<!doctype html><html><head>${head}</head><body><pre style="font:inherit">${mEsc(t).replace(/(https?:\/\/[^\s<]+)/g,'<a href="$1">$1</a>')}</pre></body></html>`;
}
function mPlain(b){ const t=b.parts.find(p=>p.type==='text/plain'&&p.text); if(t) return t.text; const h=b.parts.find(p=>p.type==='text/html'&&p.text);
  if(!h) return ''; const d=new DOMParser().parseFromString(h.text,'text/html'); d.querySelectorAll('style,script').forEach(x=>x.remove()); return (d.body&&d.body.textContent||'').replace(/\s+/g,' '); }
function mUnsubLink(s){ const m=String(s||'').match(/<(https?:[^>]+)>/); return m?m[1]:''; }

/* ---------- connecting accounts ---------- */
function mStartOAuth(kind){
  const st=Math.random().toString(36).slice(2)+Date.now().toString(36);
  localStorage.setItem('partners.authState',st); localStorage.setItem('partners.mailAuth',kind); localStorage.setItem('partners.authReturn','plan.html#mail');
  if(kind==='google') location.href='https://accounts.google.com/o/oauth2/v2/auth?'+new URLSearchParams({client_id:MAIL.cfg.googleClientId||acct.clientId, redirect_uri:partnersRedirect(), response_type:'code',
    scope:'openid email https://www.googleapis.com/auth/gmail.modify', access_type:'offline', prompt:'consent select_account', state:st});
  else location.href='https://login.microsoftonline.com/common/oauth2/v2.0/authorize?'+new URLSearchParams({client_id:MAIL.cfg.msClientId, redirect_uri:partnersRedirect(), response_type:'code', response_mode:'query', scope:MS_SCOPE_APP, prompt:'select_account', state:st});
}
const IMAP_PRESETS={ yahoo:['Yahoo','imap.mail.yahoo.com','https://login.yahoo.com/account/security','Yahoo → Account security → Generate app password'],
  icloud:['iCloud','imap.mail.me.com','https://account.apple.com/account/manage','Apple Account → Sign-In and Security → App-Specific Passwords'],
  aol:['AOL','imap.aol.com','https://login.aol.com/account/security','AOL → Account security → Generate app password'],
  other:['Email','','','Your email provider’s help pages: look for “IMAP” and “app password”'] };
async function mAddImap(kind){
  const P=IMAP_PRESETS[kind];
  await sheet((sh,close)=>{
    sh.append(el('h3',{textContent:`Add ${P[0]==='Email'?'another email account':P[0]+' Mail'}`}));
    sh.append(el('p',{textContent:`${P[0]==='Email'?'Most providers':P[0]} need an “app password” for other apps: a special password you make once, not your normal one.`}));
    if(P[2]){ const a=el('a',{href:P[2],target:'_blank',rel:'noopener',textContent:'Make an app password ↗'}); sh.append(el('p',{},a,el('br'),el('small',{textContent:P[3]}))); }
    const addr=el('input',{type:'email',placeholder:'you@'+(kind==='yahoo'?'yahoo.com':kind==='icloud'?'icloud.com':kind==='aol'?'aol.com':'example.com'),autocomplete:'off',autofocus:true});
    const pw=el('input',{type:'password',placeholder:'App password',autocomplete:'new-password'});
    const host=el('input',{placeholder:'Mail server, e.g. imap.example.com',value:P[1]}), port=el('input',{type:'number',value:'993'});
    sh.append(...field('Email address',addr),...field('App password',pw));
    if(kind==='other') sh.append(...field('Incoming mail server (IMAP)',host),...field('Port',port));
    const msg=el('p',{className:'mErr'}); sh.append(msg);
    const go=el('button',{className:'primary',textContent:'Connect'}), c=el('button',{className:'ghost',textContent:'Cancel'}); c.onclick=()=>close();
    go.onclick=async()=>{ msg.textContent=''; go.disabled=true; go.textContent='Checking…';
      try{ await partnersApi('mail/connect/imap',{method:'POST',body:JSON.stringify({address:addr.value.trim(),user:addr.value.trim(),pass:pw.value,host:host.value.trim(),port:+port.value||993,provider:P[0]})});
        close(); toast('Connected. Getting your mail…'); mSync(); }
      catch(e){ msg.textContent=e.message; go.disabled=false; go.textContent='Connect'; } };
    sh.append(el('div',{className:'btns'},c,go));
  });
}
async function mAccounts(){
  try{ const d=await partnersApi('mail/accounts'); MAIL.accts=d.accounts||[]; MAIL.cfg=d; }catch(e){ return toast(e.message,5000); }
  await sheet((sh,close)=>{
    sh.append(el('h3',{textContent:'Email accounts'}),el('p',{textContent:'Only you see your email. Your partner can’t.'}));
    MAIL.accts.forEach(a=>{ const rm=el('button',{className:'ghost danger',textContent:'Remove'}); rm.onclick=async()=>{ if(!confirm(`Remove ${a.address} from Partners? Nothing is deleted in the account itself.`)) return;
        await partnersApi('mail/accounts/'+a.id,{method:'DELETE'}); MAIL.msgs=MAIL.msgs.filter(m=>m.acct!==a.id); mSave(); close(); mAccounts(); render(); };
      sh.append(el('div',{className:'mAcRow'},el('span',{className:'dot',style:`background:${a.color}`}),el('span',{className:'mAcA'},el('b',{textContent:a.address}),el('small',{textContent:a.provider||a.kind})),...(MAIL.errs[a.id]?[el('small',{className:'mErr',textContent:'⚠ '+MAIL.errs[a.id]})]:[]),rm)); });
    sh.append(el('label',{className:'f',textContent:'Add an account'}));
    const b=(t,fn,sub)=>{ const x=el('button',{className:'mAdd'},el('span',{textContent:t}),...(sub?[el('small',{textContent:sub})]:[])); x.onclick=()=>{ close(); fn(); }; sh.append(x); };
    b('Gmail',()=>mStartOAuth('google'),'Any Google account. Add several, one at a time.');
    if(MAIL.cfg.msClientId) b('Outlook, Hotmail, Live, Microsoft 365',()=>mStartOAuth('microsoft'));
    else b('Outlook, Hotmail, Live, Microsoft 365',()=>toast('Outlook needs a one-time setup first (see your Partners checklist).',6000),'Needs one-time setup (in your checklist)');
    b('Yahoo Mail',()=>mAddImap('yahoo')); b('iCloud Mail',()=>mAddImap('icloud')); b('AOL Mail',()=>mAddImap('aol')); b('Other (IMAP)',()=>mAddImap('other'));
    const c=el('button',{className:'ghost',textContent:'Close',style:'width:100%;margin-top:10px'}); c.onclick=()=>close(); sh.append(c);
  });
}

/* ---------- the screen ---------- */
function mVisible(){ return MAIL.msgs.filter(m=>MAIL.acct==='all'||m.acct===MAIL.acct).filter(m=>!MAIL.q||(m.subject+' '+m.from.name+' '+m.from.addr+' '+m.snippet).toLowerCase().includes(MAIL.q)); }
function mCounts(){ const c={}; mVisible().forEach(m=>{ const k=mCat(m); c[k]=(c[k]||0)+1; if(m.unread) c[k+'_u']=(c[k+'_u']||0)+1; }); return c; }
function renderMailBar(){ const b=document.querySelector('.mStatus'); if(b) b.textContent=mStatusText(); }
function mStatusText(){ if(MAIL.syncing) return '⏳ Getting new mail…'; if(!MAIL.at) return ''; const n=Math.round((Date.now()-MAIL.at)/60000); return n<1?'✓ Up to date':`✓ Checked ${n} min ago`; }

function renderMail(v){
  if(!MAIL.loaded){ MAIL.loaded=true; mLoad(); mSync(); }
  const wide=document.documentElement.classList.contains('wide');
  const chips=$('#chips'); chips.replaceChildren();
  const counts=mCounts(), views=[['inbox','📥','Inbox'],...MCATS,['spam','🚫','Spam'],['all','🗂️','All mail']];
  const nIn=(counts.important||0)+(counts.personal||0)+(counts.new||0);
  const cnt=k=>k==='inbox'?nIn:k==='all'?mVisible().length:(counts[k]||0);
  const nav=views.map(([k,e,l])=>{ const b=el('button',{className:(wide?'gt-nav':'chip')+(MAIL.view===k?' on':''),innerHTML:wide?`<span class="ic">${e}</span>`:''}); b.append(wide?l:`${e} ${l}`); const n=cnt(k); if(n) b.append(el('small',{className:'mN',textContent:n}));
    b.onclick=()=>{ MAIL.view=k; MAIL.open=null; render(); }; return b; });
  if(!MAIL.accts.length && !MAIL.syncing && MAIL.at){ v.replaceChildren(el('div',{className:'empty'},el('h3',{textContent:'📬 All your email in one place'}),
      el('p',{textContent:'Add your Gmail, Outlook, Yahoo, iCloud or other accounts. Partners puts them in one inbox, sorts them, sums them up and moves junk to a Spam folder here. Only you can see it.'}),
      Object.assign(el('button',{className:'primary',textContent:'＋ Add an email account'}),{onclick:mAccounts}))); return; }
  // top bar: accounts, search, status
  const sel=el('select',{className:'mSel',title:'Which account'}); sel.append(el('option',{value:'all',textContent:'All accounts'})); MAIL.accts.forEach(a=>sel.append(el('option',{value:a.id,textContent:a.address})));
  sel.value=MAIL.acct; sel.onchange=()=>{ MAIL.acct=sel.value; render(); };
  const q=el('input',{type:'search',className:'mQ',placeholder:'Search mail',value:MAIL.q}); q.oninput=()=>{ MAIL.q=q.value.trim().toLowerCase(); clearTimeout(q._t); q._t=setTimeout(()=>{ render(); const n=document.querySelector('.mQ'); if(n){ n.focus(); n.setSelectionRange(n.value.length,n.value.length); } },250); };
  const ref=el('button',{className:'iconbtn',textContent:'⟳',title:'Check for new mail'}); ref.onclick=()=>mSync(true);
  const acc=el('button',{className:'iconbtn',textContent:'⚙',title:'Email accounts'}); acc.onclick=mAccounts;
  const top=el('div',{className:'mTop'},sel,q,ref,acc);
  const errs=Object.entries(MAIL.errs).map(([id,e])=>el('div',{className:'mWarn',textContent:`⚠ ${mAcct(id).address}: ${e}`},...(/connect.*again|reconnect|invalid_grant/i.test(e)?[Object.assign(el('button',{textContent:'Reconnect'}),{onclick:()=>mStartOAuth(mAcct(id).kind==='ms'?'microsoft':'google')})]:[])));
  const list=mListView();
  const status=el('div',{className:'mStatus',textContent:mStatusText()});
  if(wide){ const side=el('aside',{className:'gt-side mSide'},Object.assign(el('button',{className:'gt-create',innerHTML:'<span>＋</span> Add account'}),{onclick:mAccounts}),...nav,status);
    const main=el('div',{className:'mMain'},top,...errs,list);
    const cols=[side,main]; if(MAIL.open) cols.push(mReader(MAIL.open,true));
    v.replaceChildren(el('div',{className:'mWrap'+(MAIL.open?' reading':'')},...cols)); }
  else { nav.forEach(b=>chips.append(b)); v.replaceChildren(el('div',{className:'mPhone'},top,status,...errs,list)); }
}
function mRow(m){
  const a=mAcct(m.acct), r=el('div',{className:'mRow'+(m.unread?' unread':'')+(MAIL.open&&MAIL.open.id===m.id?' on':'')});
  r.append(el('span',{className:'mDot',style:`background:${a.color}`,title:a.address}),
    el('div',{className:'mMid'},el('div',{className:'mL1'},el('span',{className:'mFrom',textContent:m.from.name||m.from.addr}),el('span',{className:'mTime',textContent:mWhen(m.date)})),
      el('div',{className:'mSub',textContent:m.subject}),...(m.snippet?[el('div',{className:'mSnip',textContent:m.snippet})]:[])));
  const acts=el('div',{className:'mActs'});
  const ab=(t,ti,fn)=>{ const b=el('button',{textContent:t,title:ti}); b.onclick=e=>{ e.stopPropagation(); fn(); }; acts.append(b); };
  ab('🗄','Archive',()=>mAct([m],'archive')); ab('🗑','Delete',()=>mAct([m],'trash'));
  if(mCat(m)==='spam') ab('✓','Not spam',()=>mSetCat(m,'notspam',true)); else ab('🚫','Spam',()=>mSetCat(m,'spam',true));
  r.append(acts); r.onclick=()=>mOpen(m); return r;
}
function mGroupRows(ms, label){ // sender bundles
  const g=new Map(); ms.forEach(m=>{ const k=m.from.addr||m.from.name; if(!g.has(k)) g.set(k,[]); g.get(k).push(m); });
  const box=el('div',{className:'mGroups'});
  [...g.entries()].sort((x,y)=>y[1][0].date-x[1][0].date).forEach(([k,list])=>{
    if(list.length===1){ box.append(mRow(list[0])); return; }
    const open=MAIL.groupOpen.has(label+'|'+k), u=list.filter(m=>m.unread).length;
    const h=el('div',{className:'mRow mGroup'+(u?' unread':'')},el('span',{className:'mCar',textContent:open?'▾':'▸'}),
      el('div',{className:'mMid'},el('div',{className:'mL1'},el('span',{className:'mFrom',textContent:`${list[0].from.name||k}`}),el('span',{className:'mTime',textContent:`${list.length} emails`})),el('div',{className:'mSub',textContent:list.slice(0,3).map(m=>m.subject).join(' · ')})));
    const acts=el('div',{className:'mActs'}); const ab=(t,ti,fn)=>{ const b=el('button',{textContent:t,title:ti}); b.onclick=e=>{ e.stopPropagation(); fn(); }; acts.append(b); };
    ab('🗄','Archive all '+list.length,()=>mAct(list,'archive')); ab('🗑','Delete all '+list.length,()=>{ if(confirm(`Delete all ${list.length} emails from ${list[0].from.name||k}?`)) mAct(list,'trash'); });
    h.append(acts); h.onclick=()=>{ open?MAIL.groupOpen.delete(label+'|'+k):MAIL.groupOpen.add(label+'|'+k); render(); }; box.append(h);
    if(open) list.forEach(m=>{ const r=mRow(m); r.classList.add('mIn'); box.append(r); }); });
  return box;
}
function mSumCard(key, title, ms){
  const card=el('div',{className:'mSum'}), s=MAIL.sums[key];
  if(s && s.text) card.append(el('div',{className:'mSumT',textContent:s.text}));
  const b=el('button',{className:'mSumB',textContent:s&&s.busy?'✨ Summing up…':s&&s.text?'✨ Summarize again':`✨ Summarize ${title}`}); b.disabled=!!(s&&s.busy)||!ms.length;
  b.onclick=async()=>{ MAIL.sums[key]={busy:true}; render();
    try{ const r=await partnersApi('mail/ai',{method:'POST',body:JSON.stringify({mode:'summary',title,items:ms.slice(0,60).map(m=>({id:m.id,from:`${m.from.name} <${m.from.addr}>`,subject:m.subject,snippet:m.snippet}))})}); MAIL.sums[key]={text:r.text}; }
    catch(e){ MAIL.sums[key]={}; toast(e.message,5000); } render(); };
  card.prepend(b); return card;
}
function mListView(){
  const vis=mVisible(), box=el('div',{className:'mList'}), by=k=>vis.filter(m=>mCat(m)===k);
  const empty=t=>el('div',{className:'empty'},el('p',{textContent:t}));
  const V=MAIL.view;
  if(V==='inbox'){
    const top=vis.filter(m=>['important','personal','new'].includes(mCat(m)));
    box.append(mSumCard('inbox','your inbox',top.filter(m=>m.unread).length?top.filter(m=>m.unread):top));
    if(!top.length) box.append(empty(MAIL.syncing?'Getting your mail…':'Nothing important or personal right now.'));
    top.forEach(m=>{ const r=mRow(m); if(mCat(m)==='important') r.classList.add('imp'); box.append(r); });
    // bundles, like Inbox by Gmail
    MCATS.slice(2).forEach(([k,e,l])=>{ const ms=by(k); if(!ms.length) return; const u=ms.filter(m=>m.unread).length;
      const b=el('div',{className:'mRow mBundle'+(u?' unread':'')},el('span',{className:'mBIc',textContent:e}),el('div',{className:'mMid'},el('div',{className:'mL1'},el('span',{className:'mFrom',textContent:l}),el('span',{className:'mTime',textContent:`${ms.length}${u?` · ${u} new`:''}`})),
        el('div',{className:'mSub',textContent:[...new Set(ms.map(m=>m.from.name||m.from.addr))].slice(0,5).join(', ')})));
      b.onclick=()=>{ MAIL.view=k; render(); }; box.append(b); });
    const sp=by('spam').length; if(sp){ const b=el('div',{className:'mRow mBundle'},el('span',{className:'mBIc',textContent:'🚫'}),el('div',{className:'mMid'},el('div',{className:'mL1'},el('span',{className:'mFrom',textContent:'Spam'}),el('span',{className:'mTime',textContent:String(sp)})),el('div',{className:'mSub',textContent:'Kept out of your way. Still in the real account until you delete it.'})));
      b.onclick=()=>{ MAIL.view='spam'; render(); }; box.append(b); }
    return box;
  }
  if(V==='spam'){ const ms=by('spam');
    box.append(el('p',{className:'mNote',textContent:'Partners moved these here. They’re still in each account’s inbox until you delete them. Tap ✓ on anything that isn’t spam.'}));
    if(ms.length){ const del=el('button',{className:'danger',textContent:`🗑 Delete all ${ms.length} spam emails`}); del.onclick=()=>{ if(confirm(`Delete all ${ms.length} spam emails from your accounts? They go to each account’s Trash.`)) mAct(ms,'trash'); }; box.append(del); }
    else box.append(empty('No spam. 🎉'));
    box.append(mGroupRows(ms,'spam')); return box; }
  if(V==='all'){ vis.slice(0,400).forEach(m=>box.append(mRow(m))); if(!vis.length) box.append(empty('No mail from the last 30 days.')); return box; }
  const ms=by(V), lab=(MCATS.find(x=>x[0]===V)||[])[2]||V;
  box.append(mSumCard(V,lab.toLowerCase(),ms));
  if(ms.length && (V==='updates'||V==='promotions'||V==='social')){ const ar=el('button',{textContent:`🗄 Archive all ${ms.length}`}); ar.onclick=()=>{ if(confirm(`Archive all ${ms.length} ${lab.toLowerCase()} emails?`)) mAct(ms,'archive'); }; box.append(ar); }
  if(!ms.length) box.append(empty(`No ${lab.toLowerCase()} right now.`));
  box.append(V==='important'||V==='personal' ? (()=>{ const d=el('div'); ms.forEach(m=>d.append(mRow(m))); return d; })() : mGroupRows(ms,V));
  return box;
}
async function mOpen(m){
  MAIL.open=m; MAIL.imgs=false; m._body=m._body||null;
  if(!document.documentElement.classList.contains('wide')){ mPhoneReader(m); }
  else render();
  if(!m._body){ try{ m._body=await mBody(m); }catch(e){ m._body={parts:[{type:'text/plain',text:'Couldn’t open this email: '+e.message}]}; } if(MAIL.open===m) mRefreshReader(); }
  if(m.unread) mAct([m],'read');
}
function mRefreshReader(){ const r=document.querySelector('.mReader'); if(!r||!MAIL.open) return; const n=mReader(MAIL.open,r.classList.contains('pane')); r.replaceWith(n); }
function mReader(m, pane){
  const a=mAcct(m.acct), box=el('section',{className:'mReader'+(pane?' pane':'')});
  const ab=(t,ti,fn,cls)=>{ const b=el('button',{className:cls||'',textContent:t,title:ti}); b.onclick=fn; return b; };
  const close=()=>{ MAIL.open=null; const s=box.closest('.scrim'); if(s) s.remove(); render(); };
  const cat=mCat(m);
  const bar=el('div',{className:'mRBar'},ab('✕','Close',close,'ghost'),el('span',{style:'flex:1'}),
    ab('🗄','Archive',()=>{ mAct([m],'archive'); close(); }),ab('🗑','Delete',()=>{ mAct([m],'trash'); close(); }),
    cat==='spam'?ab('✓ Not spam','Not spam',()=>mSetCat(m,'notspam',true)):ab('🚫','Spam: always put mail from this sender in Spam',()=>{ mSetCat(m,'spam',true); toast(`Mail from ${m.from.addr} will go to Spam`); }),
    ab('✉','Mark unread',()=>{ mAct([m],'unread'); close(); }));
  const catSel=el('select',{className:'mCatSel',title:'Where mail from this sender goes'}); [['new','Not sorted'],...MCATS.map(x=>[x[0],x[2]]),['spam','Spam']].forEach(([k,l])=>catSel.append(el('option',{value:k,textContent:l}))); catSel.value=cat;
  catSel.onchange=()=>{ mSetCat(m,catSel.value,true); toast(`Mail from ${m.from.name||m.from.addr} will go to ${catSel.selectedOptions[0].textContent}`); };
  box.append(bar,el('h3',{className:'mRSub',textContent:m.subject}),
    el('div',{className:'mRFrom'},el('b',{textContent:m.from.name||m.from.addr}),el('small',{textContent:` <${m.from.addr}>`})),
    el('div',{className:'mRMeta'},el('span',{className:'mDot',style:`background:${a.color}`}),el('span',{textContent:`${a.address} · ${new Date(m.date).toLocaleString(undefined,{weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}`}),el('span',{style:'flex:1'}),el('small',{textContent:'Goes to '}),catSel));
  const unsub=mUnsubLink(m.unsub); if(unsub) box.append(el('a',{className:'mUnsub',href:unsub,target:'_blank',rel:'noopener',textContent:'Unsubscribe ↗'}));
  // Claude summary of this one email
  const sum=el('div',{className:'mSum'}); const sb=el('button',{className:'mSumB',textContent:m._sum?'✨ Summarize again':'✨ Summarize this email'}); if(m._sum) sum.append(el('div',{className:'mSumT',textContent:m._sum}));
  sb.onclick=async()=>{ if(!m._body) return; sb.disabled=true; sb.textContent='✨ Summing up…';
    try{ const r=await partnersApi('mail/ai',{method:'POST',body:JSON.stringify({mode:'summary',from:`${m.from.name} <${m.from.addr}>`,subject:m.subject,body:mPlain(m._body)})}); m._sum=r.text; }catch(e){ toast(e.message,5000); } mRefreshReader(); };
  sum.prepend(sb); box.append(sum);
  if(!m._body){ box.append(el('p',{className:'spin',textContent:'Opening…'})); return box; }
  const atts=m._body.parts.filter(p=>p.att).map(p=>p.name); if(atts.length||m._body.atts) box.append(el('p',{className:'mNote',textContent:'📎 '+(atts.join(', ')||'Has attachments')+' (open the email in its own app to download)'}));
  const hasHtml=m._body.parts.some(p=>p.type==='text/html'&&p.text);
  if(hasHtml && !MAIL.imgs){ const b=el('button',{className:'ghost mImgs',textContent:'🖼 Show pictures'}); b.onclick=()=>{ MAIL.imgs=true; mRefreshReader(); }; box.append(b); }
  const f=el('iframe',{className:'mBody',sandbox:'allow-popups allow-popups-to-escape-sandbox allow-same-origin',srcdoc:mHtmlDoc(m._body,MAIL.imgs),title:'Email'});
  f.onload=()=>{ try{ f.style.height=Math.max(200,f.contentDocument.documentElement.scrollHeight+20)+'px'; }catch(_){} };
  box.append(f); return box;
}
function mPhoneReader(m){
  document.querySelectorAll('.scrim.mScrim').forEach(s=>s.remove());
  const scrim=el('div',{className:'scrim mScrim'}), sh=el('div',{className:'sheet mSheet'}); scrim.append(sh); sh.append(mReader(m,false)); document.body.append(scrim);
  scrim.onclick=e=>{ if(e.target===scrim){ MAIL.open=null; scrim.remove(); render(); } };
}
setInterval(()=>{ if(typeof tab!=='undefined' && tab==='mail' && !document.hidden && MAIL.accts.length && Date.now()-MAIL.at>180000) mSync(); },30000);
document.addEventListener('visibilitychange',()=>{ if(!document.hidden && typeof tab!=='undefined' && tab==='mail' && MAIL.accts.length && Date.now()-MAIL.at>60000) mSync(); });

(function(){ const st=document.createElement('style'); st.textContent=`
.mWrap{display:flex;gap:16px;align-items:flex-start}
.mSide{width:220px}
.mN{margin-left:auto;font-weight:800;color:var(--dim);font-size:12px}
.chip .mN{margin-left:4px}
.mMain{flex:1;min-width:0}
.mWrap.reading .mMain{flex:0 0 38%;max-width:520px}
.mTop{display:flex;gap:6px;align-items:center;margin-bottom:6px}
.mSel{flex:0 1 200px;width:auto;min-width:0;padding:8px 10px}
@media (max-width:600px){ .mSel{flex:0 1 38%} }
.mQ{flex:1;min-width:0;padding:8px 12px}
.mStatus{font-size:12px;color:var(--dim);font-weight:700;margin:2px 4px 8px}
.mWarn{background:var(--panel2);border-left:4px solid var(--danger);border-radius:8px;padding:8px 10px;margin-bottom:8px;font-size:14px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.mList{background:var(--panel);border:1px solid var(--line);border-radius:16px;overflow:hidden}
.mList>button{margin:8px 12px}
.mRow{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border-bottom:1px solid var(--line);cursor:pointer;position:relative}
.mRow:hover,.mRow.on{background:var(--panel2)}
.mRow.imp{box-shadow:inset 3px 0 0 var(--star)}
.mDot{flex:none;width:10px;height:10px;border-radius:50%;margin-top:6px}
.mMid{flex:1;min-width:0}
.mL1{display:flex;gap:8px;align-items:baseline}
.mFrom{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.mTime{flex:none;font-size:12px;color:var(--dim);font-weight:700}
.mSub{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px}
.mSnip{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;color:var(--dim)}
.mRow.unread .mFrom,.mRow.unread .mSub{font-weight:800}
.mRow.unread .mTime{color:var(--accent)}
.mActs{display:none;gap:2px;position:absolute;right:8px;top:6px;background:var(--panel2);border-radius:10px}
.mActs button{background:transparent;min-height:32px;padding:2px 8px;font-size:15px}
@media (hover:hover){ .mRow:hover .mActs{display:flex} .mRow:hover .mTime{visibility:hidden} }
.mGroup .mCar,.mBundle .mBIc{flex:none;width:22px;text-align:center;font-size:16px;margin-top:2px}
.mRow.mIn{padding-left:44px;background:var(--bg)}
.mBundle{background:var(--panel)}
.mSum{padding:10px 12px;border-bottom:1px solid var(--line);display:flex;flex-direction:column;gap:6px}
.mSumB{align-self:flex-start;min-height:34px;padding:4px 12px;background:var(--panel2);border:1px dashed var(--lilac);font-size:14px}
.mSumT{white-space:pre-wrap;font-size:14px;line-height:1.45}
.mNote{font-size:13px;color:var(--dim);margin:10px 12px}
.mReader{flex:1;min-width:0;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:10px 14px 14px;position:sticky;top:84px;max-height:calc(100vh - 170px);overflow:auto}
.mSheet{max-width:820px;height:92vh;max-height:92vh;padding:0}
.mSheet .mReader{border:0;border-radius:0;position:static;max-height:none;overflow:visible}
.mRBar{display:flex;gap:4px;align-items:center;position:sticky;top:-10px;background:var(--panel);z-index:2;padding:4px 0}
.mRBar button{min-height:38px;padding:4px 10px;background:var(--panel2)}
.mRBar button.ghost{background:transparent}
.mRSub{font:600 20px var(--display);margin:6px 0 4px;overflow-wrap:anywhere}
.mRFrom{font-size:15px;overflow-wrap:anywhere} .mRFrom small{color:var(--dim)}
.mRMeta{display:flex;gap:8px;align-items:center;font-size:13px;color:var(--dim);margin:4px 0 8px;flex-wrap:wrap}
.mRMeta .mDot{margin-top:0}
.mCatSel{width:auto;padding:4px 8px;font-size:13px}
.mUnsub{display:inline-block;font-size:13px;font-weight:800;margin-bottom:6px}
.mReader .mSum{border:1px dashed var(--line);border-radius:12px;margin-bottom:8px}
.mBody{width:100%;border:0;background:#fff;border-radius:10px;min-height:200px;display:block}
.mImgs{min-height:32px;padding:2px 10px;font-size:13px}
.mAcRow{display:flex;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid var(--line);flex-wrap:wrap}
.mAcA{flex:1;min-width:0;display:flex;flex-direction:column} .mAcA small{color:var(--dim)}
.mAdd{display:flex;flex-direction:column;align-items:flex-start;width:100%;text-align:left;margin-top:6px} .mAdd small{font-weight:600;color:var(--dim);font-size:12px}
.mErr{color:var(--danger)!important;font-weight:700}
`; document.head.append(st); })();
if(typeof tab!=='undefined' && tab==='mail') render();
