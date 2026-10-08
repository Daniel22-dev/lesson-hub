const allowed=()=>document.documentElement.dataset.ghrabAccess==="granted";
function mount(){
  if(!allowed()||document.querySelector("#manual-pdf"))return;
  const main=document.querySelector("main");if(!main)return;
  const b=document.createElement("button"),msg=document.createElement("span");
  b.id="manual-pdf";b.type="button";b.textContent="↓ Stáhnout celý manuál PDF";
  b.style.cssText="padding:12px;margin:12px;border-radius:10px;min-height:44px;cursor:pointer";
  msg.setAttribute("role","status");main.prepend(b,msg);
  b.onclick=async()=>{
    if(!allowed())return;b.disabled=true;msg.textContent="Připravuji PDF…";
    try{
      const base=document.querySelector("[data-ghrab-studio-link]")?.href||
        window.__GHRAB_DEPLOYMENT_CONFIG__?.studioBaseUrl||
        new URL("/AI-Studio-GHRAB/",location.href).href;
      const {downloadManualPdf}=await import(new URL("manualy/pdf-export.js",base).href);
      const extras=Array.isArray(window.GHRAB_MANUAL_EXPORT)?window.GHRAB_MANUAL_EXPORT:[];
      const search=document.querySelector("#manual-search"),query=search?.value||"";
      if(search&&query){search.value="";search.dispatchEvent(new Event("input"))}
      try{
      await downloadManualPdf(document,{title:document.title,filename:"GHRAB-"+document.documentElement.dataset.ghrabAppId+"-manual.pdf",extras});
      }finally{if(search&&query){search.value=query;search.dispatchEvent(new Event("input"))}}
      msg.textContent="PDF staženo.";
    }catch(e){msg.textContent="PDF se nepodařilo vytvořit: "+String(e?.message||e)}
    finally{b.disabled=false}
  };
}
const observer=new MutationObserver(()=>{
  if(allowed()){observer.disconnect();mount()}
  else if(document.documentElement.dataset.ghrabAccess==="denied")observer.disconnect();
});
observer.observe(document.documentElement,{attributes:true,attributeFilter:["data-ghrab-access"]});
if(allowed()){observer.disconnect();mount()}
