/* Run with PLAYWRIGHT_MODULE=/absolute/path/to/playwright node tests/browser-smoke.cjs [source-directory] */
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict'),http=require('node:http'),path=require('node:path'),fs=require('node:fs'),os=require('node:os');
(async()=>{
 let requests=[];
 const server=http.createServer((req,res)=>{
  requests.push(req.url);res.setHeader('Cache-Control','no-store');
  if(req.url==='/abtest_config'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:{checkout_layout:{vid:'v100',value:'compact'},button_color:{vid:'v100',value:'blue'}}}));}
  else if(req.url==='/frame'){res.setHeader('Content-Type','text/html');res.end('<html><body><h2>Child frame</h2></body></html>');}
  else if(req.url==='/list'){res.setHeader('Content-Type','application/json');res.end('{"ok":true}');}
  else{res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html><body><h1>Checkout experiment fixture</h1><button id="send">Send experiment</button><script>
  window.collectEvent=function(){};window.LogAnalyticsObject='collectEvent';
  async function send(){const result=await fetch('/abtest_config').then(r=>r.json());document.querySelector('h1').textContent=result.data.checkout_layout.value;await fetch('/list',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify([{header:{sdk_version:'5.0'},user:{user_unique_id:'user-private'},events:[{event:'abtest_exposure',params:{ab_sdk_version:'v100'}}]}])});}
  document.querySelector('#send').onclick=send;
  </script></body></html>`);}
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin='http://127.0.0.1:'+server.address().port;
 const ext=path.resolve(process.argv[2]||'tea_event_radar');const profile=fs.mkdtempSync(path.join(os.tmpdir(),'tea-ab-browser-'));
 let context;
 try{
  context=await chromium.launchPersistentContext(profile,{channel:'chromium',...(process.env.PLAYWRIGHT_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE}:{}),headless:true,args:['--disable-extensions-except='+ext,'--load-extension='+ext],viewport:{width:1360,height:950}});
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');const id=new URL(worker.url()).host;
  const errors=[];worker.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  const site=await context.newPage();site.on('pageerror',e=>errors.push(e.message));await site.goto(origin);
  const tabId=await worker.evaluate(async origin=>(await chrome.tabs.query({})).find(t=>(t.url||'').startsWith(origin)).id,origin);
  await worker.evaluate(id=>injectInPagePanel(id),tabId);
  const panel=site.frameLocator('#tea-event-radar-panel iframe');
  // Both workspaces share the top navigation and the existing settings drawer.
  assert.equal(await panel.locator('.header-bar [role=tab]').count(),2);
  await panel.locator('#settingsBtn').click();
  await panel.locator('#settingsPanel.active #aiForm').waitFor();
  await panel.locator('#apiKey').fill('browser-test-only');
  await panel.locator('#aiForm button[type=submit]').click();
  await panel.locator('#status').filter({hasText:'设置已保存'}).waitFor();
  assert.equal(await panel.locator('#apiKey').inputValue(),'');
  await panel.locator('#settingsCloseBtn').click();
  await panel.locator('#abTab').click();await panel.locator('#abToggle').filter({hasText:'暂停监控'}).waitFor();
  assert.equal(await panel.locator('#abTab').getAttribute('aria-selected'),'true');
  await panel.locator('#settingsBtn').click();
  await panel.locator('#settingsPanel.active #baseURL').waitFor();
  await panel.locator('#settingsCloseBtn').click();
  await site.locator('#send').click();
  await panel.locator('.ab-stat strong').nth(2).waitFor();
  await site.waitForFunction(()=>document.querySelector('h1').textContent==='compact');
  // Poll background state, without synthesizing browser extension observations.
  await poll(async()=>{const s=await worker.evaluate(async()=> (await chrome.storage.session.get('abSessions')).abSessions);return s?.[tabId]?.evidence?.some(e=>e.kind==='response')&&Object.values(s[tabId].records).some(r=>r.exposures);});
  let saved=await worker.evaluate(async()=> (await chrome.storage.session.get('abSessions')).abSessions);
  assert.equal(Object.values(saved[tabId].records).filter(r=>r.type==='version').length,1);
  assert.equal(Object.values(saved[tabId].records).filter(r=>r.type==='experiment').length,0);
  assert.equal(requests.filter(x=>x==='/abtest_config').length,1,'probe must not replay request');
  assert.equal(requests.filter(x=>x==='/list').length,1,'probe must not add exposure');
  await panel.locator('.ab-card summary').first().click();
  await site.screenshot({path:path.join(os.tmpdir(),'tea-ab-browser.png'),fullPage:true});
  const xhrValue=await site.evaluate(()=>new Promise((resolve,reject)=>{const x=new XMLHttpRequest();x.open('GET','/abtest_config');x.responseType='json';x.onload=()=>resolve(x.response.data.checkout_layout.value);x.onerror=reject;x.send();}));assert.equal(xhrValue,'compact');
  await site.evaluate(()=>{const f=document.createElement('iframe');f.id='test-child';f.src='/frame';document.body.append(f);});
  await poll(async()=>!!site.frames().find(f=>f.url().endsWith('/frame')));
  await new Promise(r=>setTimeout(r,200));
  await site.frames().find(f=>f.url().endsWith('/frame')).evaluate(()=>fetch('/abtest_config').then(r=>r.json()));
  await poll(async()=>{const all=await worker.evaluate(async()=> (await chrome.storage.session.get('abSessions')).abSessions);return all[tabId].evidence.some(e=>e.kind==='response'&&e.frameId>0);});
  await panel.locator('#abToggle').click();
  await poll(async()=>{const s=await worker.evaluate(async()=> (await chrome.storage.session.get('abSessions')).abSessions);return s[tabId]?.active===false;});
  await panel.locator('#abToggle').filter({hasText:'开始监控'}).waitFor();await site.locator('#send').click();
  await new Promise(r=>setTimeout(r,500));
  const paused=await worker.evaluate(async()=> (await chrome.storage.session.get('abSessions')).abSessions);
  assert.equal(Object.values(paused[tabId].records)[0].exposures,1,'pause stops new evidence');
  // Keys only available in trusted extension contexts.
  const options=await context.newPage();options.on('pageerror',e=>errors.push(e.message));await options.goto('chrome-extension://'+id+'/ai-settings.html');
  await options.locator('#apiKey').fill('browser-test-only');await options.locator('button[type=submit]').click();await options.locator('#status').filter({hasText:'设置已保存'}).waitFor();
  assert.equal(await options.locator('#apiKey').inputValue(),'');
  const untrusted=await worker.evaluate(async id=>{const r=await chrome.scripting.executeScript({target:{tabId:id},func:async()=>{try{return await chrome.storage.local.get('abAISettings');}catch(e){return{blocked:true};}}});return r[0].result;},tabId);
  assert.ok(untrusted.blocked,'content script cannot read local credentials');
  // Isolated content scripts cannot invoke privileged API actions either.
  const denied=await worker.evaluate(async id=>{const r=await chrome.scripting.executeScript({target:{tabId:id},func:()=>chrome.runtime.sendMessage({action:'ab:settings'})});return r[0].result;},tabId);assert.ok(denied.error);
  // Run the real preview/send/render flow against an in-worker mock provider.
  await options.locator('#baseURL').fill('https://model.test/v1');await options.locator('button[type=submit]').click();
  await poll(async()=>await worker.evaluate(async()=> (await chrome.storage.local.get('abAISettings')).abAISettings.baseURL==='https://model.test/v1'));
  const research=await worker.evaluate(()=>ABResearch.forSite('https://www.doubao.com/'));
  assert.equal(research.sites[0].observedPlatforms[0],'volc');
  await worker.evaluate(()=>{
    const original=globalThis.fetch;globalThis.__testModelCalls=[];
    globalThis.fetch=async(url,options)=>{
      if(!String(url).startsWith('https://model.test/'))throw Error('Unexpected test endpoint');
      const body=JSON.parse(options.body);globalThis.__testModelCalls.push(body);
      const snapshot=JSON.parse(body.messages[1].content);
      return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({findings:[{type:'hypothesis',text:'可能验证结账布局；仅为假设',confidence:'low',evidenceIds:[snapshot.evidence[0].id]}],missingEvidence:['没有对照组配置'],nextChecks:['核对曝光与业务事件']})}}]}),{status:200,headers:{'Content-Type':'application/json'}});
    };
  });
  await site.bringToFront();
  await panel.locator('#abPlatform').selectOption('sensors');
  await panel.locator('.ab-empty').filter({hasText:'没有匹配'}).waitFor();
  await panel.locator('#abPlatform').selectOption('volc');
  await panel.locator('#abSearch').fill('compact');
  await panel.locator('.ab-card summary').first().waitFor();
  await panel.locator('#abSearch').fill('');
  await panel.locator('#abPlatform').selectOption('');
  assert.equal(await panel.locator('#abCoverage').count(),0);
  for(const category of ['platforms','experiment','version','suspected']){
    await panel.locator('[data-summary-category="'+category+'"]').click();
    assert.ok(await panel.locator('#abSummary-'+category).evaluate(el=>el.open));
    assert.equal(await panel.locator('[data-ab-view=scheme]').getAttribute('aria-selected'),'true');
  }
  await site.screenshot({path:path.join(os.tmpdir(),'tea-ab-scheme.png'),fullPage:true});
  await panel.locator('[data-ab-view=ai]').click();await panel.locator('#abAnalyze').click();
  await panel.locator('.ab-findings').filter({hasText:'可能验证结账布局'}).waitFor({timeout:15000});
  assert.equal(await panel.locator('#abPreview').count(),0);
  assert.equal(await worker.evaluate(()=>globalThis.__testModelCalls.length),1);
  const sent=await worker.evaluate(()=>globalThis.__testModelCalls[0].messages[1].content);
  assert.ok(!sent.includes('user-private'));assert.ok(!sent.includes('browser-test-only'));
  const prepared=JSON.parse(sent);assert.ok(prepared.websiteContext.html.includes('<h1>'));assert.ok(!prepared.websiteContext.html.includes('<script'));assert.ok(!prepared.websiteContext.html.includes('tea-event-radar-panel'));assert.ok(prepared.evidence.some(e=>e.kind==='page-context'));
  await site.screenshot({path:path.join(os.tmpdir(),'tea-ab-ai.png'),fullPage:true});
  // Original analytics tab still captures, searches and renders the same network request.
  await panel.locator('#eventsTab').click();await panel.locator('#clearBtn').click();
  await poll(async()=> (await panel.locator('#eventCount').innerText())==='0');
  if((await panel.locator('#toggleText').innerText())==='RadarUp')await panel.locator('#toggleBtn').click();
  await site.locator('#send').click();
  await panel.locator('#eventCount').filter({hasText:'1'}).waitFor();
  await panel.locator('#searchInput').fill('abtest_exposure');await panel.locator('#searchInput').press('Enter');
  await poll(async()=> (await panel.locator('#eventsList').innerText()).includes('abtest_exposure'));
  await options.locator('#deleteKey').click();await options.locator('#status').filter({hasText:'密钥已删除'}).waitFor();
  await options.screenshot({path:path.join(os.tmpdir(),'tea-ai-settings.png')});
  // Standalone side-panel layout must fit the narrowest supported panel width.
  const narrow=await context.newPage();narrow.on('pageerror',e=>errors.push(e.message));
  await narrow.setViewportSize({width:320,height:800});
  await narrow.goto('chrome-extension://'+id+'/panel.html');
  await narrow.screenshot({path:path.join(os.tmpdir(),'tea-events-panel-320.png')});
  assert.ok(await narrow.evaluate(()=>{const c=document.querySelector('.container');return c.scrollWidth<=c.clientWidth && c.getBoundingClientRect().right<=innerWidth;}),'320px workspace must not overflow');
  const tabsBox=await narrow.locator('.radar-tabs').boundingBox(),settingsBox=await narrow.locator('#settingsBtn').boundingBox();
  assert.ok(Math.abs(tabsBox.y-settingsBox.y)<30,'tabs and settings remain in the top row');
  await narrow.locator('#settingsBtn').click();
  await narrow.locator('#settingsPanel.active #aiForm').waitFor();
  await poll(async()=>await narrow.locator('#settingsPanel').evaluate(el=>Math.abs(el.getBoundingClientRect().right-innerWidth)<1));
  await narrow.screenshot({path:path.join(os.tmpdir(),'tea-settings-drawer-320.png')});
  await narrow.locator('#settingsCloseBtn').press('Escape');
  await poll(async()=>await narrow.locator('#settingsBtn').getAttribute('aria-expanded')==='false');
  await narrow.locator('#eventsTab').focus();await narrow.locator('#eventsTab').press('ArrowRight');
  assert.equal(await narrow.locator('#abTab').getAttribute('aria-selected'),'true');
  await narrow.screenshot({path:path.join(os.tmpdir(),'tea-ab-panel-320.png')});
  const footer=await narrow.locator('.ab-footer').boundingBox();assert.ok(footer.y+footer.height>=795 && footer.x>=0 && footer.x+footer.width<=321,'AB controls remain at the bottom without overflow');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ok:true,extension:ext,requests:requests.filter(x=>['/list','/abtest_config'].includes(x)),records:Object.keys(saved[tabId].records).length,screenshot:path.join(os.tmpdir(),'tea-ab-browser.png'),errors},null,2));
 }finally{await context?.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
async function poll(fn){for(let i=0;i<60;i++){if(await fn())return;await new Promise(r=>setTimeout(r,200));}throw Error('Timed out waiting for captured experiment');}
