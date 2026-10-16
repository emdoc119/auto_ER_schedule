'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {privateDirectory}=require('./state');
const {randomBytes}=require('node:crypto');
const {authClient,SCOPE,WRITE_SCOPE}=require('./calendar');
const write=process.argv.includes('--write');
const tokenFile=write?process.env.AER_OAUTH_WRITE_TOKEN_FILE:process.env.AER_OAUTH_TOKEN_FILE;
const auth=authClient(), state=randomBytes(32).toString('hex');
if(!tokenFile || !path.isAbsolute(tokenFile))throw Error('Absolute private OAuth token path required');
privateDirectory(path.dirname(tokenFile));
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1:8788');
  if(req.headers.host!=='127.0.0.1:8788' || url.pathname!=='/callback' || url.searchParams.get('state')!==state){res.writeHead(403).end();return;}
  try{
    const {tokens}=await auth.getToken(url.searchParams.get('code'));
    if(!tokens.refresh_token) throw Error('Refresh token missing');
    fs.writeFileSync(tokenFile,JSON.stringify(tokens),{mode:0o600,flag:'wx'});
    res.end('Authorization saved. You may close this tab.');
  }catch{res.writeHead(400).end('Authorization failed; no credentials logged.');}
  server.close();
});
server.listen(8788,'127.0.0.1',()=>console.log(auth.generateAuthUrl({access_type:'offline',prompt:'consent',scope:[write?WRITE_SCOPE:SCOPE],state})));
setTimeout(()=>server.close(),300000).unref();
