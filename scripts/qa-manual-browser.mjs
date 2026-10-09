import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from "node:child_process";
import { chromium } from 'playwright';

const repoRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const webroot=path.resolve(repoRoot, process.env.MANUAL_WEBROOT || 'src');
const appName=process.env.MANUAL_APP_NAME || 'app';
const out=path.resolve('qa-results/manual-browser');
await mkdir(out,{recursive:true});
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==="/manualy/pdf-export.js"){
      res.writeHead(200,{"Content-Type":"text/javascript;charset=utf-8"});
      res.end(await readFile(path.join(out,"shared-pdf-export.js")));
      return;
    }
    if(url.pathname==='/AI-Studio-GHRAB/manualy/viewer.html'){
      res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});
      res.end('<!doctype html><html><body><iframe id="manual-frame" src="/manual/index.html?from=studio" title="Manuál" style="width:100%;height:1100px"></iframe></body></html>');
      return;
    }
    let rel=decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if(!rel || rel.endsWith('/'))rel+='index.html';
    const srcBase=rel.startsWith('src/') ? repoRoot : webroot;
    const f=path.resolve(srcBase,rel);
    if(!f.startsWith(srcBase+path.sep))throw Error('Invalid path');
    const body=await readFile(f);
    const mime={'.html':'text/html;charset=utf-8','.css':'text/css;charset=utf-8','.js':'text/javascript;charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.json':'application/json'};
    res.writeHead(200,{'Content-Type':mime[path.extname(f)]||'application/octet-stream'});res.end(body);
  }catch(err){res.writeHead(404);res.end(String(err));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
let browser;
try{
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1366,height:900}});
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.goto(origin+'/manual/index.html?from=studio');
  await page.waitForFunction(()=>document.documentElement.dataset.ghrabAccess==='granted');
  await page.locator('#ghrab-manual-navigation a').first().waitFor({state:'visible'});
  assert.deepEqual(await page.locator('#ghrab-manual-navigation a').allTextContents(),['← Zpět na manuály','AI Studio']);
  assert.equal(await page.locator('#ghrab-manual-pdf').count(),0,'Unreviewed PDF must not appear');
  const contrast=await page.locator('#ghrab-manual-navigation a').first().evaluate(el=>{
    const s=getComputedStyle(el);
    function lum(c){const a=c.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return a[0]*.2126+a[1]*.7152+a[2]*.0722;}
    const x=lum(s.color),y=lum(s.backgroundColor);
    return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
  });
  assert(contrast>=4.5,'Return button contrast too low: '+contrast);
  // CI-only full-content export. UI remains fail-closed while reviewStatus != verified.
  const editorial = await page.evaluate(() => ({
    contract: window.GHRAB_MANUAL_DOC_INFO?.pdfContentContract || "",
    headings: (window.GHRAB_MANUAL_EXPORT || [])
      .filter(x => x && x.type === "h3" && typeof x.text === "string")
      .map(x => x.text.trim()).filter(Boolean)
  }));
  if (editorial.contract === "map-tour-v1")
    assert(editorial.headings.length >= 5, "Map/tour is incomplete in runtime export");
  const pdfDownload = page.waitForEvent("download", {timeout: 120000});
  await page.evaluate(async () => {
    const {downloadManualPdf} = await import("/manualy/pdf-export.js");
    await downloadManualPdf(document, {
      title: document.title,
      filename: "manual-content-qa.pdf",
      extras: Array.isArray(window.GHRAB_MANUAL_EXPORT) ? window.GHRAB_MANUAL_EXPORT : []
    });
  });
  const pdfFile = await (await pdfDownload).path();
  const qaApp = process.env.MANUAL_APP_NAME || "korespondencni-asistent";
  const actualPdf = path.join(out, qaApp + "-full-manual.pdf");
  await import("node:fs/promises").then(fs => fs.copyFile(pdfFile, actualPdf));
  const pdfBuffer = await readFile(actualPdf);
  assert(pdfBuffer.toString("latin1", 0, 8).startsWith("%PDF-1."), "PDF signature invalid");
  const pdfText = execFileSync("pdftotext", ["-layout", actualPdf, "-"],
    {encoding: "utf8", timeout: 50000});
  const norm = t => t.replace(/\s+/g, " ").trim();
  const flatPdf = norm(pdfText);
  const expectedParts = [...editorial.headings.slice(0, 4), ...editorial.headings.slice(-4)]
    .filter(s => s.length < 75);
  for (const phrase of new Set(expectedParts))
    assert(flatPdf.includes(norm(phrase)), "PDF lost a map/tour heading: " + phrase);
  assert(!flatPdf.includes("Ověřuji přístup k manuálu"), "Access gate leaked into PDF");
  execFileSync("pdftoppm", ["-f", "1", "-l", "1", "-r", "140", "-png",
    "-singlefile", actualPdf, path.join(out, qaApp + "-pdf-first-page")],
    {timeout: 50000});
  await page.screenshot({path:path.join(out,appName+'-dark.png')});
  const themeSelector=await page.locator('#themeBtn,#manual-theme').count();
  if(themeSelector){await page.locator('#themeBtn,#manual-theme').first().click();await page.screenshot({path:path.join(out,appName+'-light.png')});}
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:path.join(out,appName+'-mobile.png')});
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
  assert(overflow<=2,'Horizontal overflow in mobile manual: '+overflow+'px');
  await page.goto(origin+'/manual/index.html?from=app');
  await page.waitForFunction(()=>document.documentElement.dataset.ghrabAccess==='granted');
  await page.locator('#ghrab-manual-navigation a').first().waitFor({state:'visible'});
  assert.deepEqual(await page.locator('#ghrab-manual-navigation a').allTextContents(),['← Zpět do aplikace','AI Studio']);
  await page.goto(origin+'/manual/index.html');
  await page.locator('#ghrab-manual-navigation a').first().waitFor({state:'visible'});
  assert.deepEqual(await page.locator('#ghrab-manual-navigation a').allTextContents(),['AI Studio']);
  await page.goto(origin+'/AI-Studio-GHRAB/manualy/viewer.html');
  const frame=page.frameLocator('#manual-frame');
  await frame.locator('html[data-ghrab-access="granted"]').waitFor({timeout:20000});
  assert.equal(await frame.locator('#ghrab-manual-navigation').count(),0,'Duplicate embedded navigation');
  assert.equal(await frame.locator('#ghrab-manual-pdf').count(),0,'Duplicate embedded PDF');
  if(errors.length)throw Error('Browser page errors: '+errors.join(' | '));
  console.log(JSON.stringify({ok:true,app:appName,contrast,overflow,contexts:4,screenshots:themeSelector?3:2}));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
