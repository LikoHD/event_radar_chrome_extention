/* A/B evidence normalization. Pure functions shared by worker and tests. */
(function (root) {
  'use strict';
  const siteProfiles=[
    ['B 站',['bilibili.com','biliapi.net']],['阿里 / 千问',['qwen.ai','qianwen.com','aliyun.com','taobao.com','tmall.com','alibaba.com']],
    ['字节 / 豆包',['doubao.com','douyin.com','bytedance.com','volcengine.com']],['腾讯 / 元宝',['yuanbao.tencent.com','tencent.com','qq.com']],
    ['智谱 / GLM',['z.ai','chatglm.cn','bigmodel.cn','zhipuai.cn']],['MiniMax',['minimax.io','minimaxi.com','hailuoai.com']],
    ['Kimi',['kimi.com','kimi.ai','moonshot.cn']],['DeepSeek',['deepseek.com']],['Gemini',['gemini.google.com','aistudio.google.com']],
    ['OpenAI',['chatgpt.com','openai.com']],['Claude',['claude.ai','anthropic.com']]
  ];
  function siteProfile(url){try{const host=new URL(url).hostname;const p=siteProfiles.find(([,domains])=>domains.some(d=>host===d||host.endsWith('.'+d)));return p?{name:p[0],host,basis:'域名背景；不能据此判断实验平台',support:'协议结构识别与通用线索兜底，非专有协议保证'}:null;}catch{return null;}}
  const platforms = {
    bilibili:'B 站自研分流', tencent:'腾讯配置下发 / TAB', glm:'智谱实验分组', doubao:'豆包 AB 参数服务', alitpp:'阿里 TPP 分桶线索',
    volc: '火山 DataTester', sensors: '神策 A/B Testing', quick: 'Quick Tracking',
    optimizely: 'Optimizely Web', growthbook: 'GrowthBook', posthog: 'PostHog',
    vwo: 'VWO', statsig: 'Statsig', abtasty: 'AB Tasty', launchdarkly: 'LaunchDarkly', unknown: '自研 / 未知'
  };
  const patterns = /ab_results|ab_split_num|tpp_buckets|expData|sGrayPolicyId|experimental\/groups|rdelivery\.qq|ab\.chatgpt\.com|dynamic_configs|feature_gates|layer_configs|expIds|ab_bucket|ab_config|abTest|abtest|ab_test|ab_version|abVersion|ab_params|exp_id|experiment|variation|variant|feature.?flag|ab_sdk_version|qt_abtest|optimizely|growthbook|statsig|abtasty|launchdarkly|visualwebsiteoptimizer|wingify|volceapplog|tab\.volces/i;
  const sensitive = /authorization|cookie|password|secret|token|api.?key|email|phone|mobile|address/i;
  const identity = /^(user(_unique)?_?id|distinct_?id|anonymous_?id|device_?id|web_?id|ssid|stable_?id|bucketing_?id|uuid|uid|hashValue|visitor_?id|session_?id|\$distinct_id|\$device_id|\$user_id|\$opt_bucketing_id)$/i;
  const safeURL = value => { try { const u = new URL(value); return u.origin + u.pathname.replace(/[\w.-]+@[\w.-]+/g, '[redacted]').replace(/\b\d{6,}\b/g, '[id]'); } catch { return ''; } };
  function parse(value) {
    if (typeof value !== 'string') return value;
    try { return JSON.parse(value); } catch {}
    if (value.includes('=')) return Object.fromEntries(new URLSearchParams(value));
    return value.slice(0, 4000);
  }
  function walk(value, fn, path = '$', parent = {}, depth = 0, budget = {n: 0}) {
    if (depth > 10 || ++budget.n > 20000) return;
    if (typeof value === 'string' && /^[\[{]/.test(value.trim())) value = parse(value);
    if (!value || typeof value !== 'object') return;
    fn(value, path, parent);
    Object.entries(value).slice(0, 1000).forEach(([k, v]) => {
      if (!['__proto__', 'constructor', 'prototype'].includes(k)) walk(v, fn, path + '.' + k, value, depth + 1, budget);
    });
  }
  function detect(e) {
    const text = JSON.stringify(e.data || {});
    if(/"ab_version"/.test(text)&&/"ab_split_num"/.test(text))return 'bilibili';
    if(/"sGrayPolicyId"|sGrayPolicyId/.test(text)&&/expData|assignment/.test(text))return 'tencent';
    if(/\/experimental\/groups(?:[/?]|$)/.test(e.url||'')&&/"group_names"/.test(text))return 'glm';
    if(/\/samantha\/user\/ab\/get(?:[/?]|$)/.test(e.url||'')&&/"ab_results"/.test(text))return 'doubao';
    if(/"tpp_buckets"/.test(text))return 'alitpp';
    if (/ab_sdk_version|abtest_config|abtest_exposure|LogAnalyticsObject|TeaAnalyticsObject/.test(text + e.url)) return 'volc';
    if (/SensorsABTest|\$ABTestTrigger|\$abtest_experiment/.test(text)) return 'sensors';
    if (/qt_abtest/.test(text) || /"expid"/.test(text) && /"gid"/.test(text)) return 'quick';
    const all = (e.url || '') + ' ' + text.slice(0, 65536);
    if (/optimizely/i.test(all)) return 'optimizely';
    if (/growthbook/i.test(all)) return 'growthbook';
    if (/\$feature_flag|posthog/i.test(all)) return 'posthog';
    if (/visualwebsiteoptimizer|wingify|_vwo|vwo_campaign/i.test(all)) return 'vwo';
    if (/statsig/i.test(all) || /"dynamic_configs"/.test(text)&&/"feature_gates"/.test(text)) return 'statsig';
    if (/abtasty/i.test(all)) return 'abtasty';
    if (/launchdarkly/i.test(all)) return 'launchdarkly';
    return 'unknown';
  }
  function compact(value) {
    const serialized=JSON.stringify(value);
    return serialized && serialized.length>8192 ? {truncated:true,fieldNames:Object.keys(value||{}).slice(0,30)} : value;
  }
  function normalize(e) {
    e.data = parse(e.data);
    const provider = detect(e), found = [], ids = {}, scope = {};
    walk(e.data, o => { for (const [k,v] of Object.entries(o)) {
      if (identity.test(k) && ['string','number'].includes(typeof v)) ids[k] = String(v);
      if (/^(app_id|appKey|project_id|projectId|environment|clientKey)$/.test(k) && ['string','number'].includes(typeof v)) scope[k] = String(v);
    }});
    try { for (const [k,v] of new URL(e.url).searchParams) if (/^(app_id|appKey|project_id|projectId|environment|clientKey)$/.test(k)) scope[k]=v; } catch {}
    if(e.requestContext?.app_id!=null)scope.app_id=String(e.requestContext.app_id);
    const project = Object.entries(scope).sort().map(([k,v]) => k + '=' + v).join('|') || '未知项目';
    function add(o, path, experiment, variant, confidence, name, params) {
      const exp = experiment === undefined || experiment === null || experiment === '' ? null : String(experiment);
      const ver = variant === undefined || variant === null || variant === '' ? null : String(variant);
      const event = o.event || o.event_name || o.name || '';
      found.push({provider, project, experimentId: exp, variantId: ver, confidence,
        name: String(name || exp || ver || path), path, parameters: compact(params || Object.fromEntries(Object.entries(o).filter(([k]) => /^(value|values|variables|parameters|params|payload|variations|variants|groups|group_name|groupName|settings|config|treatment|control|ab_|expIds|bucket|weights|coverage|hashAttribute|hashValue|inExperiment|is_control|isControl|expid|gid|vid|ab_sdk_version|experiment_?id|variant_?id|variation_?id|\$abtest_|\$feature)/i.test(k)))), identities: ids,
        role: o.is_control === true || o.isControl === true ? '对照组（明确标记）' : '未知',
        phase: e.kind === 'request' && /abtest_config/.test(e.url||'') ? '分流请求（携带已有版本）' : e.kind === 'response' ? '配置' : e.kind === 'snapshot' ? '状态快照' : /exposure|ABTestTrigger|feature_flag_called|campaign_activated/i.test(String(event)) ? '曝光' : '上报',
        event: String(event), layer: o.layer_id || o.layerId || null});
    }
    walk(e.data, (o, path, parent) => {
      if(provider==='bilibili' && o.ab_version && typeof o.ab_version==='object' && o.ab_split_num){
        for(const [key,value] of Object.entries(o.ab_version))add({},path+'.ab_version.'+key,null,null,'suspected',key,{ab_version:value,ab_split_num:o.ab_split_num[key],home_version:o.home_version,in_new_ab:o.in_new_ab});
      }
      if(provider==='tencent' && o.key && o.bizContent?.tab?.expData){
        const x=parse(o.bizContent.tab.expData);
        if(x&&typeof x==='object'&&typeof x.expName==='string'&&typeof x.assignment==='string')add({},path,x.expName,x.assignment,'confirmed',x.expName,{config_key:o.key,value:o.value,decoded_value:parse(o.value),expData:x,conditionID:o.bizContent.tab.conditionID,hitSubTaskID:o.report?.hitSubTaskID});
      }
      if(provider==='glm' && Array.isArray(o.group_names))for(const raw of o.group_names){
        if(typeof raw!=='string')continue;const match=raw.match(/^([^:]+):(exp|control):(.+)$/);
        if(match)add({is_control:match[2]==='control'},path+'.group_names',match[1],match[3],'confirmed',match[1],{group_name:raw,role_marker:match[2]});
      }
      if(provider==='doubao' && o.ab_results && typeof o.ab_results==='object')for(const [key,value] of Object.entries(o.ab_results)){
        if(value!==''&&value!==null)add({},path+'.ab_results.'+key,null,null,'suspected',key,{ab_results:{[key]:value}});
      }
      if(provider==='alitpp' && typeof o.tpp_buckets==='string' && o.tpp_buckets)add({},path+'.tpp_buckets',null,null,'suspected','tpp_buckets',{tpp_buckets:o.tpp_buckets,note:'保留不透明分桶串；未推断井号各段为实验 ID 或流量比例'});
      if(provider==='growthbook' && o.features && typeof o.features==='object')for(const [key,feature] of Object.entries(o.features)){
        if(feature && Object.hasOwn(feature,'defaultValue'))add({},path+'.features.'+key,null,null,'suspected',key,{feature_key:key,defaultValue:feature.defaultValue,rules:feature.rules});
      }

      if (Array.isArray(o)) return;
      if (provider === 'volc') {
        if (Array.isArray(o.events) && o.header?.ab_sdk_version) {
          for (const event of o.events) for (const vid of String(o.header.ab_sdk_version).split(',').filter(Boolean))
            add({...event,ab_sdk_version:o.header.ab_sdk_version},path+'.events',null,vid.trim(),'confirmed');
        }
        if (o.vid != null && (Object.hasOwn(o, 'value') || Object.hasOwn(o, 'val'))) add(o, path, o.experiment_id, o.vid, 'confirmed', path.split('.').pop(), {...(Object.hasOwn(o,'val')?{val:o.val}:{}),...(Object.hasOwn(o,'value')?{value:o.value}:{}),vid:o.vid});
        if (o.ab_sdk_version) for (const vid of String(o.ab_sdk_version).split(',').filter(Boolean)) add({...parent,...o}, path, o.experiment_id, vid.trim(), 'confirmed');
      } else if (provider === 'sensors' && o.$abtest_experiment_id) {
        add({...parent,...o}, path, o.$abtest_experiment_id, o.$abtest_experiment_group_id, 'confirmed');
      } else if (provider === 'quick' && o.expid && o.gid != null) {
        add(o, path, o.expid, o.gid, 'confirmed', o.param_name, {value:o.value});
      } else if (provider === 'optimizely' && (o.experiment_id || o.experimentName !== undefined && o.id)) {
        add(o, path, o.experiment_id || o.id, o.variation_id || o.variation?.id, 'confirmed', o.experimentName);
      } else if (provider === 'growthbook') {
        if ((o.experimentId || o.experiment_id) && (o.variationId != null || o.variation_id != null)) add(o, path, o.experimentId || o.experiment_id, o.variationId ?? o.variation_id, 'confirmed');
        if (o.experiment?.key && o.result) add(o, path, o.experiment.key, o.result.key ?? o.result.variationId, 'confirmed', o.experiment.name, o.result);
        if ((o.key || o.trackingKey) && Array.isArray(o.variations)) add(o, path, o.key || o.trackingKey, null, 'confirmed', o.name, {variations:o.variations});
      } else if (provider === 'posthog' && o.$feature_flag) {
        add({...parent,...o}, path, o.$feature_flag, o.$feature_flag_response, o.$feature_flag_has_experiment === true ? 'confirmed' : 'suspected');
      } else if (provider === 'vwo' && (o.experiment_id || o.campaignId || o.campaign_id)) {
        add(o, path, o.experiment_id || o.campaignId || o.campaign_id, o.variation_id ?? o.variationId, 'confirmed');
      } else if (provider === 'statsig' && (o.experimentName || o.experiment_name)) {
        add(o, path, o.experimentName || o.experiment_name, o.groupName || o.ruleID || o.rule_id, 'confirmed');
      } else if (provider === 'abtasty' && o.testId) {
        add(o, path, o.testId, o.variationId, 'confirmed');
      } else if (provider === 'launchdarkly' && o.key && (o.variation != null || o.value != null)) {
        add(o, path, o.key, o.variation, o.reason?.inExperiment === true ? 'confirmed' : 'suspected');
      }
      if(provider==='statsig' && /\.(dynamic_configs|layer_configs)\.[^.]+$/.test(path)){
        const name=o.name||path.split('.').pop();
        add(o,path,name,o.group_name??o.rule_id,o.is_experiment_active===true||o.is_user_in_experiment===true?'confirmed':'suspected',name,{value:o.value,group_name:o.group_name,rule_id:o.rule_id,is_experiment_active:o.is_experiment_active,is_user_in_experiment:o.is_user_in_experiment});
      }
      if (provider === 'unknown' && (o.experiment_id || o.experimentId || o.exp_id || o.ab_test || o.abtest || o.ab_version || o.abVersion || o.ab_params))
        add(o, path, o.experiment_id || o.experimentId || o.exp_id, o.variant_id ?? o.variation_id ?? o.ab_version ?? o.abVersion, 'suspected',null,Object.fromEntries(Object.entries(o).filter(([k])=>patterns.test(k)||/^(group_?id|expid|gid|bucket|value|values|settings|config|params|parameters|is_control|isControl)$/i.test(k))));
    });
    // Retain unfamiliar structured experiment fields without promoting them to confirmed experiments.
    if(!found.length)walk(e.data,(o,path)=>{
      if(Array.isArray(o))return;
      for(const [k,v] of Object.entries(o))if(/^(ab_?(test|config|params|versions?|bucket)|experiment(s|_ids?)?|expIds|feature_gates|dynamic_configs|layer_configs|variants?)$/i.test(k))
        add({},path+'.'+k,null,null,'suspected',k,{[k]:compact(v)});
    });
    if(!found.length && /ab.?test|ab_results|ab_split_num|ab.?version|ab_params|exp_id|experiment|feature.?flag|dynamic_configs|sGrayPolicyId|tpp_buckets/i.test(JSON.stringify(e.data)))add({},'$',null,null,'suspected','未解析实验线索',{candidate:compact(e.data)});
    return {provider, records: found};
  }
  function session(tabId, origin, active = false) {
    return {id: crypto.randomUUID(), tabId, origin, active, startedAt: Date.now(), revision:0, records:{}, evidence:[], providers:[], truncated:false,
      coverage:['仅统计本次可见证据；未发现不代表没有实验。','初始化前请求、Worker、不可读响应和纯服务端实验可能不可见。'], ai:null};
  }
  function ingest(s, e) {
    if (s.evidence.some(x => x.id === e.id)) return false;
    const {provider, records} = normalize(e);
    if (!records.length && provider === 'unknown') return false;
    if (provider !== 'unknown' && !s.providers.includes(provider)) s.providers.push(provider);
    e.provider = provider;
    s.evidence.push(e);
    for (const item of records) {
      const type = item.confidence === 'suspected' ? 'suspected' : item.experimentId ? 'experiment' : 'version';
      const key = JSON.stringify([provider,item.project,type,item.experimentId || item.variantId || item.name]);
      let r = s.records[key];
      if (!r) r = s.records[key] = {...item,key,type,firstSeen:e.time,lastSeen:e.time,variants:[],history:[],evidenceIds:[],exposures:0};
      r.lastSeen = e.time;
      if(['bilibili','doubao'].includes(provider)){r.parameterNames=[item.name];}
      if(provider==='volc' && (Object.hasOwn(item.parameters||{},'val')||Object.hasOwn(item.parameters||{},'value'))){
        r.parameterNames=r.parameterNames||[];if(!r.parameterNames.includes(item.name))r.parameterNames.push(item.name);r.name=r.parameterNames.join(' / ');
      }
      if (item.role !== '未知') r.role = item.role;
      if (item.variantId != null && !r.variants.includes(item.variantId)) { if(r.variants.length<1000)r.variants.push(item.variantId);else s.truncated=true; }
      const isNewEvidence = !r.evidenceIds.includes(e.id);
      if (isNewEvidence) r.evidenceIds.push(e.id);
      if (!r.history.some(h => h.evidenceId === e.id && h.path === item.path && h.variantId === item.variantId)) {
        r.history.push({evidenceId:e.id,time:e.time,phase:item.phase,variantId:item.variantId,identities:item.identities,parameters:item.parameters,path:item.path,event:item.event,frameId:e.frameId,url:e.url});
        if (item.phase === '曝光' && !r.history.slice(0,-1).some(h => h.evidenceId === e.id && h.phase === '曝光')) r.exposures++;
      }
      if (r.history.length > 100) { r.history.shift(); r.historyTruncated = true; }
      if (r.evidenceIds.length > 1000) r.evidenceIds.shift();
    }
    // Keep a bounded store even when individual payloads are large.
    let bytes = s.evidence.reduce((n,x) => n + JSON.stringify(x).length * 2,0);
    while (s.evidence.length > 1000 || bytes > 2 * 1024 * 1024) { bytes -= JSON.stringify(s.evidence.shift()).length * 2; s.truncated = true; }
    if (Object.keys(s.records).length > 2000) { delete s.records[Object.keys(s.records)[0]]; s.truncated = true; }
    s.revision++;
    return true;
  }
  function counts(s) {
    const r = Object.values(s.records);
    return {platforms:s.providers.length,experiments:r.filter(x=>x.type==='experiment').length,versions:r.filter(x=>x.type==='version').length,suspected:r.filter(x=>x.type==='suspected').length};
  }
  function warnings(r) {
    const out=[];
    if (!r.exposures) out.push('尚未观察到曝光');
    if (r.exposures > 1) out.push('重复观察到曝光（不直接判定错误）');
    if (r.variants.length > 1) out.push('版本发生变化或存在多个变体；查看时间线');
    const seenIdentities = {}; let identityChanged = false;
    for (const h of r.history) for (const [key,value] of Object.entries(h.identities || {})) {
      if (seenIdentities[key] !== undefined && seenIdentities[key] !== value) identityChanged = true;
      seenIdentities[key] = value;
    }
    if (identityChanged) out.push('观察到身份变化');
    const config = r.history.filter(x=>x.phase==='配置' && x.variantId).map(x=>x.variantId);
    if (config.length && r.history.some(x=>['曝光','上报'].includes(x.phase) && x.variantId && !config.includes(x.variantId))) out.push('配置与上报版本存在差异；请核对时间和身份');
    return out;
  }
  function redact(value, aliases = new Map(), key = '', depth = 0) {
    if (depth > 15) return '[depth limit]';
    if (sensitive.test(key)) return '[redacted]';
    if (identity.test(key) || key === 'identities') {
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,redact(v,aliases,k,depth+1)]));
      const id=String(value); if (!aliases.has(id)) aliases.set(id,'身份-'+(aliases.size+1)); return aliases.get(id);
    }
    if (Array.isArray(value)) return value.map(v=>redact(v,aliases,key,depth+1));
    if (value && typeof value==='object') return Object.fromEntries(Object.entries(value).filter(([k])=>!['__proto__','prototype','constructor','aiKey'].includes(k)).map(([k,v])=>[k,redact(v,aliases,k,depth+1)]));
    if (typeof value==='string') {
      if (/^[\[{]/.test(value.trim())) { try { return redact(JSON.parse(value),aliases,key,depth+1); } catch {} }
      if (/url|origin/i.test(key) || /^https?:\/\//.test(value)) return safeURL(value);
      return value.replace(/sk-[a-z0-9_-]{16,}/gi,'[secret]').replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi,'[email]').replace(/\b1[3-9]\d{9}\b/g,'[phone]').slice(0,4000);
    }
    return value;
  }
  function snapshot(s, key) {
    const records=Object.values(s.records).filter(r=>!key || r.key===key);
    const aliases=new Map(Object.entries(s.identityAliases || {}));
    const configurationKeys=[...new Set(records.flatMap(r=>r.parameterNames||[]))];
    const data = {observationSummary:{configurationKeys,configurationParameterCount:configurationKeys.length,reportedVersions:[...new Set(records.flatMap(r=>r.history.filter(h=>h.phase==='上报'||h.phase==='曝光').map(h=>h.variantId).filter(Boolean)))],note:'参数数、版本数不等于实验数；普通事件携带版本不等于曝光'},sessionId:s.id,revision:s.revision,origin:s.origin,pageTitle:s.pageTitle||'',counts:counts(s),coverage:s.coverage,truncated:s.truncated,
      records:records.map(r=>({...r,history:r.history.slice(-15),warnings:warnings(r)})),
      evidence:s.evidence.filter(e=>records.some(r=>r.evidenceIds.includes(e.id)) || !key && e.data?.sdkEvidence).map(e=>({id:e.id,url:e.url,pageURL:e.pageURL||s.origin,time:e.time,kind:e.kind,frameId:e.frameId,status:e.status,provider:e.provider}))};
    const clean=redact(data,aliases); clean.sessionId=s.id; s.identityAliases=Object.fromEntries(aliases); return clean;
  }
  root.ABRadar = {siteProfile,platforms,patterns,parse,walk,detect,normalize,session,ingest,counts,warnings,redact,snapshot,safeURL};
  if (typeof module !== 'undefined') module.exports=root.ABRadar;
})(globalThis);
