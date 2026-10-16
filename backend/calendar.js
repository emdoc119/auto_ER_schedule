'use strict';
const {readPrivateJSON}=require('./state');
const {OAuth2Client}=require('google-auth-library');
const {AUDIT_SCOPE,assertAuditGrant}=require('./audit-oauth');
const WRITE_SCOPE='https://www.googleapis.com/auth/calendar.events.owned';
const SCOPE='https://www.googleapis.com/auth/calendar.events.readonly';
function authClient(){
  const document=readPrivateJSON(process.env.AER_OAUTH_CLIENT_FILE);
  const c=document.installed;
  if(!c) throw Error('Desktop OAuth client required');
  return new OAuth2Client(c.client_id,c.client_secret,'http://127.0.0.1:8788/callback');
}
async function listEvents(calendarId,start,end,{auth,fetchImpl=fetch,audit=false}={}){
  if(!calendarId || calendarId==='primary') throw Error('Explicit AER duty calendar ID required');
  auth ||= authClient();
  if(!auth.credentials?.refresh_token) auth.setCredentials(readPrivateJSON(audit?process.env.AER_AUDIT_OAUTH_TOKEN_FILE:process.env.AER_OAUTH_TOKEN_FILE));
  const {token}=await auth.getAccessToken();
  if(!token) throw Error('OAuth unavailable');
  if(audit)assertAuditGrant(await auth.getTokenInfo(token));
  const items=[], seen=new Set(); let pageToken;
  do {
    const url=new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
    Object.entries({timeMin:start+'T00:00:00+09:00',timeMax:end+'T00:00:00+09:00',timeZone:'Asia/Seoul',singleEvents:'true',showDeleted:'true',maxResults:'2500',...(pageToken?{pageToken}:{})}).forEach(([k,v])=>url.searchParams.set(k,v));
    if(audit)url.searchParams.set('fields','kind,summary,accessRole,timeZone,nextPageToken,items(id,etag,status,summary,description,start,end,extendedProperties,recurringEventId)');
    const response=await fetchImpl(url,{method:'GET',headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20000)});
    if(!response.ok) throw Error(`Calendar read failed (${response.status}); no plan produced`);
    const page=await response.json();
    if(audit && (page.kind!=='calendar#events' || page.accessRole!=='owner'))throw Error('Owned raw Calendar response required');
    if(audit && (!Array.isArray(page.items) || page.items.some(e=>typeof e.id!=='string' || !e.id || typeof e.etag!=='string' || !e.etag)))throw Error('Raw event ETags required');
    if(page.summary!=='AER duty') throw Error('Target calendar must be AER duty');
    if(!Array.isArray(page.items) || page.items.some(e=>!e.id)) throw Error('Invalid Calendar response');
    for(const item of page.items){if(seen.has(item.id))throw Error('Repeated event across pages');seen.add(item.id);items.push(item);}
    pageToken=page.nextPageToken;
    if(pageToken){if(seen.has('page:'+pageToken))throw Error('Repeated Calendar page');seen.add('page:'+pageToken);}
  }while(pageToken);
  return items;
}
async function listAuditEvents(calendarId,start,end,options={}){return listEvents(calendarId,start,end,{...options,audit:true});}
module.exports={WRITE_SCOPE,SCOPE,AUDIT_SCOPE,authClient,listEvents,listAuditEvents};
