const {test}=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const path=require('node:path');
const base=path.resolve(__dirname,'../tea_event_radar');
function harness(saved={},savedPreviews=[],savedLocal={}){
 const listeners={},store={abSessions:saved,abPreviews:savedPreviews},local={...savedLocal},tabs={1:{id:1,url:'https://one.test/a'},2:{id:2,url:'https://two.test/'}};
 const event=name=>({addListener:f=>{listeners[name]=f;}});
 const area=data=>({setAccessLevel:async()=>{},get:async key=>({[key]:data[key]}),set:async obj=>Object.assign(data,obj)});
 const chrome={runtime:{id:'unit',getURL:p=>'chrome-extension://unit/'+p,onMessage:event('message'),sendMessage:async()=>{},getPlatformInfo:async()=>({})},storage:{session:area(store),local:area(local)},tabs:{get:async id=>tabs[id],query:async()=>[tabs[1]],sendMessage:async()=>{},reload:async()=>{},onRemoved:event('removed'),onUpdated:event('updated')},scripting:{executeScript:async()=>[]},webRequest:{onBeforeRequest:event('request'),onCompleted:event('completed'),onErrorOccurred:event('failed')}};
 const timers=new Map();let tid=0;
 const context=vm.createContext({chrome,console,crypto,URL,URLSearchParams,TextEncoder,TextDecoder,structuredClone,AbortController,setTimeout:(fn,ms)=>{timers.set(++tid,{fn,ms});return tid;},clearTimeout:id=>timers.delete(id),setInterval:()=>0,clearInterval:()=>{},fetch:async()=>{throw Error('no live calls in tests');}});
 context.importScripts=(...files)=>files.forEach(f=>vm.runInContext(fs.readFileSync(path.join(base,f),'utf8'),context,{filename:f}));
 vm.runInContext(fs.readFileSync(path.join(base,'ab-worker.js'),'utf8'),context);
 const panel={id:'unit',url:'chrome-extension://unit/panel.html'};
 const send=(action,extra={},sender=panel)=>new Promise(resolve=>listeners.message({action:'ab:'+action,...extra},sender,resolve));
 const flush=async()=>{for(const [id,t]of timers)if(t.ms===200){timers.delete(id);await t.fn();}};
 return {send,listeners,store,local,tabs,context,flush,fire:async ms=>{for(const [id,t] of timers)if(t.ms===ms){timers.delete(id);await t.fn();}}};
}
test('Per-tab monitor, paused snapshot, clear and restoration',async()=>{
 const h=harness();await h.send('start',{tabId:1});await h.send('scan',{tabId:2});
 const site=id=>({id:'unit',tab:{id},url:'https://'+(id===1?'one':'two')+'.test/a',frameId:0,documentId:'doc'});
 await h.send('observe',{payload:{kind:'response',data:{expid:1,gid:2,value:'red'},url:'https://one.test/config'}},site(1));
 assert.equal(Object.keys((await h.send('get',{tabId:1})).session.records).length,1);
 assert.equal(Object.keys((await h.send('get',{tabId:2})).session.records).length,0);
 await h.send('pause',{tabId:1});await h.send('observe',{payload:{kind:'response',data:{expid:2,gid:3}}},site(1));
 assert.equal(Object.keys((await h.send('get',{tabId:1})).session.records).length,1);
 await h.flush();const restored=harness(structuredClone(h.store.abSessions));assert.equal(Object.keys((await restored.send('get',{tabId:1})).session.records).length,1);
 await h.send('clear',{tabId:1});assert.equal(Object.keys((await h.send('get',{tabId:1})).session.records).length,0);
});
test('Website cannot read settings or invoke model; trusted settings never reveal key',async()=>{
 const h=harness();assert.ok((await h.send('settings',{}, {id:'unit',tab:{id:1},url:'https://one.test'})).error);
 assert.ok((await h.send('analyze',{}, {id:'unit',tab:{id:1},url:'https://one.test'})).error);
 await h.send('saveSettings',{settings:{baseURL:'https://api.test',model:'deepseek-v4-flash',apiKey:'SECRET'}});
 const publicSettings=await h.send('settings');assert.equal(publicSettings.hasKey,true);assert.ok(!JSON.stringify(publicSettings).includes('SECRET'));
 await h.send('saveSettings',{settings:{baseURL:'https://api.test',model:'deepseek-v4-flash'},deleteKey:true});assert.equal((await h.send('settings')).hasKey,false);
});
test('Same-origin navigation keeps session; another origin replaces it',async()=>{
 const h=harness();const first=(await h.send('start',{tabId:1})).session.id;
 h.tabs[1].url='https://one.test/b';assert.equal((await h.send('get',{tabId:1})).session.id,first);
 h.tabs[1].url='https://other.test';const s=(await h.send('get',{tabId:1})).session;assert.notEqual(s.id,first);assert.equal(s.active,true);
});
test('Iframe extension panel resolves its owning tab',async()=>{
 const h=harness();const result=await h.send('get',{tabId:1},{id:'unit',url:'chrome-extension://unit/panel.html',tab:{id:2}});assert.equal(result.session.tabId,2);
});
test('AI preview includes evidence without raw identity or API key',async()=>{
 const h=harness();await h.send('saveSettings',{settings:{baseURL:'https://api.test',model:'deepseek-v4-flash',apiKey:'SECRET'}});await h.send('start',{tabId:1});
 await h.send('observe',{payload:{kind:'response',url:'https://one.test/abtest_config',data:{data:{title:{vid:12,value:'red'}}}}},{id:'unit',tab:{id:1},url:'https://one.test/a',frameId:0});
 const p=await h.send('preview',{tabId:1});assert.ok(!p.error,p.error);assert.ok(p.token);assert.ok(p.snapshot.evidence.length);assert.ok(!JSON.stringify(p).includes('SECRET'));
});

