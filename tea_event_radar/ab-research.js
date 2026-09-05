(function(root){
  'use strict';
  let cached;
  function match(catalog,origin){
    const host=new URL(origin).hostname.toLowerCase();
    return {updatedAt:catalog.updatedAt,policy:catalog.policy,sites:catalog.sites.filter(s=>s.domains.some(d=>host===d||host.endsWith('.'+d))).map(s=>({...s,evidenceId:'research-'+s.id}))};
  }
  async function forSite(origin){
    try{
      if(!cached)cached=fetch(chrome.runtime.getURL('ab-research.json')).then(r=>{if(!r.ok)throw Error('研究目录不可读');return r.json();}).catch(e=>{cached=null;throw e;});
      return match(await cached,origin);
    }catch{return {sites:[],limitation:'内置调研资料暂不可读；仅分析当前证据'};}
  }
  root.ABResearch={match,forSite};
  if(typeof module!=='undefined')module.exports=root.ABResearch;
})(globalThis);
