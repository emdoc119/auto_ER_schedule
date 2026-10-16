'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const XLSX=require('xlsx');
const {parseWorkbook,buildEvents}=require('../lib/aer-parser');
const {previewExcel}=require('../backend/pipeline');
const {reconcile,desiredEvent}=require('../lib/reconcile');
const {listEvents}=require('../backend/calendar');
function workbook(rows,name='2026년 11월'){
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([
    [null,null,null,null,null,null,null,'Me','ColleagueA','ColleagueB'],...rows.map(([date,...codes])=>[date,null,null,null,null,null,null,...codes])
  ]),name);return wb;
}
const bytes=wb=>XLSX.write(wb,{type:'buffer',bookType:'xlsx'});
const eventsFor=wb=>buildEvents(parseWorkbook(wb,'Me',XLSX),'Me',[]);
const sample=()=>workbook([['11월1일','D(I)','N(I)','D'],['11월2일','N(I)','D(I)','N'],['11월3일','O','D','N']]);
test('real synthetic XLSX byte path, all-day, clean descriptions and repeated upload',async()=>{
  const wb=sample(), wanted=eventsFor(wb).map(desiredEvent);
  const remote=wanted.map((e,i)=>({...e,id:'legacy'+i,extendedProperties:undefined}));
  let reads=0;
  const readEvents=async(id,start,end)=>{reads++;assert.equal(id,'synthetic');assert.equal(start,'2026-11-01');assert.equal(end,'2026-12-01');return remote;};
  for(let i=0;i<2;i++){
    const plan=await previewExcel(bytes(wb),{person:'Me',calendarId:'synthetic',readEvents});
    assert.deepEqual(plan.counts,{create:0,update:0,noop:2,review:0});assert.equal(plan.writesEnabled,false);
    assert.equal(plan.actions[0].desired.summary,'D(I)');
    for(const a of plan.actions){
      assert.ok(a.desired.start.date);assert.ok(a.desired.end.date);assert.equal(a.desired.start.dateTime,undefined);
      assert.doesNotMatch(a.desired.description,/ICU|없음|자료없음|AER_SOURCE_UID|기본 당직|원본 근무코드|근무 유형/);
    }
    assert.match(plan.actions[1].desired.description,/익일 D: ColleagueA/);
  }
  assert.equal(reads,2);
});
test('same dates corrected colleagues produce only changed update',()=>{
  const before=eventsFor(sample()).map(desiredEvent);
  const next=sample(); next.Sheets[next.SheetNames[0]].J2.v='N';
  const p=reconcile(eventsFor(next),before,'Me');
  assert.deepEqual(p.counts,{create:0,update:1,noop:1,review:0});
});
test('stable identity survives duty code/title change on managed event',()=>{
  const ev=eventsFor(sample())[0], previous=desiredEvent(ev);
  const p=reconcile([{...ev,summary:'N(I)'}],[previous],'Me');
  assert.equal(p.actions[0].action,'update');assert.equal(p.actions[0].eventId,previous.id);
});
test('legacy changed title and duplicate dates are review, never create',()=>{
  const ev=eventsFor(sample())[0], base=desiredEvent(ev);
  for(const existing of [[{...base,id:'legacy',extendedProperties:undefined,summary:'N'}],[{...base,id:'a'},{...base,id:'b'}]]){
    const p=reconcile([ev],existing,'Me');assert.equal(p.counts.create,0);assert.equal(p.counts.review,1);assert.equal(p.blocked,true);
  }
});
test('22 synthetic legacy events reconcile without new events',()=>{
  const events=Array.from({length:22},(_,i)=>({dateStr:`2026-11-${String(i+1).padStart(2,'0')}`,summary:i%2?'N':'D',person:'Me',lines:[['D','SyntheticA']]}));
  const existing=events.map((e,i)=>({...desiredEvent(e),id:'legacy'+i,extendedProperties:undefined}));
  assert.deepEqual(reconcile(events,existing,'Me').counts,{create:0,update:0,noop:22,review:0});
});
test('removed duties/date moves are review and whole plan blocked; no deletes',()=>{
  const ev=eventsFor(sample())[0];
  const p=reconcile([{...ev,dateStr:'2026-11-15'}],[desiredEvent(ev)],'Me');
  assert.equal(p.blocked,true);assert.equal(p.counts.review,1);assert.ok(p.actions.every(a=>a.action!=='delete'));
});
test('timed, recurring and cancelled candidates cannot be adopted',()=>{
  const ev=eventsFor(sample())[0], b=desiredEvent(ev);
  for(const remote of [{...b,start:{dateTime:ev.dateStr+'T09:00:00+09:00'}},{...b,recurringEventId:'rec'},{...b,status:'cancelled'}])assert.equal(reconcile([ev],[remote],'Me').counts.review,1);
});
test('new event has stable deterministic Google ID, separate private metadata',()=>{
  const ev=eventsFor(sample())[0], a=desiredEvent(ev), b=desiredEvent(ev);
  assert.equal(a.id,b.id);assert.match(a.id,/^[a-v0-9]{5,1024}$/);assert.doesNotMatch(a.description,/aerSourceKey|aerOwner/);
  assert.equal(reconcile([ev],[],'Me').counts.create,1);
});
for(const [label,wb] of [
  ['missing explicit year',workbook([['11월1일','D','N','D']],'11월')],
  ['bad day',workbook([['11월31일','D','N','D']])],
  ['unknown coworker',workbook([['11월1일','D','SURPRISE','D']])],
  ['unknown self',workbook([['11월1일','SURPRISE','N','D']])],
  ['duplicate day',workbook([['11월1일','D','N','D'],['11월1일','N','D','N']])]
])test('fail closed: '+label,async()=>{
  let reads=0;await assert.rejects(previewExcel(bytes(wb),{person:'Me',calendarId:'synthetic',readEvents:async()=>{reads++;return[];}}));assert.equal(reads,0);
});
test('missing person, duplicate name and malformed bytes rejected',async()=>{
  assert.throws(()=>parseWorkbook(sample(),'Other',XLSX));
  const wb=sample();wb.Sheets[wb.SheetNames[0]].I1.v='Me';assert.throws(()=>parseWorkbook(wb,'Me',XLSX));
  await assert.rejects(previewExcel(Buffer.from('bad'),{person:'Me'}));
});
test('month and year rollover handoff across sheets',()=>{
  const wb=workbook([['12월31일','N(I)','N','D']],'2026년 12월');
  const next=workbook([['1월1일','D(I)','D','N']],'2027년 1월');XLSX.utils.book_append_sheet(wb,next.Sheets[next.SheetNames[0]],'2027년 1월');
  const events=eventsFor(wb);assert.ok(events[0].lines.some(([k,v])=>k==='익일 D'&&v==='ColleagueA'));
  assert.equal(desiredEvent(events[0]).end.date,'2027-01-01');assert.equal(desiredEvent(events[1]).end.date,'2027-01-02');
});
test('read API exhausts pagination using GET only, KST window',async()=>{
  let n=0;const auth={credentials:{refresh_token:'fake'},getAccessToken:async()=>({token:'fake'})};
  const result=await listEvents('synthetic','2026-11-01','2027-01-01',{auth,fetchImpl:async(url,opts)=>{
    assert.equal(opts.method,'GET');assert.equal(url.searchParams.get('timeMin'),'2026-11-01T00:00:00+09:00');assert.equal(url.searchParams.get('showDeleted'),'true');
    n++;return {ok:true,json:async()=>n===1?{summary:'AER duty',items:[{id:'one'}],nextPageToken:'next'}:{summary:'AER duty',items:[{id:'two'}]}};
  }});assert.equal(result.length,2);assert.equal(n,2);
});
for(const status of [401,403,429,500])test('Calendar failure '+status+' stops preview',async()=>{
  await assert.rejects(listEvents('synthetic','2026-11-01','2026-12-01',{auth:{credentials:{refresh_token:'fake'},getAccessToken:async()=>({token:'fake'})},fetchImpl:async()=>({ok:false,status})}),new RegExp(String(status)));
});
module.exports={workbook,bytes};
test('wrong calendar summary, malformed page and looping pagination fail closed',async()=>{
  const auth={credentials:{refresh_token:'fake'},getAccessToken:async()=>({token:'fake'})};
  for(const page of [{summary:'Personal',items:[]},{summary:'AER duty'}, {summary:'AER duty',items:[],nextPageToken:'loop'}]){
    await assert.rejects(listEvents('synthetic','2026-11-01','2026-12-01',{auth,fetchImpl:async()=>({ok:true,json:async()=>page})}));
  }
});
test('empty personal roster produces no creates and flags existing duties',async()=>{
  const wb=workbook([['11월1일','O','N','D']]);
  const plan=await previewExcel(bytes(wb),{person:'Me',calendarId:'synthetic',readEvents:async()=>[desiredEvent(eventsFor(sample())[0])]});
  assert.equal(plan.counts.create,0);assert.equal(plan.counts.review,1);assert.equal(plan.blocked,true);
});
test('known ancillary coworker codes are readable but never added to D/N handoff groups',()=>{
  for(const code of ['ICU','EICU','외래/E1']){
    const wb=workbook([['11월1일','D(I)',code,'N(I)'],['11월2일','N(I)','D(I)',code]]);
    const events=eventsFor(wb);assert.equal(events.length,2);
    assert.ok(events[0].lines.every(([k,v])=>!v.includes('ColleagueA')));
    assert.ok(events[1].lines.some(([k,v])=>k==='D'&&v==='ColleagueA'));
    assert.throws(()=>eventsFor(workbook([['11월1일',code,'D','N']])));
  }
});
