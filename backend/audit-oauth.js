'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {randomBytes,createHash}=require('node:crypto');
const {privateDirectory}=require('./state');
const AUDIT_SCOPE='https://www.googleapis.com/auth/calendar.events.owned.readonly';
function assertAuditGrant(info){
  if(!Array.isArray(info?.scopes) || info.scopes.length!==1 || info.scopes[0]!==AUDIT_SCOPE)throw Error('Fresh owned-events readonly grant required');
}
async function createAuditAuthorization({auth,tokenFile,port=8788,timeoutMs=300000}){
  if(!auth || !tokenFile || !path.isAbsolute(tokenFile))throw Error('Private audit OAuth configuration required');
  privateDirectory(path.dirname(tokenFile));
  if(fs.existsSync(tokenFile))throw Error('Audit token already exists; refuse overwrite');
  const state=randomBytes(32).toString('hex'),verifier=randomBytes(32).toString('base64url');
  const challenge=createHash('sha256').update(verifier).digest('base64url');
  let claimed=false,redirect;
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
    const url=new URL(req.url,'http://127.0.0.1');
    if(req.method!=='GET' || req.headers.host!==`127.0.0.1:${server.address().port}` || url.pathname!=='/callback' || url.searchParams.get('state')!==state){res.writeHead(403).end();return;}
    if(claimed){res.writeHead(409).end();return;}
    claimed=true;
    try{
      if(url.searchParams.has('error') || !url.searchParams.get('code'))throw Error('Consent rejected');
      const {tokens}=await auth.getToken({code:url.searchParams.get('code'),codeVerifier:verifier,redirect_uri:redirect});
      if(!tokens?.refresh_token || !tokens?.access_token)throw Error('Fresh token missing');
      assertAuditGrant(await auth.getTokenInfo(tokens.access_token));
      const fd=fs.openSync(tokenFile,'wx',0o600);
      try{fs.writeFileSync(fd,JSON.stringify({...tokens,scope:AUDIT_SCOPE}));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
      res.end('Read-only audit authorization saved. No Calendar writes performed.');
    }catch{res.writeHead(400).end('Audit authorization failed. No token was logged. Use a fresh audit-only OAuth client.');}
    server.close();
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  redirect=`http://127.0.0.1:${server.address().port}/callback`;
  let url;
  try{url=auth.generateAuthUrl({redirect_uri:redirect,access_type:'offline',prompt:'consent',include_granted_scopes:false,scope:[AUDIT_SCOPE],state,code_challenge:challenge,code_challenge_method:'S256'});}catch(error){server.close();throw error;}
  const timer=setTimeout(()=>server.close(),timeoutMs);timer.unref();server.on('close',()=>clearTimeout(timer));
  return {server,url};
}
module.exports={AUDIT_SCOPE,assertAuditGrant,createAuditAuthorization};
