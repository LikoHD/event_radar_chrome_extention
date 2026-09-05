const {test}=require('node:test'),assert=require('node:assert/strict');
const A=require('../tea_event_radar/ab-core.js'),{fixtures}=require('./fixtures/sites-observed-2026-09-05.json');
function observe(name){const f=structuredClone(fixtures[name]),s=A.session(1,new URL(f.source).origin);A.ingest(s,{id:name,url:f.source,data:f.data,kind:f.kind,requestContext:f.requestContext,time:1,frameId:0});return s;}
test('Bilibili bootstrap keeps opaque split numbers without invented experiment IDs',()=>{
 const s=observe('bilibili');assert.equal(A.counts(s).suspected,2);assert.equal(A.counts(s).experiments,0);assert.equal(s.providers[0],'bilibili');
 assert.ok(Object.values(s.records).some(r=>r.parameters.ab_version==='V8'&&r.parameters.ab_split_num===125));
});
test('Tencent nested expData maps three named experiments, not every remote setting',()=>{
 const s=observe('yuanbao');assert.equal(A.counts(s).experiments,3);assert.equal(s.providers[0],'tencent');
 const r=Object.values(s.records).find(r=>r.experimentId==='exp_asr_web_voice_input');assert.equal(r.variantId,'exp_asr_web_voice_input_A');assert.equal(r.role,'未知');assert.equal(r.parameters.expData.bucket,62370);
});
test('GLM experimental/groups preserves explicit control marker and 23 names',()=>{
 const s=observe('chatglm');assert.equal(A.counts(s).experiments,23);const r=Object.values(s.records).find(r=>r.experimentId==='drawing_server_hi_dream');assert.equal(r.role,'对照组（明确标记）');assert.equal(r.variantId,'A');
});
test('Doubao AB results are clues; DataTester VIDs remain unassigned versions',()=>{
 const s=observe('doubao');assert.equal(A.counts(s).suspected,6);assert.equal(A.counts(s).experiments,0);assert.equal(Object.values(s.records).find(r=>r.name==='ai_doc_ssr_config_reuse').parameters.ab_results.ai_doc_ssr_config_reuse,'true');
 const d=observe('doubao_datatester');assert.equal(A.counts(d).versions,5);assert.ok(Object.values(d.records).every(r=>r.project==='app_id=497858'));
 assert.equal(A.counts(observe('kimi')).versions,15);assert.equal(A.counts(observe('douyin')).versions,3);
});
test('Taobao TPP bucket string is not split into fictional experiments',()=>{const s=observe('taobao');assert.equal(A.counts(s).experiments,0);assert.equal(A.counts(s).suspected,1);assert.match(Object.values(s.records)[0].parameters.tpp_buckets,/#/);});
test('Claude defaults, inactive Statsig and MiniMax model variants are conservative',()=>{
 const c=observe('claude');assert.equal(A.counts(c).experiments,0);assert.ok(A.counts(c).suspected>0);assert.ok(Object.values(c.records).every(r=>r.role==='未知'));
 const o=observe('openai');assert.equal(A.counts(o).experiments,1);assert.equal(A.counts(o).suspected,3);
 assert.equal(observe('minimax_negative').evidence.length,0);
});
test('488-field DataTester response is not silently cut off at old 200-node limit',()=>{
 const s=A.session(1,'https://www.douyin.com');const data={data:Object.fromEntries(Array.from({length:488},(_,i)=>['p'+i,{val:i%2===0,vid:String(1000+i)}]))};
 A.ingest(s,{id:'large',url:'https://www.douyin.com/service/2/abtest_config/',kind:'response',data,time:1,frameId:0});assert.equal(A.counts(s).versions,488);assert.equal(A.snapshot(s).observationSummary.configurationParameterCount,488);
});
test('Oversize vendor metadata gives platform evidence without an invented experiment',()=>{
 const s=A.session(1,'https://openai.com');A.ingest(s,{id:'sdk',url:'https://ab.chatgpt.com/v1/initialize',kind:'snapshot',data:{sdkEvidence:{statsig:'initialize endpoint'}},time:1,frameId:0});
 assert.deepEqual(A.counts(s),{platforms:1,experiments:0,versions:0,suspected:0});assert.equal(A.snapshot(s).evidence[0].id,'sdk');
});
