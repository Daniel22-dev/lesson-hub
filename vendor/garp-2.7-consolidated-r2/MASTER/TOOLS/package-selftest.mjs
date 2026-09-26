#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url)); const root=path.resolve(here,'..','..');
const required=[
 '00-CTI-ME.txt','01-GARP-2.7-BEZPECNOSTNI-PROTOKOL.md','02-AUDIT-VSTUPNIHO-BALIKU.md','03-RED-TEAM-KATALOG.json','04-IMPLEMENTACNI-ZADANI.txt','10-CONSOLIDATION-R2-G02.md',
 'MASTER/CONTRACTS/garp27-core.json','MASTER/INVENTORY/ecosystem-apps.json','MASTER/TOOLS/validate-policy.mjs','MASTER/TOOLS/validate-assurance.mjs','MASTER/TOOLS/validate-auto-patch.mjs','MASTER/TOOLS/validate-live-status.mjs','MASTER/TOOLS/validate-runtime-test-request.mjs','MASTER/TOOLS/contract-selftest.mjs'
];
const checks=[]; for(const rel of required) checks.push({id:`file:${rel}`,pass:fs.existsSync(path.join(root,rel))});
let catalog={}; try{catalog=JSON.parse(fs.readFileSync(path.join(root,'03-RED-TEAM-KATALOG.json'),'utf8'));}catch{}
const cases=Array.isArray(catalog)?catalog:(catalog.tests||catalog.cases||catalog.testCases||[]); checks.push({id:'red-team-catalog-nonempty',pass:Array.isArray(cases)&&cases.length>=67});
const core=JSON.parse(fs.readFileSync(path.join(root,'MASTER/CONTRACTS/garp27-core.json'),'utf8'));
checks.push({id:'garp-version-2.7',pass:core.garpVersion==='2.7'});
checks.push({id:'server-deferred',pass:core.serverPhase==='DEFERRED_BY_OWNER_DECISION'});
const requiredSections=Array.isArray(core.requiredPolicySections)?core.requiredPolicySections:[];
const semanticSections=core?.policyValidation?.requiredSectionSemantics||{};
checks.push({id:'policy-semantic-contract-complete',pass:requiredSections.length>0&&requiredSections.every(k=>Array.isArray(semanticSections?.[k]?.anyOf)&&semanticSections[k].anyOf.length>0)});
let inventory={}; try{inventory=JSON.parse(fs.readFileSync(path.join(root,'MASTER/INVENTORY/ecosystem-apps.json'),'utf8'));}catch{}
const ids=Array.isArray(inventory.apps)?inventory.apps.map(x=>x?.appId).filter(Boolean):[];
checks.push({id:'ecosystem-inventory-nonempty-unique',pass:ids.length>0&&new Set(ids).size===ids.length});
const pass=checks.every(c=>c.pass); const digest=crypto.createHash('sha256').update(JSON.stringify(checks)).digest('hex');
console.log(JSON.stringify({classification:'PACKAGE_SELFTEST',status:pass?'PASS':'FAIL',checks:checks.length,passed:checks.filter(c=>c.pass).length,scope:'package-integrity-and-contract-consistency-only',appBehaviorTest:false,liveTest:false,checkDigest:digest,details:checks},null,2)); process.exit(pass?0:1);
