'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createServer}=require('../backend/server');
const http=require('node:http');
function fetch(url,options={}){
  return new Promise((resolve,reject)=>{
    const req=http.request(url,{method:options.method||'GET',headers:options.headers||{}},res=>{
      res.resume();res.on('end',()=>resolve({status:res.statusCode,headers:{get:name=>Array.isArray(res.headers[name])?res.headers[name][0]:res.headers[name]}}));
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
  const post={method:'POST',headers:{...headers,Origin:'http://127.0.0.1:8787',Cookie:cookie,'Content-Type':'application/json','X-AER-Preview':'1'},body:JSON.stringify({xlsx:'UEs=',person:'Me',residents:[]})};
  assert.equal((await fetch(url+'/api/preview',post)).status,200);
  for(const change of [{Origin:'https://evil.invalid'},{Cookie:''},{'X-AER-Preview':''}])assert.equal((await fetch(url+'/api/preview',{...post,headers:{...post.headers,...change}})).status,403);
  for(const route of ['/api/apply','/api/sync','/api/delete'])assert.equal((await fetch(url+route,post)).status,404);
  assert.equal(previews,1);
});
test('apply is session-bound and shares CSRF protection; preview and apply use same service',async t=>{
  const calls=[];
  const service={preview:async(bytes,options)=>{calls.push(['preview',options.channel]);return{planId:'synthetic',writesEnabled:true};},apply:async(id,options)=>{calls.push(['apply',options.channel]);assert.equal(id,'synthetic');return{created:0};}};
  const server=createServer({calendarId:'synthetic',service,writesEnabled:true});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
  const url=`http://127.0.0.1:${server.address().port}`, headers={Host:'127.0.0.1:8787'};
  const home=await fetch(url+'/',{headers}),cookie=home.headers.get('set-cookie').split(';')[0];
  const options={method:'POST',headers:{...headers,Origin:'http://127.0.0.1:8787',Cookie:cookie,'Content-Type':'application/json','X-AER-Preview':'1'},body:JSON.stringify({xlsx:'UEs=',person:'Me',residents:[]})};
  assert.equal((await fetch(url+'/api/preview',options)).status,200);
  assert.equal((await fetch(url+'/api/apply',{...options,body:JSON.stringify({planId:'synthetic'})})).status,200);
  assert.equal(calls[0][1],calls[1][1]);assert.match(calls[0][1],/^web:/);
  assert.equal((await fetch(url+'/api/apply',{...options,headers:{...options.headers,Origin:'https://evil.invalid'}})).status,403);
});
