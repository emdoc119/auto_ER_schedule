'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {createHash}=require('node:crypto');
const {AUDIT_SCOPE,assertAuditGrant,createAuditAuthorization}=require('../backend/audit-oauth');
const {listAuditEvents}=require('../backend/calendar');
const {auditExcel}=require('../backend/audit');
const XLSX=require('xlsx');
function temp(t){const dir=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'aer-audit-oauth-')));fs.chmodSync(dir,0o700);t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
function get(url,headers={}){return new Promise((resolve,reject)=>{http.get(url,{headers},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));}).on('error',reject);});}
function authFixture(scopes=[AUDIT_SCOPE]){
  let request,exchange,infoCalls=0;
  const auth={credentials:{refresh_token:'synthetic'},getAccessToken:async()=>({token:'synthetic-access'}),
    generateAuthUrl:options=>{request=options;return 'https://accounts.google.com/o/oauth2/v2/auth';},
    getToken:async options=>{exchange=options;return{tokens:{access_token:'synthetic-access',refresh_token:'synthetic-refresh'}};},
    getTokenInfo:async()=>{infoCalls++;return{scopes};}};
  return {auth,get request(){return request;},get exchange(){return exchange;},get infoCalls(){return infoCalls;}};
}
test('audit accepts only the least owned-event read scope, rejecting broader readonly and write grants',()=>{
  assert.doesNotThrow(()=>assertAuditGrant({scopes:[AUDIT_SCOPE]}));
  for(const scopes of [undefined,[],['https://www.googleapis.com/auth/calendar.events.readonly'],['https://www.googleapis.com/auth/calendar'],['https://www.googleapis.com/auth/calendar.events.owned'],[AUDIT_SCOPE,'openid']])assert.throws(()=>assertAuditGrant({scopes}));
});
test('audit consent requests one readonly scope with PKCE/state, verifies grant and stores a private fresh token',async t=>{
  const dir=temp(t),tokenFile=path.join(dir,'audit-token.json'),f=authFixture();
  const {server}=await createAuditAuthorization({auth:f.auth,tokenFile,port:0});t.after(()=>server.close());
  assert.deepEqual(f.request.scope,[AUDIT_SCOPE]);assert.equal(f.request.include_granted_scopes,false);assert.equal(f.request.code_challenge_method,'S256');
  const base=`http://127.0.0.1:${server.address().port}/callback`;
  assert.equal(await get(base+'?state=bad&code=synthetic'),403);assert.equal(f.exchange,undefined);
  assert.equal(await get(base+`?state=${f.request.state}&code=synthetic`,{Host:'evil.invalid'}),403);
  assert.equal(await get(base+`?state=${f.request.state}&code=synthetic`),200);
  assert.equal(createHash('sha256').update(f.exchange.codeVerifier).digest('base64url'),f.request.code_challenge);
  assert.equal(f.exchange.redirect_uri,f.request.redirect_uri);assert.equal(f.infoCalls,1);
  assert.equal(fs.statSync(tokenFile).mode&0o777,0o600);assert.equal(JSON.parse(fs.readFileSync(tokenFile)).scope,AUDIT_SCOPE);
});
test('broader grant, denied consent, missing refresh token and pre-existing token fail without overwriting',async t=>{
  const dir=temp(t);
  for(const mode of ['broader','denied','no-refresh']){
    const tokenFile=path.join(dir,mode+'.json'),f=authFixture(mode==='broader'?[AUDIT_SCOPE,'https://www.googleapis.com/auth/calendar.events']:undefined);
    if(mode==='no-refresh')f.auth.getToken=async()=>({tokens:{access_token:'synthetic'}});
    const {server}=await createAuditAuthorization({auth:f.auth,tokenFile,port:0});t.after(()=>server.close());
    const url=`http://127.0.0.1:${server.address().port}/callback?state=${f.request.state}&${mode==='denied'?'error=access_denied':'code=synthetic'}`;
    assert.equal(await get(url),400);assert.equal(fs.existsSync(tokenFile),false);
  }
  const existing=path.join(dir,'exists.json');fs.writeFileSync(existing,'unchanged',{mode:0o600});
  await assert.rejects(createAuditAuthorization({auth:authFixture().auth,tokenFile:existing,port:0}));assert.equal(fs.readFileSync(existing,'utf8'),'unchanged');
});
test('audit-only authorization command refuses write flags before credential loading or network',()=>{
  const {spawnSync}=require('node:child_process');
  const result=spawnSync(process.execPath,[path.resolve(__dirname,'../backend/authorize-audit.js'),'--write'],{encoding:'utf8',env:{}});
  assert.equal(result.status,1);assert.match(result.stderr,/Audit-only OAuth setup failed/);assert.doesNotMatch(result.stderr,/synthetic-refresh/);
});
test('raw audit GETs expose per-event IDs, ETags and private properties with explicit projection and strict grant check',async()=>{
  const f=authFixture(),requests=[];
  const items=await listAuditEvents('synthetic','2026-11-01','2027-01-01',{auth:f.auth,fetchImpl:async(url,options)=>{
    requests.push(options.method);assert.equal(f.infoCalls,1);assert.match(url.searchParams.get('fields'),/extendedProperties/);assert.match(url.searchParams.get('fields'),/etag/);
    return{ok:true,json:async()=>({kind:'calendar#events',summary:'AER duty',accessRole:'owner',items:[{id:'legacy',etag:'"v1"',extendedProperties:{private:{aerSourceKey:'synthetic'}}}]})};
  }});
  assert.deepEqual(requests,['GET']);assert.equal(items[0].etag,'"v1"');assert.equal(items[0].extendedProperties.private.aerSourceKey,'synthetic');
});
test('scope failures stop before Calendar GET, and stripped/unauthorized raw metadata prevents confirmed audit',async()=>{
  let gets=0;
  await assert.rejects(listAuditEvents('synthetic','2026-11-01','2027-01-01',{auth:authFixture(['https://www.googleapis.com/auth/calendar']).auth,fetchImpl:async()=>{gets++;}}));assert.equal(gets,0);
  for(const page of [{summary:'AER duty',items:[]},{kind:'calendar#events',summary:'AER duty',accessRole:'reader',items:[]},{kind:'calendar#events',summary:'AER duty',accessRole:'owner',items:[{id:'legacy'}]}]){
    await assert.rejects(listAuditEvents('synthetic','2026-11-01','2027-01-01',{auth:authFixture().auth,fetchImpl:async()=>({ok:true,json:async()=>page})}));
  }
});
function bytes(){const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([[null,null,null,null,null,null,null,'SyntheticMe'],['11월1일',null,null,null,null,null,null,'D']]),'2026년11월');return XLSX.write(wb,{type:'buffer',bookType:'xlsx'});}
test('optional ID/private/ETag evidence is private, outside checkout, exclusive and absent from aggregate stdout',async t=>{
  const dir=temp(t),file=path.join(dir,'evidence.json');
  const read=async()=>[{id:'private-legacy-id',etag:'"v1"',start:{date:'2026-11-01'},end:{date:'2026-11-02'},summary:'D',extendedProperties:{private:{other:'private-value'}}}];
  const options={person:'SyntheticMe',residents:[],calendarId:'synthetic',read,reportFile:file};
  const result=await auditExcel(bytes(),options);
  assert.equal(result.counts.adopt,1);assert.equal(result.privateReportSaved,true);assert.equal(result.writes,0);
  assert.doesNotMatch(JSON.stringify(result),/private-legacy-id|private-value/);
  assert.equal(fs.statSync(file).mode&0o777,0o600);
  const saved=JSON.parse(fs.readFileSync(file));assert.equal(saved.events[0].id,'private-legacy-id');assert.equal(saved.events[0].private.other,'private-value');assert.equal(saved.mappings[0].eventId,'private-legacy-id');
  await assert.rejects(auditExcel(bytes(),options));
  await assert.rejects(auditExcel(bytes(),{...options,reportFile:path.resolve('evidence.json')}));
});
