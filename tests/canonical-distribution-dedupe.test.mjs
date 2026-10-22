import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, readFile, stat, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {dedupeStage04Assets} from '../scripts/stage04-asset-dedupe.mjs';

async function fixture({iconConflict=false,dataConflict=false,purpose='maskable'}={}) {
  const dir=await mkdtemp(path.join(os.tmpdir(),'lesson-hub-stage04-'));
  for(const p of ['icons','src/config','config'])await mkdir(path.join(dir,p),{recursive:true});
  const icon=Buffer.from([137,80,78,71,13,10,26,10,1,2,3,4]);
  await writeFile(path.join(dir,'icons/icon-512.png'),icon);
  await writeFile(path.join(dir,'icons/icon-maskable-512.png'),iconConflict?Buffer.concat([icon,Buffer.from([9])]):icon);
  const data=Buffer.from('{"schema":"lesson-hub-local-fixture-v1"}\n');
  await writeFile(path.join(dir,'src/config/data-manifest.json'),data);
  await writeFile(path.join(dir,'config/data-manifest.json'),dataConflict?Buffer.from('changed\n'):data);
  const m={id:'/lesson-hub/',icons:[
    {src:'./icons/icon-512.png',sizes:'512x512',type:'image/png',purpose:'any'},
    {src:'./icons/icon-maskable-512.png',sizes:'512x512',type:'image/png',purpose},
  ]};
  await writeFile(path.join(dir,'manifest.webmanifest'),JSON.stringify(m,null,2)+'\n');
  return {dir,m,cleanup:()=>rm(dir,{recursive:true,force:true})};
}

const exists=async path=>stat(path).then(()=>true,()=>false);

test('identical assets are deduplicated and maskable purpose remains available',async()=>{
  const f=await fixture();try{
    const result=await dedupeStage04Assets(f.dir);
    assert.equal(result.reusedMaskableBytes,12);
    assert.equal(result.eliminatedDuplicateManifestBytes,41);
    assert.ok(result.savingsBytes>=45);
    assert.equal(await exists(path.join(f.dir,'icons/icon-maskable-512.png')),false);
    assert.equal(await exists(path.join(f.dir,'src/config/data-manifest.json')),false);
    assert.equal(await exists(path.join(f.dir,'config/data-manifest.json')),true);
    const icons=JSON.parse(await readFile(path.join(f.dir,'manifest.webmanifest'),'utf8')).icons;
    assert.equal(icons.length,2);
    assert.equal(icons[0].purpose,'any');assert.equal(icons[1].purpose,'maskable');
    assert.equal(icons[0].src,icons[1].src);
  }finally{await f.cleanup()}
});

test('different maskable image fails before any file mutation',async()=>{
  const f=await fixture({iconConflict:true});try{
    const original=await readFile(path.join(f.dir,'manifest.webmanifest'),'utf8');
    await assert.rejects(dedupeStage04Assets(f.dir),/STAGE04_MASKABLE_IMAGE_NOT_IDENTICAL/);
    assert.equal(await exists(path.join(f.dir,'icons/icon-maskable-512.png')),true);
    assert.equal(await exists(path.join(f.dir,'src/config/data-manifest.json')),true);
    assert.equal(await readFile(path.join(f.dir,'manifest.webmanifest'),'utf8'),original);
  }finally{await f.cleanup()}
});

test('mismatched data manifests cannot be deduplicated',async()=>{
  const f=await fixture({dataConflict:true});try{
    await assert.rejects(dedupeStage04Assets(f.dir),/STAGE04_DATA_MANIFEST_NOT_IDENTICAL/);
    assert.equal(await exists(path.join(f.dir,'src/config/data-manifest.json')),true);
    assert.equal(await exists(path.join(f.dir,'icons/icon-maskable-512.png')),true);
  }finally{await f.cleanup()}
});

test('unexpected maskable manifest purpose fails closed',async()=>{
  const f=await fixture({purpose:'any'});try{
    await assert.rejects(dedupeStage04Assets(f.dir),/STAGE04_PWA_ICON_CONTRACT_CHANGED/);
    assert.equal(await exists(path.join(f.dir,'icons/icon-maskable-512.png')),true);
  }finally{await f.cleanup()}
});

test('missing source image fails closed',async()=>{
  const f=await fixture();try{
    await rm(path.join(f.dir,'icons/icon-512.png'));
    await assert.rejects(dedupeStage04Assets(f.dir),/ENOENT/);
    assert.equal(await exists(path.join(f.dir,'icons/icon-maskable-512.png')),true);
  }finally{await f.cleanup()}
});