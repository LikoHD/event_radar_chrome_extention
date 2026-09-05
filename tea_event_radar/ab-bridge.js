(() => {
  'use strict';
  if(globalThis.__teaABBridge)return; globalThis.__teaABBridge=true;
  let active=false, scanUntil=0, burst=0;
  setInterval(()=>{burst=0;},1000);
  function control(config) {
    active=config.active===true;
    if(config.scan)scanUntil=Date.now()+3000;
    window.postMessage({source:'tea-ab-control',active,scan:!!config.scan},location.origin==='null'?'*':location.origin);
  }
  chrome.runtime.onMessage.addListener((message,sender,reply)=>{if(message.action==='ab:control'){control(message);reply({ok:true});}return false;});
  window.addEventListener('message',event=>{
    if(event.source!==window || event.data?.source!=='tea-ab-observation' || ++burst>40)return;
    const p=event.data.payload;
    if(!p || !['response','snapshot','gap'].includes(p.kind))return;
    if(!active && !(p.kind==='snapshot' && Date.now()<scanUntil))return;
    try { if(new TextEncoder().encode(JSON.stringify(p)).length>512*1024)return;
      chrome.runtime.sendMessage({action:'ab:observe',payload:p}).catch(()=>{});
    }catch{}
  });
  chrome.runtime.sendMessage({action:'ab:hello'}).then(r=>{if(r)control(r);}).catch(()=>{});
})();
