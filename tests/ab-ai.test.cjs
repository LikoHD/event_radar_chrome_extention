const {test}=require('node:test');const assert=require('node:assert/strict');const AI=require('../tea_event_radar/ab-ai.js');
const settings={baseURL:'https://api.test/v1',model:'deepseek-v4-flash',apiKey:'test-only'};
const snapshot={evidence:[{id:'e1'}]};const valid={findings:[{type:'hypothesis',text:'可能测试布局',confidence:'low',evidenceIds:['e1']}],missingEvidence:[],nextChecks:[]};
test('Endpoint normalization and HTTPS validation',()=>{
 assert.equal(AI.endpoint('https://api.test/v1/'),'https://api.test/v1/chat/completions');
 assert.equal(AI.endpoint('https://api.deepseek.com'),'https://api.deepseek.com/chat/completions');
 for(const u of ['http://api.test','https://user:pass@api.test','https://api.test?key=x'])assert.throws(()=>AI.endpoint(u));
});
test('Mock completion sends chosen model and validates response',async()=>{
 const result=await AI.complete(settings,snapshot,undefined,async(url,req)=>{
 assert.equal(url,'https://api.test/v1/chat/completions');assert.equal(JSON.parse(req.body).model,'deepseek-v4-flash');assert.equal(req.headers.Authorization,'Bearer test-only');
 return{ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(valid)}}]})};});assert.deepEqual(result,valid);
});
test('Missing key, status errors and invalid JSON do not succeed',async()=>{
 await assert.rejects(AI.complete({},snapshot),/API Key/);
 for(const code of [401,429,500])await assert.rejects(AI.complete(settings,snapshot,undefined,async()=>({ok:false,status:code})),new RegExp(String(code)));
 await assert.rejects(AI.complete(settings,snapshot,undefined,async()=>({ok:true,json:async()=>({choices:[{message:{content:'not json'}}]})})),/JSON/);
});
test('Unsupported evidence and malformed confidence are rejected',()=>{
 assert.throws(()=>AI.validate({...valid,findings:[{...valid.findings[0],evidenceIds:['imaginary']}]},['e1']),/证据/);
 assert.throws(()=>AI.validate({...valid,findings:[{...valid.findings[0],confidence:'certain'}]},['e1']));
});
test('Abort signal is propagated to provider',async()=>{
 const c=new AbortController();c.abort();await assert.rejects(AI.complete(settings,snapshot,c.signal,async(u,r)=>{r.signal.throwIfAborted();}));
});
test('Fenced JSON works; truncation and empty replies have actionable errors',async()=>{
 const reply=(content,finish_reason)=>async()=>({ok:true,json:async()=>({choices:[{finish_reason,message:{content}}]})});
 assert.deepEqual(await AI.complete(settings,snapshot,undefined,reply('```json\n'+JSON.stringify(valid)+'\n```')),valid);
 await assert.rejects(AI.complete(settings,snapshot,undefined,reply('{','length')),/截断/);
 await assert.rejects(AI.complete(settings,snapshot,undefined,reply(' ')),/空内容/);
});
test('Experiment estimates validate bounds and evidence; official DeepSeek disables thinking',async()=>{
 for(const e of [{minimum:2,maximum:1,text:'x',evidenceIds:['e1']},{minimum:1,maximum:1,text:'x',evidenceIds:[]}])assert.throws(()=>AI.validate({...valid,experimentEstimate:e},['e1']));
 await AI.complete({...settings,baseURL:AI.defaults.baseURL},snapshot,undefined,async(u,r)=>{const b=JSON.parse(r.body);assert.equal(b.thinking.type,'disabled');assert.match(b.messages[0].content,/HTML/);return{ok:true,json:async()=>({choices:[{message:{content:JSON.stringify(valid)}}]})};});
});
