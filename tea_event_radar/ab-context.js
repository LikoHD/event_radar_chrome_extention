/* Serialized into the isolated world only after an explicit AI preview request. */
globalThis.ABContextCapture=function(){
  const clean=text=>String(text||'').replace(/sk-[a-z0-9_-]{16,}/gi,'[secret]').replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi,'[email]').replace(/\b1[3-9]\d{9}\b/g,'[phone]').slice(0,600);
  const safeURL=value=>{try{const u=new URL(value,location.href);return u.origin+u.pathname.replace(/\b\d{6,}\b/g,'[id]');}catch{return '';}};
  const excluded='script,style,noscript,iframe,svg,canvas,input,textarea,[contenteditable], [hidden], [data-message-author-role], [data-testid*="message"], [class*="message-content"], #tea-event-radar-panel';
  let visited=0,length=0,truncated=false;
  function copy(el,depth=0){
    if(++visited>2500||depth>24||length>36000){truncated=true;return '';}
    if(el.nodeType===3){const text=clean(el.textContent).replace(/&/g,'&amp;').replace(/</g,'&lt;');length+=text.length;return text;}
    if(el.nodeType!==1||el.matches(excluded)||el.getAttribute('aria-hidden')==='true')return '';
    const style=getComputedStyle(el);if(style.display==='none'||style.visibility==='hidden')return '';
    const tag=el.tagName.toLowerCase();let attrs='';
    for(const a of el.attributes){if(!/^(role|aria-label|title|type|href|data-(ab|experiment|variant|test-id))/.test(a.name))continue;
      const v=a.name==='href'?safeURL(a.value):clean(a.value);attrs+=' '+a.name+'="'+v.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;')+'"';}
    length+=tag.length*2+attrs.length+5;
    let children='';for(const child of el.childNodes){children+=copy(child,depth+1);if(length>36000)break;}
    return '<'+tag+attrs+'>'+children+'</'+tag+'>';
  }
  return {url:safeURL(location.href),title:clean(document.title),description:clean(document.querySelector('meta[name="description"]')?.content),language:document.documentElement.lang,contextScope:'当前页面可见应用内容；报表中的客户项目不是宿主控制台实验归属',visibleControls:Array.from(document.querySelectorAll('h1,h2,h3,button,[role=tab]')).slice(0,300).filter(el=>el.getClientRects().length && !el.closest('#tea-event-radar-panel')).map(el=>clean(el.textContent)).filter(Boolean).slice(0,50),html:copy(document.querySelector('main,[role=main],#root')||document.body||document.documentElement),truncated,limitations:['HTML 为有界结构快照，已去除脚本、输入框及常见聊天消息区域；动态不可见内容可能缺失。'],scripts:Array.from(document.scripts).map(s=>safeURL(s.src)).filter(Boolean).slice(0,40)};
};
