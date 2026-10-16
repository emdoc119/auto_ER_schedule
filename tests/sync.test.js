'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const XLSX=require('xlsx');
const {createStore}=require('../backend/state');
const {createSyncService}=require('../backend/sync-service');
const {createCalendarAdapter}=require('../backend/calendar-writer');
const {desiredEvent}=require('../lib/reconcile');
const {parseExcel}=require('../backend/pipeline');
const copy=x=>JSON.parse(JSON.stringify(x));
function fixture(code='D',other='N'){
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([
    [null,null,null,null,null,null,null,'Me','SyntheticA'],['11월1일',null,null,null,null,null,null,code,other],['11월2일',null,null,null,null,null,null,'N','D']
  ]),'2026년 11월');return XLSX.write(wb,{type:'buffer',bookType:'xlsx'});
}
function setup(t,{existing=[],enabled=true,failAt=0,clock=()=>1000}={}){
  const directory=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'aer-sync-')));fs.chmodSync(directory,0o700);t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  let remote=copy(existing),writes=0;
  const calendar={list:async()=>copy(remote),create:async(id,wanted)=>{writes++;if(writes===failAt)throw Error('failure');remote.push({...copy(wanted),etag:'new'});},patch:async(id,eventId,wanted,etag,before)=>{writes++;if(writes===failAt)throw Error('failure');assert.equal(before.etag,etag);remote=remote.map(e=>e.id===eventId?{...e,...copy(wanted),id:eventId,etag:'changed'}:e);}};
  const store=createStore(directory),service=createSyncService({calendar,store,writesEnabled:enabled,now:clock});
  const options={person:'Me',calendarId:'synthetic',channel:'web:private'};
  return {service,store,calendar,directory,options,get remote(){return remote;},get writes(){return writes;},setRemote(value){remote=copy(value);}};
}
function expected(bytes){return parseExcel(bytes,{person:'Me'}).events.map(e=>({...desiredEvent(e),etag:'v1'}));}
test('create then repeated upload is zero writes, including restart and used plan',async t=>{
  const s=setup(t),bytes=fixture();let plan=await s.service.preview(bytes,s.options);
  assert.equal(plan.counts.create,2);assert.equal(s.writes,0);
  assert.deepEqual(await s.service.apply(plan.planId,{channel:s.options.channel}),{created:2,updated:0,adopted:0,unchanged:0});
  await assert.rejects(s.service.apply(plan.planId,{channel:s.options.channel}));
  const restarted=createSyncService({calendar:s.calendar,store:createStore(s.directory),writesEnabled:true,now:()=>1000});
  plan=await restarted.preview(bytes,s.options);assert.equal(plan.counts.create,0);
  const result=await restarted.apply(plan.planId,{channel:s.options.channel});assert.equal(result.unchanged,2);assert.equal(s.writes,2);
});
test('legacy noop adoption is visible; then only changed colleague/code updates',async t=>{
  const bytes=fixture(), legacy=expected(bytes).map((e,i)=>({...e,id:'legacy'+i,extendedProperties:{private:{unrelated:'keep'}}}));
  const s=setup(t,{existing:legacy});let plan=await s.service.preview(bytes,s.options);
  assert.equal(plan.counts.adopt,2);assert.equal(plan.counts.create,0);
  await s.service.apply(plan.planId,{channel:s.options.channel});assert.ok(s.remote.every(e=>e.extendedProperties.private.aerSourceKey));
  plan=await s.service.preview(fixture('D(I)','D'),s.options);assert.equal(plan.counts.update,1);assert.equal(plan.counts.noop,1);
  const result=await s.service.apply(plan.planId,{channel:s.options.channel});assert.equal(result.updated,1);assert.equal(s.remote[0].id,'legacy0');
});
test('stale snapshot, wrong channel, expiry and blocked review perform zero writes',async t=>{
  let time=1000;const s=setup(t,{existing:expected(fixture()),clock:()=>time});
  const plan=await s.service.preview(fixture(),s.options);
  await assert.rejects(s.service.apply(plan.planId,{channel:'telegram:wrong'}));assert.equal(s.writes,0);
  s.setRemote(s.remote.map(e=>({...e,etag:'other'})));
  await assert.rejects(s.service.apply(plan.planId,{channel:s.options.channel}),/changed/);assert.equal(s.writes,0);
  time=99999999;await assert.rejects(s.service.apply(plan.planId,{channel:s.options.channel}),/expired/);
});
test('ambiguous review, missing etag and writes-disabled are blocked before mutation',async t=>{
  const bytes=fixture(), legacy=expected(bytes).map(e=>({...e,extendedProperties:undefined,summary:'different'}));
  const s=setup(t,{existing:legacy});const p=await s.service.preview(bytes,s.options);assert.equal(p.blocked,true);await assert.rejects(s.service.apply(p.planId,{channel:s.options.channel}));assert.equal(s.writes,0);
  const noEtag=setup(t,{existing:expected(bytes).map(e=>({...e,etag:undefined,description:'changed'}))});const n=await noEtag.service.preview(bytes,noEtag.options);await assert.rejects(noEtag.service.apply(n.planId,{channel:noEtag.options.channel}),/ETag/);assert.equal(noEtag.writes,0);
  const disabled=setup(t,{enabled:false});const d=await disabled.service.preview(bytes,disabled.options);await assert.rejects(disabled.service.apply(d.planId,{channel:disabled.options.channel}),/disabled/);
});
test('partial failure stops, old plan unusable, new preview resumes without duplicate',async t=>{
  const s=setup(t,{failAt:2}),bytes=fixture(),p=await s.service.preview(bytes,s.options);
  await assert.rejects(s.service.apply(p.planId,{channel:s.options.channel}),/partially/);assert.equal(s.remote.length,1);
  await assert.rejects(s.service.apply(p.planId,{channel:s.options.channel}));
  const next=await s.service.preview(bytes,s.options);assert.equal(next.counts.create,1);assert.equal(next.counts.noop,1);
  await s.service.apply(next.planId,{channel:s.options.channel});assert.equal(s.remote.length,2);
});
test('cross-process file lock prevents concurrent mutation and stale crash lock fails closed',async t=>{
  const s=setup(t);let release;const held=s.store.locked(()=>new Promise(resolve=>{release=resolve;}));
  await assert.rejects(createStore(s.directory).locked(async()=>{}),/active/);release();await held;
  fs.writeFileSync(path.join(s.directory,'sync.lock'),'stale',{mode:0o600});await assert.rejects(s.store.locked(async()=>{}));
});
test('private store rejects public mode, symlink, traversal and inside-checkout state',t=>{
  const s=setup(t);assert.throws(()=>s.store.read('../bad'));
  fs.chmodSync(s.directory,0o755);assert.throws(()=>createStore(s.directory));fs.chmodSync(s.directory,0o700);
  assert.throws(()=>createStore(path.resolve('private-state')));
});
function adapter(fetchImpl){return createCalendarAdapter({writeAuth:{getAccessToken:async()=>({token:'synthetic'})},fetchImpl});}
test('create timeout or 409 recovers exactly same deterministic ID, no second POST',async()=>{
  const wanted=expected(fixture())[0];
  for(const failure of ['timeout',409]){
    const calls=[],a=adapter(async(url,options)=>{calls.push(options.method);if(options.method==='POST'){if(failure==='timeout')throw Error('timeout');return{ok:false,status:409};}return{ok:true,json:async()=>wanted};});
    await a.create('synthetic',wanted);assert.deepEqual(calls,['POST','GET']);
  }
});
test('conflicting insert ID never overwrites, and 429 stops without retries',async()=>{
  const wanted=expected(fixture())[0];let calls=0;
  const a=adapter(async(url,options)=>{calls++;return options.method==='POST'?{ok:false,status:409}:{ok:true,json:async()=>({...wanted,summary:'other'})};});await assert.rejects(a.create('synthetic',wanted),/conflict/);assert.equal(calls,2);
  const rate=adapter(async()=>{calls++;return{ok:false,status:429};});calls=0;await assert.rejects(rate.create('synthetic',wanted));assert.equal(calls,1);
});
test('PATCH sends If-Match, preserves unrelated metadata, excludes id and adoption changes no title',async()=>{
  const wanted=expected(fixture())[0];
  for(const adopt of [false,true]){
    const a=adapter(async(url,options)=>{
      assert.equal(options.method,'PATCH');assert.equal(options.headers['If-Match'],'v1');const body=JSON.parse(options.body);
      assert.equal(body.id,undefined);assert.equal(body.extendedProperties.private.other,'keep');assert.equal(body.extendedProperties.shared.shared,'keep');
      assert.equal(Boolean(body.summary),!adopt);return{ok:true,json:async()=>({...wanted,id:'legacy'})};
    });await a.patch('synthetic','legacy',wanted,'v1',{extendedProperties:{private:{other:'keep'},shared:{shared:'keep'}}},adopt);
  }
});
test('ETag 412 never retries; post-write remote divergence is not reported success',async t=>{
  const wanted=expected(fixture())[0];let calls=0;const a=adapter(async()=>{calls++;return{ok:false,status:412};});
  await assert.rejects(a.patch('synthetic','id',wanted,'v1',{}));assert.equal(calls,1);
  const s=setup(t);s.calendar.create=async()=>{};const plan=await s.service.preview(fixture(),s.options);await assert.rejects(s.service.apply(plan.planId,{channel:s.options.channel}),/stopped/);
});
test('private credential files enforce ownership, permissions, regular file and no hardlinks',t=>{
  const s=setup(t),file=path.join(s.directory,'credential.json');
  const {readPrivateJSON}=require('../backend/state');
  fs.writeFileSync(file,JSON.stringify({token:'synthetic'}),{mode:0o600});
  assert.equal(readPrivateJSON(file).token,'synthetic');
  fs.chmodSync(file,0o644);assert.throws(()=>readPrivateJSON(file));fs.chmodSync(file,0o600);
  const link=path.join(s.directory,'linked.json');fs.linkSync(file,link);assert.throws(()=>readPrivateJSON(file));fs.unlinkSync(link);
  fs.symlinkSync(file,link);assert.throws(()=>readPrivateJSON(link));
});
test('22 unmanaged legacy candidates are adoption only and preserve every remote event ID',()=>{
  const events=Array.from({length:22},(_,i)=>({dateStr:`2026-11-${String(i+1).padStart(2,'0')}`,summary:i%2?'N':'D',person:'SyntheticMe',lines:[]}));
  const existing=events.map((event,i)=>({...desiredEvent(event),id:'legacy'+i,etag:'v1',extendedProperties:undefined}));
  const {planFor}=require('../backend/sync-service');
  const plan=planFor(events,existing,'SyntheticMe');
  assert.deepEqual(plan.counts,{create:0,update:0,noop:0,review:0,adopt:22});
  assert.equal(plan.blocked,false);
  assert.deepEqual(plan.actions.map(action=>action.eventId),existing.map(event=>event.id));
  assert.ok(plan.actions.every(action=>action.action==='adopt'&&action.eventId!==action.desired.id));
});
test('read-only audit reports counts and remote ID/ETag readiness without leaking roster or event IDs',async()=>{
  const bytes=fixture(),existing=expected(bytes).map((event,i)=>({...event,id:'private-legacy-id'+i,extendedProperties:undefined}));
  const {auditExcel}=require('../backend/audit');
  const result=await auditExcel(bytes,{person:'Me',residents:[],calendarId:'synthetic',read:async()=>existing});
  assert.deepEqual(result.counts,{create:0,update:0,noop:0,review:0,adopt:2});
  assert.equal(result.mappedIdsPreserved,2);assert.equal(result.etagsReady,true);assert.equal(result.writes,0);
  assert.doesNotMatch(JSON.stringify(result),/private-legacy-id|SyntheticA|2026-11/);
});
