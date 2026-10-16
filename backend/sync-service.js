'use strict';
const {randomBytes,createHash}=require('node:crypto');
const {parseExcel}=require('./pipeline');
const {reconcile}=require('../lib/reconcile');
function canonical(value){
  if(Array.isArray(value))return value.map(canonical);
  if(value && typeof value==='object')return Object.fromEntries(Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>[k,canonical(value[k])]));
  return value;
}
function fingerprint(plan){return createHash('sha256').update(JSON.stringify(canonical(plan.actions))).digest('hex');}
function planFor(events,existing,person){
  const plan=reconcile(events,existing,person);
  plan.counts.adopt=0;
  for(const action of plan.actions){
    if(action.action==='noop' && action.legacy){action.action='adopt';plan.counts.noop--;plan.counts.adopt++;}
  }
  return plan;
}
function createSyncService({calendar,store,writesEnabled=false,now=()=>Date.now(),ttlMs=15*60*1000}){
  if(!calendar || !store)throw Error('Calendar and private store required');
  return {
    async preview(bytes,{person,residents=[],calendarId,channel}){
      if(!channel || !calendarId || calendarId==='primary')throw Error('Bound calendar/channel required');
      if(store.prune)store.prune(now());
      const parsed=parseExcel(bytes,{person,residents});
      const existing=await calendar.list(calendarId,parsed.range.start,parsed.range.end);
      const plan=planFor(parsed.events,existing,parsed.person), planId=randomBytes(16).toString('hex');
      const result={...plan,planId,range:parsed.range,existingCount:existing.length,writesEnabled,expiresAt:now()+ttlMs};
      store.write(planId,{...parsed,calendarId,channel,expiresAt:result.expiresAt,plan:result,status:'preview'});
      return result;
    },
    async apply(planId,{channel}){
      if(!writesEnabled)throw Error('Calendar writing is disabled');
      return store.locked(async()=>{
        const saved=store.read(planId);
        if(saved.channel!==channel || saved.status!=='preview' || saved.expiresAt<=now())throw Error('Plan expired, already used or wrong channel');
        if(saved.plan.blocked)throw Error('Review required; plan cannot be applied');
        const existing=await calendar.list(saved.calendarId,saved.range.start,saved.range.end);
        const fresh=planFor(saved.events,existing,saved.person);
        if(fresh.blocked || fingerprint(fresh)!==fingerprint(saved.plan))throw Error('Calendar changed; create a new preview');
        // Preflight ALL update conditions before performing the first write.
        for(const a of fresh.actions)if(['update','adopt'].includes(a.action) && !a.etag)throw Error('ETag required; create a new preview');
        saved.status='applying';store.write(planId,saved);
        const result={created:0,updated:0,unchanged:0,adopted:0};
        try{
          for(const action of fresh.actions){
            if(action.action==='noop'){result.unchanged++;continue;}
            if(action.action==='create'){
              await calendar.create(saved.calendarId,action.desired);result.created++;
            }else if(action.action==='update' || action.action==='adopt'){
              await calendar.patch(saved.calendarId,action.eventId,action.desired,action.etag,action.before,action.action==='adopt');
              result[action.action==='adopt'?'adopted':'updated']++;
            }else throw Error('Unsupported operation');
            saved.progress=result;store.write(planId,saved);
          }
          const after=await calendar.list(saved.calendarId,saved.range.start,saved.range.end);
          const verified=planFor(saved.events,after,saved.person);
          if(verified.blocked || verified.actions.some(a=>a.action!=='noop'))throw Error('Post-write verification requires review');
          store.write(planId,{status:'applied',channel:saved.channel,expiresAt:saved.expiresAt,result});
          return result;
        }catch{
          store.write(planId,{status:'failed',channel:saved.channel,expiresAt:saved.expiresAt,progress:result});
          throw Error('Sync stopped; changes may be partially applied. Create a new preview before retrying.');
        }
      });
    }
  };
}
module.exports={createSyncService,planFor,fingerprint};
