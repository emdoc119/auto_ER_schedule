'use strict';
const {createHash}=require('node:crypto');
const {addDays}=require('./aer-parser');
const digest=value=>createHash('sha256').update(value).digest('hex');
const sourceKey=(person,date)=>digest(JSON.stringify(['aer-v1',person,date]));
const text=value=>String(value||'').replace(/\s+/g,' ').trim();
function desiredEvent(ev){
  const key=sourceKey(ev.person,ev.dateStr);
  return {id:'aer'+key,summary:ev.summary,description:ev.lines.map(([k,v])=>`${k}: ${v}`).join('\n'),
    start:{date:ev.dateStr},end:{date:addDays(ev.dateStr,1)},
    extendedProperties:{private:{aerSourceKey:key,aerOwner:digest(ev.person)}}};
}
function equal(a,b){
  return a.summary===b.summary && a.start?.date===b.start.date && a.end?.date===b.end.date && !a.start?.dateTime && !a.end?.dateTime && text(a.description)===text(b.description);
}
function reconcile(events,existing,person){
  const desired=events.map(desiredEvent), actions=[], matched=new Set();
  if(new Set(desired.map(e=>e.id)).size!==desired.length) throw Error('Duplicate source dates');
  for(const wanted of desired){
    const key=wanted.extendedProperties.private.aerSourceKey;
    const sameDay=existing.filter(e=>e.start?.date===wanted.start.date || e.start?.dateTime?.slice(0,10)===wanted.start.date);
    const tracked=existing.filter(e=>e.extendedProperties?.private?.aerSourceKey===key || e.id===wanted.id);
    // One duty per owner/day. Any second candidate is ambiguous, even with an exact title match.
    const candidates=[...new Set([...tracked,...sameDay])];
    const exact=candidates.length===1 && candidates[0].summary===wanted.summary;
    const owned=candidates.length===1 && tracked.includes(candidates[0]);
    if(candidates.length>1 || (candidates.length===1 && (!exact&&!owned || candidates[0].status==='cancelled' || candidates[0].recurringEventId || candidates[0].start?.dateTime))){
      actions.push({action:'review',reason:'ambiguous-or-legacy-change',date:wanted.start.date,candidateIds:candidates.map(e=>e.id),desired:wanted});
      candidates.forEach(e=>matched.add(e.id)); continue;
    }
    const remote=candidates[0];
    if(!remote) actions.push({action:'create',desired:wanted});
    else {
      matched.add(remote.id);
      actions.push({action:equal(remote,wanted)?'noop':'update',eventId:remote.id,etag:remote.etag,legacy:!owned,before:remote,desired:wanted});
    }
  }
  // Removed duties and date moves must never be silently deleted or recreated.
  const owner=digest(person);
  for(const remote of existing){
    if(!matched.has(remote.id)) actions.push({action:'review',reason:remote.extendedProperties?.private?.aerOwner===owner?'missing-from-upload':'unmatched-existing',eventId:remote.id});
  }
  const counts={create:0,update:0,noop:0,review:0};
  actions.forEach(a=>counts[a.action]++);
  const blocked=counts.review>0;
  return {mode:'dry-run',writesEnabled:false,blocked,counts,actions,
    note:'Preview only. Re-read and explicitly approve a fresh plan before any future write.'};
}
module.exports={desiredEvent,reconcile,sourceKey};
