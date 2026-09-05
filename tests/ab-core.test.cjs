const {test}=require('node:test');const assert=require('node:assert/strict');
const A=require('../tea_event_radar/ab-core.js');
let n=0;function evidence(data,url='https://site.test/api',kind='request'){return{id:'e'+(++n),data,url,kind,time:Date.now(),frameId:0};}
function collect(data,url,kind){const s=A.session(1,'https://site.test');A.ingest(s,evidence(data,url,kind));return s;}
test('Volc VID is not experiment ID and repeated exposure remains one version',()=>{
 const s=collect({data:{title:{vid:'12',value:'new'},color:{vid:'12',value:'red'}}},'https://private.test/abtest_config','response');
 assert.deepEqual(A.counts(s),{platforms:1,experiments:0,versions:1,suspected:0});
 const r=Object.values(s.records)[0];assert.equal(r.history.length,2);
 A.ingest(s,evidence({event:'abtest_exposure',params:{ab_sdk_version:'12'}}));
 A.ingest(s,evidence({event:'abtest_exposure',params:{ab_sdk_version:'12'}}));
 assert.equal(A.counts(s).versions,1);assert.equal(r.exposures,2);
});
test('Sensors fields, identity changes and explicit control',()=>{
 const s=collect({event:'$ABTestTrigger',distinct_id:'a',properties:{$abtest_experiment_id:'10',$abtest_experiment_group_id:'20',is_control:true}});
 A.ingest(s,evidence({event:'$ABTestTrigger',distinct_id:'b',properties:{$abtest_experiment_id:'10',$abtest_experiment_group_id:'21'}}));
 assert.equal(A.counts(s).experiments,1);assert.equal(Object.values(s.records)[0].role,'对照组（明确标记）');
 assert.ok(A.warnings(Object.values(s.records)[0]).some(x=>x.includes('身份')));
});
test('Quick Tracking expid/gid; empty defaults are not experiments',()=>{
 assert.equal(A.counts(collect({expid:122,gid:218,value:'red'})).experiments,1);
 assert.equal(A.counts(collect({expid:'',gid:'',value:false})).experiments,0);
});
test('Known platform fixtures (documented shapes, not live-site claims)',()=>{
 const fixtures=[
 [{optimizely:{'10':{id:'10',experimentName:'Checkout',variation:{id:'20'}}}},'optimizely'],
 [{growthbook:{experiment:{key:'checkout'},result:{key:'compact',inExperiment:true}}},'growthbook'],
 [{event:'$feature_flag_called',properties:{$feature_flag:'checkout',$feature_flag_response:'test',$feature_flag_has_experiment:true}},'posthog'],
 [{_vwo:{campaignId:'10',variationId:2}},'vwo'],
 [{statsig:{experimentName:'checkout',ruleID:'20'}},'statsig'],
 [{ABTasty:{testId:'10',variationId:'20'}},'abtasty'],
 [{launchdarkly:{key:'checkout',variation:1,reason:{inExperiment:true}}},'launchdarkly']
 ];for(const [data,p]of fixtures){const s=collect(data);assert.equal(s.providers[0],p);assert.equal(A.counts(s).experiments,1,p);}
});
test('Plain flags and generic group ID never become confirmed experiments',()=>{
 for(const data of [{group_id:1},{event:'pageview'},{posthog:{featureFlags:{darkmode:true}}},{launchdarkly:{key:'darkmode',variation:0}},{properties:{$feature_flag:'darkmode',$feature_flag_response:false}}])assert.equal(A.counts(collect(data)).experiments,0);
 assert.equal(A.counts(collect({experiment_id:'123',variant_id:'b'})).suspected,1);
});
test('Different projects remain separate, evidence IDs deduplicate',()=>{
 const s=collect({app_id:1,expid:10,gid:20});const e=evidence({app_id:2,expid:10,gid:20});A.ingest(s,e);A.ingest(s,e);
 assert.equal(A.counts(s).experiments,2);assert.equal(s.evidence.length,2);
});
test('Redaction removes credentials and preserves stable identity aliases',()=>{
 const r=A.redact({authorization:'Bearer x',apiKey:'abc',cookie:'x',distinct_id:'same',identities:{user_id:'same'},url:'https://x.test/p?token=x#secret',value:'a@b.com 13812345678'});
 assert.equal(r.authorization,'[redacted]');assert.equal(r.distinct_id,r.identities.user_id);assert.equal(r.url,'https://x.test/p');assert.ok(!JSON.stringify(r).includes('13812345678'));
});
test('Bounded evidence retains counts and announces truncation',()=>{
 const s=A.session(1,'https://x.test');for(let i=0;i<1010;i++)A.ingest(s,evidence({expid:1,gid:2,value:i}));
 assert.equal(s.evidence.length,1000);assert.ok(s.truncated);assert.equal(A.counts(s).experiments,1);
});
test('Snapshot excludes raw arbitrary request data',()=>{
 const s=collect({expid:1,gid:2,value:'red',unrelated_private_text:'do not send'});const snap=A.snapshot(s);
 assert.ok(!JSON.stringify(snap).includes('do not send'));assert.equal(snap.counts.experiments,1);
});

