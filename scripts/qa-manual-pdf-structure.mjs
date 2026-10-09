import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { runInNewContext } from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = file => readFileSync(path.join(root, file), "utf8");
const html = read("public/manual/index.html");
const guide = read("public/manual/manual.js");
const jsPath = path.join(root, "public/manual/pdf-download.js");
const action = read("public/manual/pdf-download.js");
execFileSync(process.execPath, ["--check", jsPath], { stdio: "pipe" });
assert(html.includes('data-ghrab-access="checking"'), "Manual must start gated");
assert(html.includes('src="./pdf-download.js"'), "Missing local PDF button module");
assert(action.includes('root.dataset.ghrabAccess !== "granted"'), "PDF control must fail closed without permit");
assert(action.includes('downloadManualPdf'), "Missing shared PDF exporter");
assert(action.includes("manualy/pdf-export.js"), "Incorrect PDF module location");
assert(action.includes("MutationObserver"), "Access transition not monitored");
assert(!["https://cdn.", "https://unpkg.", "https://jsdelivr."].some(host => action.includes(host)), "Unpinned CDN");
// Completeness checks: actual dynamic structures must be part of the exported content.
if ("dynamic" === "map") {
  assert(guide.includes("GHRAB_MANUAL_EXPORT"), "Interactive tour not exported");
  assert(guide.includes("MANUAL.map") && guide.includes("MANUAL.tour"), "Guide map/tour incomplete");
} else if ("dynamic" === "tables") {
  assert(guide.includes("GHRAB_MANUAL_EXPORT") && guide.includes("table"), "Tables missing from PDF");
} else if ("dynamic" === "dynamic") {
  assert(guide.includes("GHRAB_MANUAL_EXPORT") && guide.includes("manual-warning"), "Dynamic safety messages missing");
}
const navCss = read("public/manual/navigation-context.css");
assert(navCss.includes("var(--text,var(--ink,#eef5fb))") && navCss.includes(":focus-visible"), "Navigation and PDF need accessible contrast/focus");
// The same source-level contract is required in every application.
const navFile = path.join(path.dirname(jsPath), "navigation-context.js");
execFileSync(process.execPath, ["--check", navFile], {stdio:"pipe"});
assert(html.includes('src="./navigation-context.js"') && html.includes('href="./navigation-context.css"'),
  "Manual must load its navigation script and accessible style");
assert(action.includes('info.reviewStatus !== "verified"') && action.includes("insideStudioViewer"),
  "PDF must fail closed for unreviewed guides and hide inside Studio viewer");
assert(!action.includes("Náhled PDF"), "Do not expose internal review status as a PDF action");
function simulate(initial, change, {reviewStatus="review-required", embedded=false, version="1.0.0", tour=true}={}) {
  const elements = new Map();
  let watcher = null;
  const nav = { append(...nodes) { for(const node of nodes) elements.set(node.id,node); } };
  const rootNode = {dataset:{ghrabAccess:initial,ghrabAppId:"test-app",ghrabAppVersion:"1.0.0"}};
  const document = {
    documentElement:rootNode,
    getElementById(id) {return id==="ghrab-manual-navigation" ? nav : elements.get(id);},
    createElement(tag) {
      const el={tagName:tag.toUpperCase(),id:"",textContent:"",className:"",
        disabled:false,handlers:{},attributes:{},
        setAttribute(k,v){this.attributes[k]=v;},
        addEventListener(k,fn){this.handlers[k]=fn;},
        remove(){elements.delete(this.id);}
      };
      return el;
    }
  };
  const win={
    GHRAB_MANUAL_DOC_INFO:{appId:"test-app",appVersion:version,reviewStatus,pdfContentContract:"map-tour-v1"},
    GHRAB_MANUAL_EXPORT:tour?[{type:"h2",text:"Complete steps"}]:[]
  };
  win.frameElement=embedded?{id:"manual-frame"}:null;
  win.parent=embedded?{location:{pathname:"/AI-Studio-GHRAB/manualy/viewer.html"}}:win;
  class MockObserver {
    constructor(cb){this.cb=cb;watcher=this;}
    observe(){this.active=true;}
  }
  runInNewContext(action,{document,window:win,URL,MutationObserver:MockObserver,
    location:{href:"https://daniel22-dev.github.io/test-app/manual/",origin:"https://daniel22-dev.github.io"}},
    {filename:jsPath});
  const before=!!elements.get("ghrab-manual-pdf");
  rootNode.dataset.ghrabAccess=change;
  watcher?.cb();
  const btn=elements.get("ghrab-manual-pdf");
  return {before,after:!!btn,label:btn?.textContent,handlers:btn?.handlers};
}
assert.equal(simulate("checking","denied",{reviewStatus:"verified"}).after,false,"Denied permit");
assert.equal(simulate("checking","granted").after,false,"Unreviewed manual must not export");
assert.equal(simulate("checking","granted",{reviewStatus:"verified",version:"0.0.0"}).after,false,"Wrong release version");
assert.equal(simulate("checking","granted",{reviewStatus:"verified",tour:false}).after,false,"Incomplete map/tour");
assert.equal(simulate("checking","granted",{reviewStatus:"verified",embedded:true}).after,false,"Embedded manual must not duplicate Studio PDF");
const granted=simulate("checking","granted",{reviewStatus:"verified"});
assert.equal(granted.before,false,"PDF before permit");
assert.equal(granted.after,true,"Verified standalone PDF should be offered");
assert.match(granted.label,/Stáhnout PDF/,"Download action label");
assert(granted.handlers?.click,"PDF action must have click handler");
const revoke=simulate("granted","denied",{reviewStatus:"verified"});
assert(revoke.before && !revoke.after,"PDF control must disappear on revocation");
console.log("[MANUAL PDF] PASS: CSS/navigation, authorization, review, version, completeness, iframe, revocation");

