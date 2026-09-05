/* Isolated A/B monitor and privileged AI requests. Loaded by service worker. */
importScripts('ab-core.js','ab-ai.js','ab-context.js','ab-research.js');
(() => {
  'use strict';
  let sessions={},saveTimer;
  const previews=new Map(), jobs=new Map();
  const ready=(async()=>{
    await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
    await chrome.storage.session.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
    sessions=(await chrome.storage.session.get('abSessions')).abSessions||{};
    const saved=(await chrome.storage.session.get('abPreviews')).abPreviews||[];
    for(const [token,p] of saved)if(Date.now()-p.created<600000)previews.set(token,p);
  })();
  function trusted(sender) { return sender.id===chrome.runtime.id && [chrome.runtime.getURL('panel.html'),chrome.runtime.getURL('ai-settings.html')].includes((sender.url||'').split('?')[0].split('#')[0]); }
  async function persist() {
    clearTimeout(saveTimer);
    saveTimer=setTimeout(async()=>{
      try {
        // Session storage is shared: bound aggregate data below its 10 MB quota.
        while(JSON.stringify(sessions).length*2>7*1024*1024) {
          const largest=Object.values(sessions).sort((a,b)=>b.evidence.length-a.evidence.length)[0];
          if(!largest?.evidence.length) {
            const histories=Object.values(sessions).flatMap(s=>Object.values(s.records).map(r=>({s,r}))).filter(x=>x.r.history.length>1).sort((a,b)=>b.r.history.length-a.r.history.length);
            if(!histories.length)break;
            histories[0].r.history.splice(0,Math.ceil(histories[0].r.history.length/2));histories[0].r.historyTruncated=true;histories[0].s.truncated=true;continue;
          }
          largest.evidence.splice(0,Math.max(1,Math.floor(largest.evidence.length/2)));largest.truncated=true;
        }
        await chrome.storage.session.set({abSessions:sessions});
      }catch{for(const s of Object.values(sessions))if(!s.coverage.includes('会话保存失败，后台重启可能丢失记录'))s.coverage.push('会话保存失败，后台重启可能丢失记录');}
    },200);
  }
  function broadcast(s) { persist(); chrome.runtime.sendMessage({action:'ab:changed',tabId:s.tabId,revision:s.revision}).catch(()=>{}); }
  async function target(sender,tabId) {
    if(sender.tab && sender.url?.startsWith(chrome.runtime.getURL('panel.html'))) return sender.tab.id;
    if(Number.isInteger(tabId))return tabId;
    const tabs=await chrome.tabs.query({active:true,lastFocusedWindow:true});
    if(!tabs[0] || !/^https?:/.test(tabs[0].url||''))throw Error('请在目标网站打开插件');
    return tabs[0].id;
  }
  async function ensure(tabId) {
    const tab=await chrome.tabs.get(tabId);
    if(!/^https?:/.test(tab.url||''))throw Error('仅支持 HTTP/HTTPS 网页');
    const origin=new URL(tab.url).origin;
    if(!sessions[tabId] || sessions[tabId].origin!==origin) {
      const active=sessions[tabId]?.active||false;
      jobs.get(tabId)?.abort();
      sessions[tabId]=ABRadar.session(tabId,origin,active);
    }
    sessions[tabId].pageTitle=String(tab.title||'').slice(0,200);
    return sessions[tabId];
  }
  async function control(s,scan=false) {
    try {
      await chrome.scripting.executeScript({target:{tabId:s.tabId,allFrames:true},world:'MAIN',files:['ab-probe.js']});
      await chrome.scripting.executeScript({target:{tabId:s.tabId,allFrames:true},files:['ab-bridge.js']});
      await chrome.tabs.sendMessage(s.tabId,{action:'ab:control',active:s.active,scan});
    }catch{if(!s.coverage.includes('部分 frame 无法注入或页面已关闭'))s.coverage.push('部分 frame 无法注入或页面已关闭');}
  }
  async function decodeTransport(encoded) {
    const decoded=TeaRadar.AnalyticsCore?.decodeSensorsPayload(encoded);
    if(!decoded?.__gzipped)return decoded;
    const reader=new Blob([decoded.bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
    let size=0;const chunks=[];
    try {
      while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>512*1024){reader.cancel().catch(()=>{});return null;}chunks.push(part.value);}
      const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
      return JSON.parse(new TextDecoder().decode(bytes));
    }finally{reader.releaseLock();}
  }
  function record(s,e) {
    if(e.kind==='gap'){ if(!s.coverage.includes(String(e.data)))s.coverage.push(String(e.data));broadcast(s);return; }
    if(e.kind==='snapshot' && s.evidence.some(x=>x.kind==='snapshot' && x.frameId===e.frameId && JSON.stringify(x.data)===JSON.stringify(e.data)))return;
    if(ABRadar.ingest(s,e))broadcast(s);
  }
  async function settings() { return {...ABAI.defaults,...(await chrome.storage.local.get('abAISettings')).abAISettings}; }
  function previewSnapshot(s,key) {
    const snap=ABRadar.snapshot(s,key);
    for(const r of snap.records)r.evidenceIds=[...new Set(r.history.map(h=>h.evidenceId))];
    const recentIds=new Set(snap.records.flatMap(r=>r.evidenceIds));snap.evidence=snap.evidence.filter(e=>recentIds.has(e.id) || !key && !snap.records.some(r=>r.provider===e.provider));
    // Evidence summaries contain no arbitrary raw payloads. Only normalized experiment fields are sent.
    while(JSON.stringify(snap).length>120000 && snap.records.length>1){snap.records.pop();snap.truncated=true;}
    const used=new Set(snap.records.flatMap(r=>r.evidenceIds));snap.evidence=snap.evidence.filter(e=>used.has(e.id) || !key && !snap.records.some(r=>r.provider===e.provider));
    if(JSON.stringify(snap).length>120000)throw Error('此实验的参数过大，请先清空并缩小采集范围');
    return snap;
  }
  chrome.runtime.onMessage.addListener((message,sender,reply)=>{
    if(!message.action?.startsWith('ab:'))return;
    (async()=>{
      await ready;
      if(message.action==='ab:hello') {
        if(!sender.tab || sender.url?.startsWith('chrome-extension:'))return {};
        if(!sessions[sender.tab.id])return {active:false,scan:false};
        const s=await ensure(sender.tab.id);return {active:s.active,scan:s.active};
      }
      if(message.action==='ab:observe') {
        if(!sender.tab || !/^https?:/.test(sender.url||''))return {};
        const s=sessions[sender.tab.id],p=message.payload;
        if(!s || !p || !['snapshot','response','gap'].includes(p.kind) || (!s.active && !(p.kind==='snapshot' && Date.now()<(s.scanUntil||0))))return {};
        if(new TextEncoder().encode(JSON.stringify(p)).length>512*1024)return {};
        record(s,{id:crypto.randomUUID(),kind:p.kind,url:typeof p.url==='string'?p.url:sender.url,pageURL:sender.url,frameId:sender.frameId,documentId:sender.documentId,time:Date.now(),data:p.data,requestContext:p.requestContext&&typeof p.requestContext.app_id==='string'?{app_id:p.requestContext.app_id.slice(0,100)}:undefined,status:p.status,requestId:p.requestId,source:'page-observation'});
        return {};
      }
      if(!trusted(sender))throw Error('此操作仅允许插件界面调用');
      if(message.action==='ab:settings') { const c=await settings();return {baseURL:c.baseURL,model:c.model,hasKey:!!c.apiKey}; }
      if(message.action==='ab:saveSettings') {
        const old=await settings(),value=message.settings||{};ABAI.endpoint(value.baseURL);
        if(typeof value.model!=='string'||!value.model.trim()||value.model.length>200)throw Error('请填写模型名称');
        await chrome.storage.local.set({abAISettings:{baseURL:value.baseURL,model:value.model.trim(),apiKey:message.deleteKey?'':value.apiKey||old.apiKey||''}});previews.clear();await chrome.storage.session.set({abPreviews:[]});return {ok:true};
      }
      if(message.action==='ab:test') {
        const c=await settings(),controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),60000);
        try {await ABAI.complete(c,{counts:{experiments:0},evidence:[{id:'test',kind:'连接测试'}],records:[]},controller.signal);return {ok:true};}
        catch(e){if(controller.signal.aborted)throw Error('连接测试超时');throw e;}finally{clearTimeout(timeout);}
      }
      const tabId=await target(sender,message.tabId);
      const s=await ensure(tabId);
      switch(message.action) {
        case 'ab:get':return {session:s};
        case 'ab:enter':if(!s.monitorInitialized){s.active=true;s.monitorInitialized=true;}s.scanUntil=Date.now()+5000;await control(s,true);broadcast(s);return {session:s};
        case 'ab:scan':s.scanUntil=Date.now()+5000;await control(s,true);broadcast(s);return {session:s};
        case 'ab:start':s.monitorInitialized=true;s.active=true;s.scanUntil=Date.now()+5000;await control(s,true);broadcast(s);return {session:s};
        case 'ab:pause':s.monitorInitialized=true;s.active=false;await control(s);broadcast(s);return {session:s};
        case 'ab:refresh':s.active=true;await chrome.storage.session.set({abSessions:sessions});await chrome.tabs.reload(tabId);return {session:s};
        case 'ab:clear':jobs.get(tabId)?.abort();sessions[tabId]=ABRadar.session(tabId,s.origin,s.active);sessions[tabId].monitorInitialized=s.monitorInitialized;broadcast(sessions[tabId]);return {session:sessions[tabId]};
        case 'ab:export':return {data:{...ABRadar.snapshot(s),ai:ABRadar.redact(s.ai)}};
        case 'ab:preview': {
          const c=await settings();if(!c.apiKey)throw Error('请先在 AI API 设置中保存 API Key');
          const snapshot=previewSnapshot(s,message.key);
          try{
            const results=await chrome.scripting.executeScript({target:{tabId},func:ABContextCapture});
            const context=results[0]?.result;
            if(context && new URL(context.url).origin===s.origin){const id='context-'+crypto.randomUUID();snapshot.websiteContext={...context,evidenceId:id};snapshot.evidence.push({id,kind:'page-context',url:context.url,time:Date.now(),frameId:0});}
          }catch{snapshot.coverage.push('当前页面 HTML 不可读取，解读仅使用已有实验证据');}
          snapshot.siteProfile=ABRadar.siteProfile(s.origin);
          snapshot.researchContext=await ABResearch.forSite(s.origin);
          for(const item of snapshot.researchContext.sites)snapshot.evidence.push({id:item.evidenceId,kind:'historical-research',time:item.observedAt,source:item.sources,currentObservation:false});
          if(!snapshot.evidence.length)throw Error('尚无可解读的实验记录与页面证据');
          const token=crypto.randomUUID();if(previews.size>=5)previews.delete(previews.keys().next().value);previews.set(token,{snapshot,tabId,key:message.key,created:Date.now(),baseURL:c.baseURL,model:c.model});
          await chrome.storage.session.set({abPreviews:[...previews]});persist();
          return {token,snapshot,endpoint:new URL(ABAI.endpoint(c.baseURL)).origin,model:c.model};
        }
        case 'ab:cancel':jobs.get(tabId)?.abort();return {ok:true};
        case 'ab:analyze': {
          const preview=previews.get(message.token);previews.delete(message.token);await chrome.storage.session.set({abPreviews:[...previews]});
          if(!preview || preview.tabId!==tabId || preview.snapshot.sessionId!==s.id || Date.now()-preview.created>600000)throw Error('预览已过期，请重新生成');
          if(jobs.has(tabId))throw Error('当前已有解读任务');
          const c=await settings();if(c.baseURL!==preview.baseURL||c.model!==preview.model)throw Error('接口配置已变化，请重新预览');
          const controller=new AbortController();jobs.set(tabId,controller);let timedOut=false;
          const timeout=setTimeout(()=>{timedOut=true;controller.abort();},60000);
          // Keep this MV3 worker alive while a user-requested completion is pending.
          const keepAlive=setInterval(()=>chrome.runtime.getPlatformInfo().catch(()=>{}),20000);
          try {
            const result=await ABAI.complete(c,preview.snapshot,controller.signal);
            if(sessions[tabId]?.id!==s.id)throw Error('页面会话已变化，结果未覆盖当前会话');
            s.ai={result,snapshot:preview.snapshot,revision:preview.snapshot.revision,time:Date.now(),model:c.model,key:preview.key||null};broadcast(s);return {ai:s.ai};
          }catch(e){if(controller.signal.aborted)throw Error(timedOut?'解读超时（60 秒），可手动重试':'已取消解读');throw e;}
          finally{clearTimeout(timeout);clearInterval(keepAlive);jobs.delete(tabId);}
        }
        default:throw Error('未知操作');
      }
    })().then(reply).catch(e=>reply({error:e instanceof TypeError?'请求失败，请检查网络或接口地址':String(e.message||e)}));
    return true;
  });
  chrome.webRequest.onBeforeRequest.addListener(details=>{
    void (async()=>{
      await ready;const s=sessions[details.tabId];if(!s?.active || details.type==='main_frame')return;
      let body='';const rb=details.requestBody;
      if(rb?.formData)body=JSON.stringify(rb.formData);
      else if(rb?.raw){const size=rb.raw.reduce((n,r)=>n+(r.bytes?.byteLength||0),0);if(size>512*1024)return;body=rb.raw.map(r=>r.bytes?new TextDecoder().decode(r.bytes):'').join('');}
      const query=Object.fromEntries(new URL(details.url).searchParams);
      let data=ABRadar.parse(body)||query;
      // Reuse existing base64/gzip decoder for analytics transports.
      let encoded=(typeof data==='object' && (data.data_list || data.data));
      if(Array.isArray(encoded)&&encoded.length===1)encoded=encoded[0];
      if(encoded && typeof encoded==='string')try {const decoded=await decodeTransport(encoded);if(decoded && JSON.stringify(decoded).length <= 512*1024)data=decoded;}catch{}
      if(!ABRadar.patterns.test(details.url+' '+JSON.stringify(data)))return;
      const url=details.url;
      record(s,{id:'net-'+details.requestId,requestId:details.requestId,kind:'request',url,pageURL:details.documentUrl||details.initiator,frameId:details.frameId,documentId:details.documentId,time:details.timeStamp,data:{query,body:data},status:'pending',source:'webRequest'});
    })().catch(()=>{});
  },{urls:['<all_urls>']},['requestBody']);
  function status(d) {void ready.then(()=>{const s=sessions[d.tabId],e=s?.evidence.find(x=>x.requestId===d.requestId&&x.source==='webRequest');if(e){e.status=d.error||d.statusCode;broadcast(s);}});}
  chrome.webRequest.onCompleted.addListener(status,{urls:['<all_urls>']});
  chrome.webRequest.onErrorOccurred.addListener(status,{urls:['<all_urls>']});
  chrome.tabs.onUpdated.addListener((tabId,info)=>{if(info.url)void ready.then(async()=>{if(sessions[tabId]){try{const s=await ensure(tabId);await control(s,s.active);broadcast(s);}catch{jobs.get(tabId)?.abort();delete sessions[tabId];persist();}}});});
  chrome.tabs.onRemoved.addListener(tabId=>{void ready.then(()=>{jobs.get(tabId)?.abort();delete sessions[tabId];persist();});});
})();
