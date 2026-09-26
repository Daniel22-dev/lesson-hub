#!/usr/bin/env node
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readJson, parseArgs, nonEmptyObject, fail, pass, harnessError} from './lib.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const defaultInventory=path.resolve(here,'..','INVENTORY','ecosystem-apps.json');
const SEMVER_RE=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function appIdsFromInventory(inv){
  const ids=new Set();
  const add=v=>{const s=String(v||'').trim(); if(s) ids.add(s);};
  if(Array.isArray(inv?.apps)) for(const app of inv.apps){add(app?.appId ?? app?.id); if(Array.isArray(app?.aliases)) app.aliases.forEach(add);}
  if(Array.isArray(inv?.appIds)) inv.appIds.forEach(add);
  if(Array.isArray(inv?.runtimeInventory)) for(const item of inv.runtimeInventory) add(item?.appId ?? item?.id);
  if(typeof inv?.appId==='string') add(inv.appId);
  return ids;
}

function placeholderReason(value, exactBad, substrings){
  const s=String(value||'').trim();
  const lower=s.toLowerCase();
  if(!s) return '';
  if(exactBad.has(lower)) return 'forbidden placeholder value';
  if(/<[^>]+>/.test(s)) return 'angle-bracket placeholder';
  for(const token of substrings) if(token && lower.includes(token)) return `placeholder substring: ${token}`;
  return '';
}

function scanPlaceholders(value, exactBad, substrings, p='', errors=[]){
  if(typeof value==='string'){
    const why=placeholderReason(value,exactBad,substrings);
    if(why) errors.push(`${p||'<root>'}: ${why}`);
  } else if(Array.isArray(value)){
    value.forEach((v,i)=>scanPlaceholders(v,exactBad,substrings,`${p}[${i}]`,errors));
  } else if(value && typeof value==='object'){
    for(const [k,v] of Object.entries(value)){
      const keyPath=p?`${p}.${k}`:k;
      const keyWhy=placeholderReason(k,exactBad,substrings);
      if(keyWhy) errors.push(`${keyPath}: placeholder key (${keyWhy})`);
      scanPlaceholders(v,exactBad,substrings,keyPath,errors);
    }
  }
  return errors;
}

function meaningful(v){
  if(typeof v==='string') return v.trim().length>0;
  if(typeof v==='number') return Number.isFinite(v);
  if(typeof v==='boolean') return true;
  if(Array.isArray(v)) return v.length>0;
  if(v && typeof v==='object') return Object.keys(v).length>0;
  return false;
}

try {
  const a=parseArgs(process.argv.slice(2));
  const file=a._[0];
  if(!file || !a.core) throw new Error('usage: validate-policy.mjs POLICY.json --core CORE.json [--inventory INVENTORY.json]');
  const core=readJson(a.core);
  const x=readJson(file);
  const inventoryPath=typeof a.inventory==='string' ? a.inventory : defaultInventory;
  const inventory=readJson(inventoryPath);
  const errors=[];

  if(x.schema!=='garp27-policy-v1') errors.push('schema');
  if(x.garpVersion!=='2.7') errors.push('garpVersion must be 2.7; legacy 2.5/2.6 requires explicit migration review');
  if(!x.appId || !x.appVersion) errors.push('app identity');

  const allowedAppIds=appIdsFromInventory(inventory);
  if(!allowedAppIds.size) errors.push('inventory contains no admissible appId');
  else if(!allowedAppIds.has(String(x.appId||'').trim())) errors.push(`appId not present in inventory: ${x.appId||'<missing>'}`);

  const version=String(x.appVersion||'').trim();
  const policyCfg=core.policyValidation||{};
  if(policyCfg.requireSemver!==false && version && !SEMVER_RE.test(version)) errors.push(`appVersion is not valid semver: ${version}`);
  const forbiddenVersions=new Set((policyCfg.forbiddenAppVersions||['0.0.0']).map(v=>String(v).trim()));
  if(forbiddenVersions.has(version)) errors.push(`appVersion ${version} is not admissible`);

  for(const key of core.requiredPolicySections||[]){
    if(!nonEmptyObject(x[key])) errors.push(`${key}: required non-empty object`);
  }

  const semantics=policyCfg.requiredSectionSemantics||{};
  for(const key of core.requiredPolicySections||[]){
    const rule=semantics[key];
    if(!rule || !Array.isArray(rule.anyOf) || !rule.anyOf.length){
      errors.push(`${key}: semantic contract missing from core`);
      continue;
    }
    if(!nonEmptyObject(x[key])) continue;
    const matches=rule.anyOf.filter(field=>Object.prototype.hasOwnProperty.call(x[key],field) && meaningful(x[key][field]));
    const min=Math.max(1,Number(rule.minMatches)||1);
    if(matches.length<min) errors.push(`${key}: requires at least ${min} semantic field(s) from [${rule.anyOf.join(', ')}]`);
  }

  const exactBad=new Set((core.forbiddenPlaceholderValues||[]).map(v=>String(v).trim().toLowerCase()).filter(Boolean));
  const substrings=(core.forbiddenPlaceholderSubstrings||[]).map(v=>String(v).trim().toLowerCase()).filter(Boolean);
  scanPlaceholders(x,exactBad,substrings,'',errors);

  const unique=[...new Set(errors)];
  if(unique.length) fail('GARP 2.7 policy is not admissible',unique);
  pass({contract:'garp27-policy-v1',appId:x.appId,appVersion:x.appVersion,inventory:inventoryPath});
} catch(e){ harnessError(e); }
