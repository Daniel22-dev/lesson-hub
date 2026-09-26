#!/usr/bin/env node
import fs from 'node:fs';
const checks=[]; const add=(id,pass,detail='')=>checks.push({id,pass,detail});
const d=fs.readFileSync('src/access/deployment-config.js','utf8');
add('no-direct-provider-capability',!d.includes('direct-provider'));
add('no-local-provider-keys',!d.includes('allowLocalProviderKeys: true'));
const s=fs.readFileSync('src/services/serverService.js','utf8');
add('session-cleared-on-origin-change',s.includes('nextBaseUrl !== currentBaseUrl')&&s.includes('this.clearSession()'));
const dispatch=fs.readFileSync('scripts/test-ai-studio-dispatch.mjs','utf8');
add('dispatch-expects-garp27',dispatch.includes("GARP_PROFILE: 'GARP-2.7-FOUNDATION'"));
const failed=checks.filter(x=>!x.pass).length;
console.log(JSON.stringify({classification:'LESSON_HUB_GARP27_MUTATIONS',status:failed?'FAIL':'PASS',checks},null,2));
process.exit(failed?1:0);
