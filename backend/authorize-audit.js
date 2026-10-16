'use strict';
const {authClient}=require('./calendar');
const {createAuditAuthorization}=require('./audit-oauth');
if(require.main===module){
  Promise.resolve().then(async()=>{
    if(process.argv.length!==2)throw Error('Audit-only command accepts no flags');
    const {url}=await createAuditAuthorization({auth:authClient(),tokenFile:process.env.AER_AUDIT_OAUTH_TOKEN_FILE});
    console.log('Open this audit-only Google consent URL in your own browser:');
    console.log(url);
  }).catch(()=>{console.error('Audit-only OAuth setup failed. Check private Desktop client/token paths; no tokens logged.');process.exitCode=1;});
}
