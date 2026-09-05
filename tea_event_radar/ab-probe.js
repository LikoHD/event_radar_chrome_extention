/* MAIN world: observe existing responses; never evaluate flags or issue requests. */
(() => {
  'use strict';
  if (window.__teaABProbeInstalled) return;
  Object.defineProperty(window,'__teaABProbeInstalled',{value:true});
  let active=false, lastScan=0;
  const MAX=512*1024, encoder=new TextEncoder();
  const candidate=/ab_results|ab_split_num|tpp_buckets|expData|sGrayPolicyId|experimental\/groups|rdelivery\.qq|ab\.chatgpt\.com|dynamic_configs|feature_gates|layer_configs|expIds|ab_bucket|ab_config|abTest|abtest|ab_test|ab_version|abVersion|ab_params|exp_id|experiment|variation|variant|feature.?flag|ab_sdk_version|optimizely|growthbook|statsig|abtasty|launchdarkly|visualwebsiteoptimizer|wingify|volceapplog|tab\.volces|\/flags|\/decide/i;
  function emit(data) {
    try { const serialized=JSON.stringify(data); if (encoder.encode(serialized).length<=MAX) window.postMessage({source:'tea-ab-observation',payload:JSON.parse(serialized)}, location.origin === 'null' ? '*' : location.origin); } catch {}
  }
  function requestContext(body){
    if(typeof body!=='string'||body.length>MAX)return undefined;
    try{const o=JSON.parse(body);const h=o.header||o;const app=h.app_id??h.aid??h.appID;return app==null?undefined:{app_id:String(app)};}catch{return undefined;}
  }
  function response(url, data, requestId, status, context) {
    if (!active) return;
    try {
      const raw=typeof data==='string'?data:JSON.stringify(data);
      if (encoder.encode(raw).length>MAX) { emit({kind:'gap',data:'响应超过 512 KB，已跳过',url}); return; }
      if (!candidate.test(url+' '+raw)) return;
      let parsed; try { parsed=JSON.parse(raw); } catch { emit({kind:'gap',url,data:'候选实验响应不是可解析 JSON；可能为流式、编码或私有协议'});return; }
      emit({kind:'response',data:parsed,url,requestId,status,requestContext:context,time:Date.now()});
    } catch {}
  }
  async function readResponse(res,url,id,context) {
    if (!active || !/json|text|javascript/.test(res.headers.get('content-type')||'')) return;
    // This custom endpoint returned the Statsig initialize protocol in the dated live audit.
    if(/^https:\/\/ab\.chatgpt\.com\/v1\/initialize(?:[/?]|$)/.test(url))emit({kind:'snapshot',url,data:{sdkEvidence:{statsig:'initialize endpoint; payload parsing is separately bounded'}}});
    if (Number(res.headers.get('content-length'))>MAX) { if(candidate.test(url)) emit({kind:'gap',url,data:'响应超过 512 KB，已跳过'}); return; }
    let reader;
    try {
      reader=res.clone().body?.getReader(); if(!reader)return;
      let size=0, chunks=[];
      while (true) { const part=await reader.read(); if(part.done)break; size+=part.value.byteLength;
        if(size>MAX || !active) { reader.cancel().catch(()=>{}); if(active && candidate.test(url))emit({kind:'gap',url,data:'候选响应超过 512 KB，保留平台线索但未解析实验配置'});return; } chunks.push(part.value);
      }
      const bytes=new Uint8Array(size); let offset=0;
      chunks.forEach(c=>{bytes.set(c,offset);offset+=c.length;});
      response(url,new TextDecoder().decode(bytes),id,res.status,context);
    } catch {} finally { try { reader?.releaseLock(); } catch {} }
  }
  const originalFetch=window.fetch;
  window.fetch=function(...args) {
    const promise=Reflect.apply(originalFetch,this,args);
    if (active) {
      const id='fetch-'+crypto.randomUUID(), context=requestContext(args[1]?.body);
      promise.then(res=>{ const url=res.url || (typeof args[0]==='string'?args[0]:''); if(active) void readResponse(res,url,id,context); },()=>{});
    }
    return promise;
  };
  const originalOpen=XMLHttpRequest.prototype.open, originalSend=XMLHttpRequest.prototype.send;
  const xhrMeta=new WeakMap();
  XMLHttpRequest.prototype.open=function(...args) { const result=Reflect.apply(originalOpen,this,args); xhrMeta.set(this,{url:String(args[1]),id:'xhr-'+crypto.randomUUID()}); return result; };
  XMLHttpRequest.prototype.send=function(...args) {
    const context=active?requestContext(args[0]):undefined;
    if(active) this.addEventListener('load',()=>{ if(!active)return; try {const m=xhrMeta.get(this)||{}; if(this.responseType===''||this.responseType==='text') response(this.responseURL||m.url,this.responseText,m.id,this.status,context); else if(this.responseType==='json')response(this.responseURL||m.url,this.response,m.id,this.status,context);}catch{} },{once:true});
    return Reflect.apply(originalSend,this,args);
  };
  function scan() {
    if(Date.now()-lastScan<500)return; lastScan=Date.now();
    const scripts=Array.from(document.scripts).map(s=>s.src).filter(s=>candidate.test(s)).slice(0,60);
    const globals={};
    for(const name of ['LogAnalyticsObject','TeaAnalyticsObject','SensorsABTest','optimizely','growthbook','_vwo_exp','VWO','statsig','ABTasty','LDClient']) {
      const d=Object.getOwnPropertyDescriptor(window,name);
      if(d && 'value' in d)globals[name]=typeof d.value;
    }
    if(window.aplus?.qt_abtest) globals.qt_abtest=true;
    emit({kind:'snapshot',url:location.href,time:Date.now(),data:{scripts,globals}});
    for(const name of ['abtest','__INITIAL_STATE__','__NEXT_DATA__','__NUXT__','__SSR_DATA__','WIZ_global_data'])try{
      const d=Object.getOwnPropertyDescriptor(window,name);if(!d||!('value' in d))continue;
      const raw=JSON.stringify(d.value);if(raw&&raw.length<MAX/2&&candidate.test(raw))emit({kind:'snapshot',url:location.href,data:{bootstrap:{[name]:JSON.parse(raw)}}});
    }catch{}
    // Optimizely's documented state getters are read-only, unlike evaluation APIs.
    try { const state=window.optimizely?.get?.('state'); if(state?.getExperimentStates)emit({kind:'snapshot',url:location.href,data:{optimizely:state.getExperimentStates()}}); } catch{}
    try { if(window._vwo_exp) {
      const experiments=Object.entries(window._vwo_exp).slice(0,100).map(([id,o])=>({campaignId:id,name:o.name,variations:o.comb_n}));
      emit({kind:'snapshot',url:location.href,data:{_vwo:experiments}});
    }}catch{}
    for(const storageName of ['localStorage','sessionStorage']) try {
      const store=window[storageName];
      for(let i=0;i<Math.min(store.length,200);i++) {const key=store.key(i); if(!candidate.test(key))continue;
        const raw=store.getItem(key); if(!raw||encoder.encode(raw).length>MAX/2)continue;
        let value;try{value=JSON.parse(raw);}catch{value=raw;}
        emit({kind:'snapshot',url:location.href,data:{[storageName]:{[key]:value}}});
      }
    }catch{}
    try { for(const entry of document.cookie.split(';')) { const at=entry.indexOf('='); const key=entry.slice(0,at).trim();if(!candidate.test(key) && !/^_vis_opt_exp_/.test(key))continue;
      const vwo=key.match(/^_vis_opt_exp_(\d+)_combi$/);
      if(vwo) {emit({kind:'snapshot',url:location.href,data:{_vwo:{campaignId:vwo[1],variationId:entry.slice(at+1)}}});continue;}
      emit({kind:'snapshot',url:location.href,data:{storage:{[key]:decodeURIComponent(entry.slice(at+1))}}});
    }}catch{}
    for(const el of Array.from(document.querySelectorAll('script[type="application/json"],script#__NEXT_DATA__')).slice(0,20)) {
      if(encoder.encode(el.textContent).length>MAX/2 || !candidate.test(el.textContent))continue;
      try{emit({kind:'snapshot',url:location.href,data:{bootstrap:JSON.parse(el.textContent)}});}catch{}
    }
  }
  window.addEventListener('message',event=>{
    if(event.source!==window || event.data?.source!=='tea-ab-control')return;
    active=event.data.active===true;
    if(event.data.scan){scan();setTimeout(()=>{if(active)scan();},1000);setTimeout(()=>{if(active)scan();},3000);}
  });
  document.addEventListener('DOMContentLoaded',()=>{if(active)scan();},{once:true});
  let lastURL=location.href;
  setInterval(()=>{if(active && location.href!==lastURL){lastURL=location.href;scan();}},1000);
})();