test('Missing identity in configuration is not an identity change',()=>{
 const s=collect({data:{title:{vid:'12',value:'new'}}},'https://private.test/abtest_config','response');
 A.ingest(s,evidence({event:'abtest_exposure',user_unique_id:'person',params:{ab_sdk_version:'12'}}));
 assert.ok(!A.warnings(Object.values(s.records)[0]).some(x=>x.includes('身份变化')));
});
test('Volc batch header version associates exposure events without an experiment ID',()=>{
 const s=collect([{header:{ab_sdk_version:'1,2'},user:{user_unique_id:'u'},events:[{event:'abtest_exposure',params:{}}]}]);
 assert.equal(A.counts(s).experiments,0);assert.equal(A.counts(s).versions,2);for(const r of Object.values(s.records))assert.equal(r.exposures,1);
});
test('Domestic and AI site profiles use domain boundaries and never assign an experiment platform',()=>{
 for(const host of ['bilibili.com','chat.qwen.ai','www.qianwen.com','www.doubao.com','yuanbao.tencent.com','chat.z.ai','chatglm.cn','agent.minimax.io','gemini.google.com','chatgpt.com','claude.ai']){
  assert.ok(A.siteProfile('https://'+host));assert.equal(A.detect({url:'https://'+host,data:{}}),'unknown');
 }
 assert.equal(A.siteProfile('https://chatgpt.com.attacker.test'),null);
});
test('Statsig private host maps separate experiments from ordinary feature gates',()=>{
 const s=collect({feature_gates:{dark_mode:{value:true}},dynamic_configs:{hashed_name:{name:'hashed_name',is_experiment_active:true,group_name:'Treatment',value:{new_composer:true}},ordinary:{value:{limit:5}}}},'https://private.test/init','response');
 assert.equal(A.counts(s).experiments,1);assert.equal(A.counts(s).suspected,1);
});
test('Unknown experiment structures stay inspectable without inflating confirmed counts',()=>{
 for(const data of [{ab_config:{expIds:['x'],bucket:'B',settings:{new_ui:true}}},{experiment_assignment:{opaque:'123'}},{abVersion:'a'}]){const s=collect(data);assert.ok(s.evidence.length);assert.ok(A.counts(s).suspected);assert.equal(A.counts(s).experiments,0);}
 assert.equal(collect({group_id:123,model:'GLM',version:4}).evidence.length,0);
});
test('Observed Volc console val/vid configuration joins event-level versions within app scope',()=>{
 const f=require('./fixtures/volc-console-observed.json');const s=A.session(1,'https://console.volcengine.com');
 // Reports may arrive first; the later config must enrich the same record.
 for(const report of f.reports)for(const batch of report.batches)A.ingest(s,evidence([{header:{app_id:batch.app_id},events:batch.events}],'https://mcs.zijieapi.com/list'));
 const config=evidence(f.config,'https://abtestvm.bytedance.com/service/2/abtest_config/','response');config.requestContext=f.requestContext;A.ingest(s,config);
 assert.equal(A.counts(s).experiments,0);assert.equal(A.counts(s).versions,11);
 const r=Object.values(s.records).find(r=>r.variants.includes('92428570'));assert.equal(r.name,'search_ai_mode');assert.equal(r.project,'app_id=3569');assert.equal(r.exposures,0);assert.equal(r.role,'未知');
 assert.ok(r.history.some(h=>h.parameters.val==='exp_grp'));assert.ok(r.history.some(h=>h.phase==='上报'&&h.event==='predefine_pageview'));
 assert.equal(A.snapshot(s).observationSummary.configurationParameterCount,11);
 const another=evidence([{header:{app_id:15001},events:[{event:'predefine_pageview',ab_sdk_version:'92428570'}]}],'https://mcs.zijieapi.com/list');A.ingest(s,another);assert.equal(A.counts(s).versions,12);
});
test('Volc allocation request carrying an old version is not an exposure',()=>{
 const s=collect({header:{app_id:3569,ab_sdk_version:'old'}},'https://abtestvm.bytedance.com/service/2/abtest_config/');
 assert.equal(Object.values(s.records)[0].history[0].phase,'分流请求（携带已有版本）');assert.equal(Object.values(s.records)[0].exposures,0);
});
