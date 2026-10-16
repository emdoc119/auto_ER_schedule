'use strict';
const fs=require('node:fs');
const {parseExcel}=require('./pipeline');
const {listEvents}=require('./calendar');
const {planFor}=require('./sync-service');
// Direct read-only Calendar API, no plan persistence, write adapter or Telegram transport.
async function auditExcel(bytes,{person,residents,calendarId,read=listEvents}){
  if(!Array.isArray(residents))throw Error('Explicit resident configuration required');
  const {events,range,person:normalizedPerson}=parseExcel(bytes,{person,residents});
  const existing=await read(calendarId,range.start,range.end),plan=planFor(events,existing,normalizedPerson);
  const mapped=plan.actions.filter(action=>['adopt','update','noop'].includes(action.action));
  const modifying=mapped.filter(action=>action.action!=='noop');
  return {counts:plan.counts,desiredCount:events.length,existingCount:existing.length,blocked:plan.blocked,
    mappedIdsPreserved:mapped.filter(action=>action.eventId===action.before.id).length,
    etagsReady:modifying.every(action=>typeof action.etag==='string'&&action.etag.length>0),
    writes:0};
}
if(require.main===module){
  Promise.resolve().then(async()=>{
    if(!process.argv[2] || !process.env.AER_RESIDENTS)throw Error('File and explicit private configuration required');
    const result=await auditExcel(fs.readFileSync(process.argv[2]),{person:process.env.AER_PERSON,residents:JSON.parse(process.env.AER_RESIDENTS),calendarId:process.env.AER_CALENDAR_ID});
    console.log(JSON.stringify(result,null,2));
  }).catch(()=>{console.error('Read-only audit failed. Verify private OAuth, calendar and workbook configuration. No writes performed.');process.exitCode=1;});
}
module.exports={auditExcel};
