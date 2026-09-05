(async()=>{
  'use strict';const $=id=>document.getElementById(id);
  async function rpc(action,extra={}){const r=await chrome.runtime.sendMessage({action:'ab:'+action,...extra});if(r?.error)throw Error(r.error);if(!r)throw Error('扩展后台未响应');return r;}
  function status(s){$('status').textContent=s;}
  async function load(){const c=await rpc('settings');$('baseURL').value=c.baseURL;$('model').value=c.model;$('apiKey').value='';$('keyState').textContent=c.hasKey?'已保存密钥，留空可保留。':'尚未配置密钥。';}
  async function save(deleteKey=false){await rpc('saveSettings',{settings:{baseURL:$('baseURL').value.trim(),model:$('model').value.trim(),apiKey:$('apiKey').value.trim()},deleteKey});await load();}
  $('aiForm').onsubmit=async e=>{e.preventDefault();try{await save();status('设置已保存');}catch(e){status(e.message);}};
  $('deleteKey').onclick=async()=>{try{const c=await rpc('settings');await rpc('saveSettings',{settings:c,deleteKey:true});await load();status('密钥已删除');}catch(e){status(e.message);}};
  $('test').onclick=async()=>{const b=$('test');b.disabled=true;try{await save();status('正在测试连接…');await rpc('test');status('连接成功，模型与结构化响应验证通过');}catch(e){status(e.message);}finally{b.disabled=false;}};
  try{await load();}catch(e){status(e.message);}
})();
