(() => {
  'use strict';
  const $=id=>document.getElementById(id);
  let current=null,visible=false,sub='records',search='',platform='',refreshTimer,busy=false,controlBusy=false,requestGeneration=0;
  const openCards=new Set(), summaryOpen=new Set(['platforms']);
  let cancelRequested=false, busyTab=null;
  async function rpc(action,extra={}) {
    const res=await chrome.runtime.sendMessage({action:'ab:'+action,...extra});
    if(!res)throw Error('插件后台无响应，请重新加载插件');
    if(res.error)throw Error(res.error);return res;
  }
  function node(tag,text,className) {const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;}
  function button(text,fn,parent,className) {const b=node('button',text,className);b.type='button';b.onclick=()=>Promise.resolve().then(fn).catch(error);parent.append(b);return b;}
  function error(e){$('abMessage').textContent=e.message||String(e);}
  function clearError(){$('abMessage').textContent='';}
  function switchTab(ab){visible=ab;document.body.classList.toggle('ab-mode',ab);$('abTab').setAttribute('aria-selected',String(ab));$('eventsTab').setAttribute('aria-selected',String(!ab));$('abTab').tabIndex=ab?0:-1;$('eventsTab').tabIndex=ab?-1:0;if(ab)run('enter').catch(error);}
  async function run(action){
    if(controlBusy)return;controlBusy=true;++requestGeneration;clearError();
    for(const id of ['abToggle','abRefresh','abClear'])$(id).disabled=true;
    try{const result=await rpc(action,current?{tabId:current.tabId}:{});if(result.session){current=result.session;render();}}
    finally{controlBusy=false;for(const id of ['abToggle','abRefresh','abClear'])$(id).disabled=false;}
  }
  async function refresh(){if(!visible||controlBusy)return;const generation=++requestGeneration;try{const result=await rpc('get');if(generation!==requestGeneration)return;current=result.session;render();}catch(e){error(e);}}
  function details(parent,title,value){const d=node('details');d.append(node('summary',title));d.append(node('pre',JSON.stringify(value,null,2)));parent.append(d);}
  function mask(r){const copy=structuredClone(r);for(const h of copy.history)for(const k of Object.keys(h.identities))h.identities[k]='••••'+String(h.identities[k]).slice(-4);return copy;}
  function render(){
    for(const b of document.querySelectorAll('[data-ab-view]'))b.setAttribute('aria-selected',String(b.dataset.abView===sub));
    const isAIView = sub === 'ai';
    $('abAITools').hidden = !isAIView;
    $('abAIMessage').hidden = !isAIView;
    if(!current)return;
    const s=current,c=ABRadar.counts(s);$('abToggle').textContent=s.active?'暂停监控':'开始监控';
    $('abStats').replaceChildren();
    for(const [category,label,value] of [['platforms','实验平台',c.platforms],['experiment','已确认实验',c.experiments],['version','未归属版本',c.versions],['suspected','疑似线索',c.suspected]]){
      const box=node('button',undefined,'ab-stat');box.type='button';box.dataset.summaryCategory=category;box.setAttribute('aria-label',label+' '+value+'，查看方案总结');box.append(node('strong',String(value)),node('span',label));
      box.onclick=()=>{sub='scheme';platform='';search='';$('abPlatform').value='';$('abSearch').value='';summaryOpen.clear();summaryOpen.add(category);render();$('abSummary-'+category)?.scrollIntoView({block:'nearest'});};$('abStats').append(box);
    }
    const content=$('abContent');content.replaceChildren();
    if(sub==='scheme'){renderScheme(content);return;}
    if(sub==='ai'){renderAI(content);return;}
    if(sub==='reports'){renderReports(content);return;}
    const records=Object.values(s.records).filter(r=>(!platform||r.provider===platform)&&JSON.stringify(r).toLowerCase().includes(search));
    if(!records.length){content.append(node('div',platform||search?'没有匹配的实验或参数。':s.providers.length?'识别到平台线索，尚未观察到可解析实验。可刷新并完整采集。':'尚未观察到实验。开始监控，或刷新并完整采集。','ab-empty'));}
    for(const r of records){
      const card=node('details',undefined,'ab-card');card.open=openCards.has(r.key);card.ontoggle=()=>card.open?openCards.add(r.key):openCards.delete(r.key);
      const summary=node('summary');summary.append(node('strong',r.name));
      for(const label of [ABRadar.platforms[r.provider],r.type==='experiment'?'已确认实验':r.type==='version'?'未归属版本':'疑似实验 / 开关',r.exposures?'已观察到曝光':'未观察到曝光'])summary.append(node('span',label,'ab-badge'));
      card.append(summary,node('p','实验 ID：'+(r.experimentId||'未知')+' · 版本/组：'+(r.variants.join(', ')||'未知')),node('p','角色：'+r.role+' · 项目/环境：'+r.project));
      card.append(node('p','首次 '+new Date(r.firstSeen).toLocaleTimeString()+' → 最近 '+new Date(r.lastSeen).toLocaleTimeString(),'ab-note'));
      for(const warn of ABRadar.warnings(r))card.append(node('p',warn,'ab-note'));
      const timeline=node('div');
      for(const h of mask(r).history.slice(-15)){
        const entry=node('div',undefined,'ab-time');entry.append(node('p',new Date(h.time).toLocaleTimeString()+' · '+h.phase+' · frame '+h.frameId+' · '+(h.event||'')),node('p','版本：'+(h.variantId||'未知')+' · 证据 '+h.evidenceId));
        details(entry,'参数与身份（'+h.path+'）',{parameters:h.parameters,identities:h.identities,url:h.url});timeline.append(entry);
      }
      card.append(timeline);
      const actions=node('div',undefined,'ab-actions');
      button('解读此实验',()=>analyze(r.key),actions);
      button('关联上报',()=>{sub='reports';renderReports(content,r);},actions);
      button('复制记录',()=>navigator.clipboard.writeText(JSON.stringify(ABRadar.redact(r),null,2)),actions);
      button('查看原始身份',()=>{details(card,'原始身份（仅本地）',r.history.map(h=>({time:h.time,identities:h.identities})));},actions);
      card.append(actions);content.append(card);
    }
  }
  function renderReports(parent,record){
    parent.replaceChildren();
    const ev=current.evidence.filter(e=>(!platform||e.provider===platform)&&(!record||record.evidenceIds.includes(e.id))&&JSON.stringify(e).toLowerCase().includes(search));
    if(!ev.length)parent.append(node('p','没有匹配的证据，或原始证据已滚动清理。','ab-empty'));
    for(const e of ev.slice(-150).reverse()){
      const d=node('details',undefined,'ab-card');d.append(node('summary',(e.kind==='request'?'实际上报 / 请求':e.kind==='response'?'配置响应':'状态快照')+' · '+ABRadar.platforms[e.provider]+' · '+String(e.status||'')));
      d.append(node('p',e.url,'ab-record-link'),node('p',e.id+' · frame '+e.frameId+' · '+new Date(e.time).toLocaleString(),'ab-note'),node('pre',JSON.stringify(e.data,null,2)));
      const actions=node('div',undefined,'ab-actions');button('查看关联埋点',()=>{
        switchTab(false);
        if(typeof allEvents!=='undefined'){
          const matched=allEvents.filter(x=>x.tabId===current.tabId && (x.requestId===e.requestId || x.url===e.url));
          if(matched.length)renderEvents(matched);else{switchTab(true);error(Error('原埋点监控未捕获此请求；完整数据可在当前证据中查看。'));}
        }
      },actions);d.append(actions);parent.append(d);
    }
  }
  function renderAI(parent){
    const ai=current.ai;if(!ai){parent.append(node('p','点击“解读当前网站”或单条实验的“解读此实验”。点击后直接将脱敏证据发送到已配置的 AI API。','ab-empty'));return;}
    parent.append(node('p',ai.model+' · '+new Date(ai.time).toLocaleString()+(current.revision!==ai.revision?' · 有新证据，可重新解读':''),'ab-note'));
    parent.append(node('p','本次解读快照的本地计数：'+JSON.stringify(ai.snapshot.counts),'ab-note'));
    if(ai.result.experimentEstimate){const e=ai.result.experimentEstimate;parent.append(node('h3','可能实验数量：'+(e.minimum===null?'未知':e.minimum)+(e.maximum!==null?' ～ '+e.maximum:'')),node('p',e.text));}
    for(const f of ai.result.findings){const block=node('div',undefined,'ab-card ab-findings');block.append(node('span',({background:'背景归属',count:'数量判断',platform:'平台依据',design:'设计目的',groups:'组别推测',settings:'设置改动',validation:'关联校验'}[f.category]||'解读')+' · '+(f.type==='fact'?'观察事实':'AI 假设')+' · '+({high:'高',medium:'中',low:'低'}[f.confidence])+'把握','ab-badge'),node('p',f.text));
      for(const id of f.evidenceIds){const e=ai.snapshot.evidence.find(x=>x.id===id);details(block,'证据 '+id,e||'原始证据已清理');}parent.append(block);}
    for(const [title,items] of [['缺失证据',ai.result.missingEvidence],['下一步校验',ai.result.nextChecks]]){parent.append(node('h3',title));for(const line of items)parent.append(node('p',line));}
    button('复制 AI 解读',()=>navigator.clipboard.writeText(JSON.stringify(ABRadar.redact(ai),null,2)),parent);
  }
  async function analyze(key) {
    if (busy) throw Error('当前正在解读');

    busy = true;
    cancelRequested = false;
    busyTab = current.tabId;
    const originTab = busyTab;
    const message = $('abAIMessage');
    const analyzeButton = $('abAnalyze');
    const cancelButton = $('abCancel');

    sub = 'ai';
    render();
    clearError();
    analyzeButton.disabled = true;
    cancelButton.hidden = false;
    message.textContent = '正在整理页面与脱敏证据…';

    try {
      const prepared = await rpc('preview', {tabId: originTab, key});
      if (cancelRequested) throw Error('已取消解读');

      message.textContent = '正在解读…';
      await rpc('analyze', {token: prepared.token, tabId: originTab});
      await refresh();
      clearError();
      message.textContent = '';
    } catch (e) {
      message.textContent = e.message || String(e);
    } finally {
      busy = false;
      busyTab = null;
      analyzeButton.disabled = false;
      cancelButton.hidden = true;
    }
  }
  function renderScheme(parent){
    details(parent,'采集范围与数据缺口',{coverage:current.coverage,truncated:current.truncated});
    const records=Object.values(current.records).filter(r=>(!platform||r.provider===platform)&&JSON.stringify(r).toLowerCase().includes(search));
    const providers=current.providers.filter(p=>!platform||p===platform);
    for(const [category,label] of [['platforms','实验平台'],['experiment','已确认实验'],['version','未归属版本'],['suspected','疑似线索']]){
      const items=records.filter(r=>r.type===category), section=node('details',undefined,'ab-card ab-summary-section');section.id='abSummary-'+category;section.open=summaryOpen.has(category);section.ontoggle=()=>section.open?summaryOpen.add(category):summaryOpen.delete(category);
      section.append(node('summary',label+' · '+(category==='platforms'?providers.length:items.length)));
      if(category==='platforms'){
        if(!providers.length)section.append(node('p','尚未观察到实验平台证据。','ab-note'));
        for(const provider of providers){
          const group=records.filter(r=>r.provider===provider), proof=current.evidence.filter(e=>e.provider===provider), block=node('div',undefined,'ab-scheme-group');
          block.append(node('h3',ABRadar.platforms[provider]||provider),node('p','已确认 '+group.filter(r=>r.type==='experiment').length+' · 未归属版本 '+group.filter(r=>r.type==='version').length+' · 疑似 '+group.filter(r=>r.type==='suspected').length));
          block.append(node('p','配置响应 '+proof.filter(e=>e.kind==='response').length+' · 请求上报 '+proof.filter(e=>e.kind==='request').length+' · 状态快照 '+proof.filter(e=>e.kind==='snapshot').length,'ab-note'));
          details(block,'平台依据与接口来源',proof.slice(-20).map(e=>({evidenceId:e.id,source:e.kind,url:ABRadar.safeURL(e.url)})));
          const keys=[...new Set(group.flatMap(r=>r.parameterNames||[]))];if(keys.length)block.append(node('p','配置参数：'+keys.join('、')));
          section.append(block);
        }
      }else{
        if(!items.length)section.append(node('p','当前分类没有匹配记录。','ab-note'));
        for(const provider of [...new Set(items.map(r=>r.provider))]){
          section.append(node('h3',ABRadar.platforms[provider]||provider));
          for(const r of items.filter(r=>r.provider===provider)){
            const entry=node('div',undefined,'ab-scheme-group');entry.append(node('strong',r.name),node('p','实验 ID：'+(r.experimentId||'未知')+' · 版本：'+(r.variants.join(', ')||'未知')),node('p',r.project+' · '+r.role+' · '+(r.exposures?'观察到曝光':'未观察到明确曝光'),'ab-note'));
            details(entry,'参数与关联证据',ABRadar.redact(r.history.slice(-15)));
            button('查看实验记录',()=>{openCards.add(r.key);search=r.name.toLowerCase();$('abSearch').value=r.name;sub='records';render();},entry);
            section.append(entry);
          }
        }
      }
      parent.append(section);
    }
  }
  document.querySelector('.radar-tabs').addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const ab=e.key==='End'||(e.key!=='Home'&&!visible);switchTab(ab);$(ab?'abTab':'eventsTab').focus();});
  $('eventsTab').onclick=()=>switchTab(false);$('abTab').onclick=()=>switchTab(true);
  $('abToggle').onclick=()=>run(current?.active?'pause':'start').catch(error);
  $('abRefresh').onclick=()=>run('refresh').catch(error);
  $('abClear').onclick=()=>run('clear').catch(error);
  $('abAnalyze').onclick=()=>analyze().catch(error);
  $('abCancel').onclick=()=>{cancelRequested=true;if(busyTab!==null)rpc('cancel',{tabId:busyTab}).catch(error);};
  for(const [value,label] of Object.entries(ABRadar.platforms)){const option=node('option',label);option.value=value;$('abPlatform').append(option);}
  $('abPlatform').onchange=e=>{platform=e.target.value;render();};
  $('abSearch').oninput=e=>{search=e.target.value.toLowerCase();render();};
  for(const b of document.querySelectorAll('[data-ab-view]'))b.onclick=()=>{sub=b.dataset.abView;render();};
  $('abExport').onclick=async()=>{try{const {data}=await rpc('export',{tabId:current.tabId});const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=node('a');a.href=url;a.download='abtest-'+Date.now()+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){error(e);}};
  chrome.runtime.onMessage.addListener(m=>{if(m.action==='ab:changed' && (!current||m.tabId===current.tabId)){clearTimeout(refreshTimer);refreshTimer=setTimeout(refresh,250);}});
  chrome.tabs.onActivated.addListener(()=>{if(window===window.top){current=null;refresh();}});
})();
