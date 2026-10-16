'use strict';
const {readPrivateJSON}=require('./state');
const {authClient,listEvents}=require('./calendar');
const {equal}=require('../lib/reconcile');
function sameManaged(actual,wanted){
  return actual && actual.status!=='cancelled' && !actual.recurringEventId && equal(actual,wanted)
    && actual.extendedProperties?.private?.aerSourceKey===wanted.extendedProperties.private.aerSourceKey
    && actual.extendedProperties?.private?.aerOwner===wanted.extendedProperties.private.aerOwner;
}
function createCalendarAdapter({read=listEvents,writeAuth,fetchImpl=fetch}={}){
  async function request(calendarId,method,eventId,body,etag){
    if(!calendarId || calendarId==='primary')throw Error('Explicit AER duty target required');
    if(!writeAuth){writeAuth=authClient();writeAuth.setCredentials(readPrivateJSON(process.env.AER_OAUTH_WRITE_TOKEN_FILE));}
    const {token}=await writeAuth.getAccessToken();
    if(!token)throw Error('Write OAuth unavailable');
    const url=new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events${eventId?'/'+encodeURIComponent(eventId):''}`);
    if(method!=='GET')url.searchParams.set('sendUpdates','none');
    const response=await fetchImpl(url,{method,headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{}),...(etag?{'If-Match':etag}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
    if(!response.ok){const error=new Error('Calendar operation failed');error.status=response.status;throw error;}
    return response.json();
  }
  async function recover(calendarId,id,wanted){
    const found=await request(calendarId,'GET',id);
    if(!sameManaged(found,wanted))throw Error('Existing ID conflicts or mutation unverified');
    return found;
  }
  return {
    list:read,
    async create(calendarId,wanted){
      try{
        const result=await request(calendarId,'POST',null,wanted);
        if(result.id!==wanted.id || !sameManaged(result,wanted))throw Error('Create response unverified');
        return result;
      }catch(error){
        if(error.status && error.status!==409 && error.status<500)throw error;
        // Timeout or 409 may mean insert already committed. Never generate a new ID.
        return recover(calendarId,wanted.id,wanted);
      }
    },
    async patch(calendarId,id,wanted,etag,before,adoptOnly=false){
      if(!etag)throw Error('ETag required');
      const {id:ignored,extendedProperties,...fields}=wanted;
      const body={...(adoptOnly?{}:fields),extendedProperties:{...before.extendedProperties,private:{...before.extendedProperties?.private,...extendedProperties.private}}};
      try{
        const result=await request(calendarId,'PATCH',id,body,etag);
        if(result.id!==id || !sameManaged(result,wanted))throw Error('Update response unverified');
        return result;
      }catch(error){
        if(error.status && error.status<500)throw error;
        return recover(calendarId,id,wanted);
      }
    }
  };
}
module.exports={createCalendarAdapter,sameManaged};
