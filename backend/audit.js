'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {privateDirectory}=require('./state');
const {parseExcel}=require('./pipeline');
const {listAuditEvents}=require('./calendar');
const {planFor}=require('./sync-service');
// Direct read-only Calendar API, no plan persistence, write adapter or Telegram transport.
async function auditExcel(bytes,{person,residents,calendarId,read=listAuditEvents,reportFile}){
  if(!Array.isArray(residents))throw Error('Explicit resident configuration required');
  const {events,range,person:normalizedPerson}=parseExcel(bytes,{person,residents});
  const existing=await read(calendarId,range.start,range.end),plan=planFor(events,existing,normalizedPerson);
  const mapped=plan.actions.filter(action=>['adopt','update','noop'].includes(action.action));
  const modifying=mapped.filter(action=>action.action!=='noop');
  if(reportFile){
    if(!path.isAbsolute(reportFile))throw Error('Absolute private report path required');
    privateDirectory(path.dirname(reportFile));
    const evidence={auditedAt:new Date().toISOString(),calendarId,range,counts:plan.counts,
      events:existing.map(event=>({id:event.id,etag:event.etag,start:event.start,end:event.end,private:event.extendedProperties?.private||{}})),
      mappings:plan.actions.map(action=>({action:action.action,eventId:action.eventId,candidateIds:action.candidateIds,expectedSourceKey:action.desired?.extendedProperties?.private?.aerSourceKey}))};
    const fd=fs.openSync(reportFile,'wx',0o600);
    try{fs.writeFileSync(fd,JSON.stringify(evidence,null,2));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  }
  return {...(reportFile?{privateReportSaved:true}:{}),counts:plan.counts,desiredCount:events.length,existingCount:existing.length,blocked:plan.blocked,
    mappedIdsPreserved:mapped.filter(action=>action.eventId===action.before.id).length,
    etagsReady:modifying.every(action=>typeof action.etag==='string'&&action.etag.length>0),
    writes:0};
}
if(require.main===module){
  Promise.resolve().then(async()=>{
    const args=process.argv.slice(2);
    if(!args[0] || (args.length!==1 && (args.length!==3 || args[1]!=='--private-report')) || !process.env.AER_RESIDENTS)throw Error('File and explicit private configuration required');
    const result=await auditExcel(fs.readFileSync(process.argv[2]),{person:process.env.AER_PERSON,residents:JSON.parse(process.env.AER_RESIDENTS),calendarId:process.env.AER_CALENDAR_ID,reportFile:args[2]});
    console.log(JSON.stringify(result,null,2));
  }).catch(()=>{console.error('Read-only audit failed. Verify private OAuth, calendar and workbook configuration. No writes performed.');process.exitCode=1;});
}
module.exports={auditExcel};