// Browser-independent navigation VM cases: launch source must decide return action.
function simulateNavigation(search, {embedded=false, granted=true, referrer=""}={}) {
  const children=[];
  const legacy={textContent:"Zpět do aplikace",hidden:false,style:{}};
  const outerHeader={hidden:false,querySelector(){return null;}};
  const header={
    classList:{add(){}},
    append(node){children.push(node);},
    closest(){return outerHeader;}
  };
  const document={
    referrer,
    documentElement:{dataset:{ghrabAccess:granted?"granted":"denied"}},
    querySelector(){return header;},
    querySelectorAll(selector){return selector==="header a"?[legacy]:[];},
    getElementById(id){return children.find(x=>x.id===id)||null;},
    createElement(tag){return{
      tagName:tag.toUpperCase(),children:[],classList:{add(){}},attributes:{},
      setAttribute(k,v){this.attributes[k]=v;},
      append(node){this.children.push(node);}
    };}
  };
  const win={};
  win.frameElement=embedded?{id:"manual-frame"}:null;
  win.parent=embedded?{location:{pathname:"/AI-Studio-GHRAB/manualy/viewer.html"}}:win;
  const location={
    href:"https://daniel22-dev.github.io/korespondencni-asistent/manual/"+search,
    origin:"https://daniel22-dev.github.io",search
  };
  class MockObserver{constructor(cb){this.cb=cb;}observe(){}disconnect(){}}
  const source=read(path.relative(root,navFile));
  runInNewContext(source,{document,window:win,location,URL,URLSearchParams,MutationObserver:MockObserver},
    {filename:navFile});
  return {labels:(children.find(x=>x.id==="ghrab-manual-navigation")?.children||[])
    .map(x=>x.textContent),legacyHidden:legacy.hidden,
    embedded:document.documentElement.dataset.ghrabManualEmbedded,
    headerHidden:outerHeader.hidden};
}
assert.deepEqual(simulateNavigation("?from=studio").labels,
  ["← Zpět na manuály","AI Studio"],"Catalog entry must not return to application");
assert.deepEqual(simulateNavigation("?from=app").labels,
  ["← Zpět do aplikace","AI Studio"],"Application entry must provide app return");
assert.deepEqual(simulateNavigation("").labels,["AI Studio"],"Direct URL must have safe Studio fallback");
const nested=simulateNavigation("",{embedded:true});
assert.equal(nested.labels.length,0,"Embedded manual must use parent viewer header");
assert(nested.legacyHidden && nested.embedded==="viewer","Embedded navigation must hide duplicates");
assert.equal(simulateNavigation("?from=studio",{granted:false}).labels.length,0,
  "Access denial must not install manual return controls");
console.log("[MANUAL NAV] PASS: catalogue, application, direct, embedded and denied contexts");

