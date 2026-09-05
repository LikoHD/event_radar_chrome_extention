const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('Fetch observer preserves original promise and binds val config to request app_id',async()=>{
 const emitted=[],listeners={};const original=Promise.resolve(new Response(JSON.stringify({data:{search_ai_mode:{val:'exp_grp',vid:'92428570'}}}),{headers:{'content-type':'application/json'}}));
 function XHR(){}XHR.prototype.open=function(){};XHR.prototype.send=function(){};
 const window={fetch:()=>original,addEventListener:(k,fn)=>listeners[k]=fn,postMessage:v=>emitted.push(v)};
 const context=vm.createContext({window,XMLHttpRequest:XHR,crypto,TextEncoder,TextDecoder,location:{href:'https://console.test/dashboard',origin:'https://console.test'},document:{addEventListener(){}},setInterval(){},setTimeout,console});
 vm.runInContext(fs.readFileSync('tea_event_radar/ab-probe.js','utf8'),context);
 listeners.message({source:window,data:{source:'tea-ab-control',active:true}});
 const result=window.fetch('/abtest_config',{method:'POST',body:JSON.stringify({header:{app_id:3569,user_unique_id:'do-not-bridge'}})});
 assert.equal(result,original);assert.ok((await result).bodyUsed===false);
 for(let i=0;i<30&&!emitted.length;i++)await new Promise(r=>setTimeout(r,5));
 assert.equal(emitted[0].payload.requestContext.app_id,'3569');assert.equal(emitted[0].payload.data.data.search_ai_mode.val,'exp_grp');assert.ok(!JSON.stringify(emitted).includes('do-not-bridge'));
});
test('Oversize observed Statsig endpoint preserves original response and reports a gap',async()=>{
 const emitted=[],listeners={};const original=Promise.resolve(new Response(JSON.stringify({dynamic_configs:{payload:'x'.repeat(513*1024)}}),{headers:{'content-type':'application/json'}}));
 function XHR(){}XHR.prototype.open=function(){};XHR.prototype.send=function(){};
 const window={fetch:()=>original,addEventListener:(k,fn)=>listeners[k]=fn,postMessage:v=>emitted.push(v)};
 const context=vm.createContext({window,XMLHttpRequest:XHR,crypto,TextEncoder,TextDecoder,location:{href:'https://openai.com/',origin:'https://openai.com'},document:{addEventListener(){}},setInterval(){},setTimeout,console});
 vm.runInContext(fs.readFileSync('tea_event_radar/ab-probe.js','utf8'),context);
 listeners.message({source:window,data:{source:'tea-ab-control',active:true}});
 assert.equal(window.fetch('https://ab.chatgpt.com/v1/initialize'),original);
 for(let i=0;i<50&&!emitted.some(e=>e.payload.kind==='gap');i++)await new Promise(r=>setTimeout(r,5));
 assert.ok(emitted.some(e=>e.payload.data?.sdkEvidence?.statsig));assert.ok(emitted.some(e=>e.payload.kind==='gap'));assert.ok(!emitted.some(e=>e.payload.kind==='response'));
 assert.equal((await original).bodyUsed,false);
});
