'use strict';
const XLSX=require('xlsx');
const {parseWorkbook,buildEvents,addDays}=require('../lib/aer-parser');
const {reconcile}=require('../lib/reconcile');
const {listEvents}=require('./calendar');
// Transport independent: web and a future authorized Telegram receiver use this exact entry point.
function parseExcel(bytes,{person,residents=[]}){
  if(!Buffer.isBuffer(bytes) || bytes.length>8*1024*1024 || bytes.length<4 || bytes[0]!==0x50 || bytes[1]!==0x4b) throw Error('Valid .xlsx required (max 8 MiB)');
  if(typeof person!=='string' || !person.trim() || person.length>100 || !Array.isArray(residents) || residents.some(n=>typeof n!=='string')) throw Error('Invalid person/residents');
  person=person.trim();
  const workbook=XLSX.read(bytes,{type:'buffer',cellFormula:false,bookVBA:false});
  const data=parseWorkbook(workbook,person,XLSX), events=buildEvents(data,person,residents);
  const dates=Object.keys(data).sort();
  if(!dates.length || dates.length>400 || dates.at(-1)>addDays(dates[0],400)) throw Error('Upload range too large');
  // Query whole uploaded months, including days now marked off, for moved/cancelled legacy duties.
  const start=dates[0].slice(0,7)+'-01';
  const last=dates.at(-1).slice(0,7)+'-01';
  const end=addDays(last,32).slice(0,7)+'-01';
  return {events,person,range:{start,end}};
}
async function previewExcel(bytes,{calendarId,readEvents=listEvents,...options}){
  const {events,person,range}=parseExcel(bytes,options);
  const existing=await readEvents(calendarId,range.start,range.end);
  return {...reconcile(events,existing,person),range,existingCount:existing.length};
}
module.exports={parseExcel,previewExcel};