test('Preview token accepts its own internal session and saves structured AI output',async()=>{
 const h=harness();await h.send('saveSettings',{settings:{baseURL:'https://api.test',model:'deepseek-v4-flash',apiKey:'SECRET'}});await h.send('start',{tabId:1});
 await h.send('observe',{payload:{kind:'response',url:'https://one.test/abtest_config',data:{data:{title:{vid:12,value:'red'}}}}},{id:'unit',tab:{id:1},url:'https://one.test/a',frameId:0});
 h.context.fetch=async(url,options)=>{const snap=JSON.parse(JSON.parse(options.body).messages[1].content);return{ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({findings:[{type:'hypothesis',text:'布局假设',confidence:'low',evidenceIds:[snap.evidence[0].id]}],missingEvidence:[],nextChecks:[]})}}]})};};
 const p=await h.send('preview',{tabId:1});const r=await h.send('analyze',{tabId:1,token:p.token});assert.ok(!r.error,r.error);assert.equal(r.ai.result.findings[0].text,'布局假设');
 assert.ok((await h.send('analyze',{tabId:1,token:p.token})).error,'tokens cannot be replayed');
});

for (const mode of ['cancel','timeout']) test('AI '+mode+' terminates an outstanding request without saving a result',async()=>{
 const h=harness();await h.send('saveSettings',{settings:{baseURL:'https://api.test',model:'deepseek-v4-flash',apiKey:'SECRET'}});await h.send('start',{tabId:1});
 await h.send('observe',{payload:{kind:'response',url:'https://one.test/abtest_config',data:{data:{title:{vid:12,value:'red'}}}}},{id:'unit',tab:{id:1},url:'https://one.test/a',frameId:0});
 let started;const gate=new Promise(r=>started=r);h.context.fetch=(url,options)=>new Promise((resolve,reject)=>{options.signal.addEventListener('abort',()=>reject(Error('aborted')));started();});
 const p=await h.send('preview',{tabId:1});const pending=h.send('analyze',{tabId:1,token:p.token});await gate;
 if(mode==='cancel')await h.send('cancel',{tabId:1});else await h.fire(60000);
 const r=await pending;assert.match(r.error,mode==='cancel'?/取消/:/超时/);assert.equal((await h.send('get',{tabId:1})).session.ai,null);
});

test('Preview survives worker restart during user review',async()=>{
 const h=harness();await h.send('saveSettings',{settings:{baseURL:'https://api.test',model:'deepseek-v4-flash',apiKey:'SECRET'}});await h.send('start',{tabId:1});
 await h.send('observe',{payload:{kind:'response',url:'https://one.test/abtest_config',data:{data:{title:{vid:12,value:'red'}}}}},{id:'unit',tab:{id:1},url:'https://one.test/a',frameId:0});
 const p=await h.send('preview',{tabId:1});await h.flush();
 const restored=harness(structuredClone(h.store.abSessions),structuredClone(h.store.abPreviews),structuredClone(h.local));
 restored.context.fetch=async()=>({ok:true,json:async()=>({choices:[{message:{content:JSON.stringify({findings:[],missingEvidence:[],nextChecks:[]})}}]})});
 const r=await restored.send('analyze',{tabId:1,token:p.token});assert.ok(!r.error,r.error);assert.ok(r.ai);
});
test('First AB entry starts monitoring; explicit pause survives tab switches and clear',async()=>{
 const h=harness();assert.equal((await h.send('enter',{tabId:1})).session.active,true);
 await h.send('pause',{tabId:1});assert.equal((await h.send('enter',{tabId:1})).session.active,false);
 await h.send('clear',{tabId:1});assert.equal((await h.send('enter',{tabId:1})).session.active,false);
 assert.equal((await h.send('enter',{tabId:2})).session.active,true);
});
test('AI snapshot includes matched historical research separately from live counts',async()=>{
 const h=harness();h.tabs[1].url='https://www.bilibili.com/';
 h.context.fetch=async()=>({ok:true,json:async()=>JSON.parse(fs.readFileSync(path.join(base,'ab-research.json'),'utf8'))});
 await h.send('saveSettings',{settings:{baseURL:'https://api.test',model:'test',apiKey:'SECRET'}});
 await h.send('enter',{tabId:1});const r=await h.send('preview',{tabId:1});
 assert.equal(r.snapshot.counts.experiments,0);assert.equal(r.snapshot.researchContext.sites.length,1);
 assert.equal(r.snapshot.evidence[0].kind,'historical-research');assert.equal(r.snapshot.evidence[0].currentObservation,false);
});
