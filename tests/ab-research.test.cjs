const {test}=require('node:test'),assert=require('node:assert/strict');
const research=require('../tea_event_radar/ab-research.js'),catalog=require('../tea_event_radar/ab-research.json');
test('Dated research covers 15 visited sites and the earlier Volc console, stays historical and matches host boundaries',()=>{
 assert.equal(catalog.sites.length,16);
 for(const s of catalog.sites){assert.ok(s.sources.length&&s.observedAt&&s.productBackground&&s.observations&&s.limitations.length);assert.equal(s.currentEvidenceRequired,true);assert.equal(s.candidateTopics.hypothesisOnly,true);}
 assert.equal(research.match(catalog,'https://www.bilibili.com/').sites.length,1);
 assert.equal(research.match(catalog,'https://www.bilibili.com.evil.test/').sites.length,0);
 assert.equal(research.match(catalog,'https://chat.qwen.ai/').sites[0].id,'chat-qwen-ai');
 assert.equal(research.match(catalog,'https://www.qianwen.com/').sites[0].id,'www-qianwen-com');
});
