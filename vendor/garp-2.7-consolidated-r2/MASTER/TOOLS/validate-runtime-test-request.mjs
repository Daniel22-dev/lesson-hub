#!/usr/bin/env node
import {readJson, parseArgs, fail, pass, notTested, harnessError, validIso} from './lib.mjs';
try {
  const a=parseArgs(process.argv.slice(2)); const file=a._[0]; if(!file) throw new Error('usage: validate-runtime-test-request.mjs REQUEST.json');
  const x=readJson(file), errors=[];
  if(x.schema!=='garp27-runtime-test-request-v1'||x.garpVersion!=='2.7') errors.push('schema/version');
  if(!x.testId||!['STAGING_ONLY','PROD_SAFE_CONDITIONAL','READ_ONLY'].includes(x.safetyClass)) errors.push('testId/safetyClass');
  if(!['local','ci','staging','production'].includes(x.environment)) errors.push('environment');
  if(errors.length) fail('Runtime test request invalid',errors);
  if(x.environment==='production' && x.safetyClass==='STAGING_ONLY') notTested({reason:'STAGING_ONLY_TEST_CANNOT_RUN_IN_PRODUCTION',testId:x.testId});
  if(x.environment==='production' && x.safetyClass==='PROD_SAFE_CONDITIONAL') {
    const approved=x.approval?.approved===true && validIso(x.approval?.expiresAt) && Date.parse(x.approval.expiresAt)>Date.now();
    const targetOk=x.target?.allowlisted===true && x.target?.dedicatedSink===true;
    const limitsOk=Number.isInteger(x.limits?.requests)&&x.limits.requests>0&&x.limits.requests<=10&&Number.isInteger(x.limits?.bytes)&&x.limits.bytes>0&&x.limits.bytes<=1048576;
    if(!(approved&&targetOk&&limitsOk)) notTested({reason:'PRODUCTION_PRECONDITIONS_NOT_MET',testId:x.testId});
  }
  pass({testId:x.testId,environment:x.environment,safetyClass:x.safetyClass,executionAllowed:true});
} catch(e){ harnessError(e); }
