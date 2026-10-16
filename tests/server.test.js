'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createServer}=require('../backend/server');
const http=require('node:http');
function fetch(url,options={}){
  return new Promise((resolve,reject)=>{
    const req=http.request(url,{method:options.method||'GET',headers:options.headers||{}},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>{const body=Buffer.concat(chunks).toString('utf8');resolve({status:res.statusCode,text:async()=>body,json:async()=>JSON.parse(body),headers:{get:name=>Array.isArray(res.headers[name])?res.headers[name][0]:res.headers[name]}});});
    });req.on('error',reject);req.end(options.body);
  });
}
test('local UI, health, origin/host/CSRF protections and absent write routes',async t=>{
  let previews=0;
  const server=createServer({calendarId:'synthetic',preview:async()=>{previews++;return{mode:'dry-run',writesEnabled:false};}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
  const url=`http://127.0.0.1:${server.address().port}`;
  const headers={Host:'127.0.0.1:8787'};
  assert.equal((await fetch(url+'/health',{headers})).status,200);
  assert.equal((await fetch(url+'/health')).status,403);
  const home=await fetch(url+'/',{headers});assert.equal(home.status,200);assert.match(home.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  const cookie=home.headers.get('set-cookie').split(';')[0];
  const csrf=(await home.text()).match(/name="aer-csrf" content="([0-9a-f]{64})"/)[1];
  const post={method:'POST',headers:{...headers,Origin:'http://127.0.0.1:8787',Cookie:cookie,'Content-Type':'application/json','X-AER-Preview':'1','X-AER-CSRF':csrf},body:JSON.stringify({xlsx:'UEs=',person:'Me',residents:[]})};
  assert.equal((await fetch(url+'/api/preview',post)).status,200);
  for(const change of [{Origin:'https://evil.invalid'},{Cookie:''},{'X-AER-Preview':''},{'X-AER-CSRF':''}])assert.equal((await fetch(url+'/api/preview',{...post,headers:{...post.headers,...change}})).status,403);
  for(const route of ['/api/apply','/api/sync','/api/delete'])assert.equal((await fetch(url+route,post)).status,404);
  assert.equal(previews,1);
});
test('apply is session-bound and shares CSRF protection; preview and apply use same service',async t=>{
  const calls=[];
  const service={preview:async(bytes,options)=>{calls.push(['preview',options.channel]);return{planId:'synthetic',writesEnabled:true};},apply:async(id,options)=>{calls.push(['apply',options.channel]);assert.equal(id,'synthetic');return{created:0};}};
  const server=createServer({calendarId:'synthetic',service,writesEnabled:true});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
  const url=`http://127.0.0.1:${server.address().port}`, headers={Host:'127.0.0.1:8787'};
  const home=await fetch(url+'/',{headers}),cookie=home.headers.get('set-cookie').split(';')[0];
  const csrf=(await home.text()).match(/name="aer-csrf" content="([0-9a-f]{64})"/)[1];
  const options={method:'POST',headers:{...headers,Origin:'http://127.0.0.1:8787',Cookie:cookie,'Content-Type':'application/json','X-AER-Preview':'1','X-AER-CSRF':csrf},body:JSON.stringify({xlsx:'UEs=',person:'Me',residents:[]})};
  assert.equal((await fetch(url+'/api/preview',options)).status,200);
  assert.equal((await fetch(url+'/api/apply',{...options,body:JSON.stringify({planId:'synthetic'})})).status,200);
  assert.equal(calls[0][1],calls[1][1]);assert.match(calls[0][1],/^web:/);
  assert.equal((await fetch(url+'/api/apply',{...options,headers:{...options.headers,Origin:'https://evil.invalid'}})).status,403);
});
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),XLSX=require('xlsx');
const {createStore}=require('../backend/state');
const {createSyncService}=require('../backend/sync-service');
function xlsx(){
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([
    [null,null,null,null,null,null,null,'SyntheticMe'],['11월1일',null,null,null,null,null,null,'D']
  ]),'2026년11월');return XLSX.write(wb,{type:'buffer',bookType:'xlsx'}).toString('base64');
}
async function serve(t,service,sessionOptions){
  const server=createServer({calendarId:'synthetic',service,writesEnabled:true,sessionOptions});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>server.close());
  const url=`http://127.0.0.1:${server.address().port}`;
  return {url,close:()=>new Promise(resolve=>server.close(resolve))};
}
async function browser(url,cookie){
  const res=await fetch(url+'/',{headers:{Host:'127.0.0.1:8787',...(cookie?{Cookie:cookie}:{})}});
  assert.equal(res.status,200);
  const token=(await res.text()).match(/name="aer-csrf" content="([0-9a-f]{64})"/)[1];
  return {cookie:res.headers.get('set-cookie')?.split(';')[0]||cookie,token};
}
function post(url,session,route,body,extra={}){
  return fetch(url+route,{method:'POST',headers:{Host:'127.0.0.1:8787',Origin:'http://127.0.0.1:8787',Cookie:session.cookie,'X-AER-CSRF':session.token,'X-AER-Preview':'1','Content-Type':'application/json',...extra},body:JSON.stringify(body)});
}
function serviceFixture(t){
  const directory=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'aer-web-isolation-')));fs.chmodSync(directory,0o700);
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  let writes=0,remote=[];
  const calendar={list:async()=>JSON.parse(JSON.stringify(remote)),create:async(id,event)=>{writes++;remote.push({...event,etag:'v1'});},patch:async()=>{writes++;}};
  const service=()=>createSyncService({calendar,store:createStore(directory),writesEnabled:true});
  return {service,get writes(){return writes;}};
}
const upload={xlsx:xlsx(),person:'SyntheticMe',residents:[]};
test('independent browsers cannot use each other CSRF tokens or approve each other persistent PLAN IDs',async t=>{
  const fixture=serviceFixture(t),server=await serve(t,fixture.service());
  const a=await browser(server.url),b=await browser(server.url);
  assert.notEqual(a.cookie,b.cookie);assert.notEqual(a.token,b.token);
  const plan=await (await post(server.url,a,'/api/preview',upload)).json();
  assert.equal(plan.counts.create,1);
  assert.equal((await post(server.url,b,'/api/apply',{planId:plan.planId},{'X-AER-CSRF':a.token})).status,403);
  assert.equal((await post(server.url,a,'/api/apply',{planId:plan.planId},{'X-AER-CSRF':b.token})).status,403);
  assert.equal((await post(server.url,b,'/api/apply',{planId:plan.planId})).status,400);
  assert.equal(fixture.writes,0);
  const reload=await browser(server.url,a.cookie);assert.equal(reload.token,a.token);assert.equal(reload.cookie,a.cookie);
  assert.equal((await post(server.url,reload,'/api/apply',{planId:plan.planId})).status,200);
  assert.equal(fixture.writes,1);
  assert.equal((await post(server.url,a,'/api/apply',{planId:plan.planId})).status,400);
});
test('server restart rejects old cookies/tokens and old PLAN IDs even when private plan store persists',async t=>{
  const fixture=serviceFixture(t),first=await serve(t,fixture.service()),a=await browser(first.url);
  const plan=await (await post(first.url,a,'/api/preview',upload)).json();
  await first.close();
  const second=await serve(t,fixture.service());
  assert.equal((await post(second.url,a,'/api/apply',{planId:plan.planId})).status,403);
  const newSession=await browser(second.url,a.cookie);
  assert.notEqual(newSession.cookie,a.cookie);assert.notEqual(newSession.token,a.token);
  assert.equal((await post(second.url,newSession,'/api/apply',{planId:plan.planId})).status,400);
  assert.equal(fixture.writes,0);
  const fresh=await (await post(second.url,newSession,'/api/preview',upload)).json();
  assert.equal((await post(second.url,newSession,'/api/apply',{planId:fresh.planId})).status,200);
  assert.equal(fixture.writes,1);
});
test('expired sessions, fixation, duplicate cookies and malformed tokens fail closed',async t=>{
  let now=1000;const fixture=serviceFixture(t),server=await serve(t,fixture.service(),{now:()=>now,ttlMs:100});
  const a=await browser(server.url);const unknown='aer_session='+'a'.repeat(64);
  assert.equal((await post(server.url,a,'/api/preview',upload,{'X-AER-CSRF':'0'})).status,403);
  assert.equal((await post(server.url,a,'/api/preview',upload,{Cookie:a.cookie+'; '+a.cookie})).status,403);
  assert.equal((await post(server.url,a,'/api/preview',upload,{Cookie:unknown})).status,403);
  const fixed=await browser(server.url,unknown);assert.notEqual(fixed.cookie,unknown);
  now=1100;
  assert.equal((await post(server.url,a,'/api/preview',upload)).status,403);
  assert.equal(fixture.writes,0);
});
