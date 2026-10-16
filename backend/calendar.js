'use strict';
const fs=require('node:fs');
const {OAuth2Client}=require('google-auth-library');
const SCOPE='https://www.googleapis.com/auth/calendar.events.readonly';
function authClient(){
  const document=JSON.parse(fs.readFileSync(process.env.AER_OAUTH_CLIENT_FILE,'utf8'));
  const c=document.installed;
  if(!c) throw Error('Desktop OAuth client required');
  return new OAuth2Client(c.client_id,c.client_secret,'http://127.0.0.1:8788/callback');
}
async function listEvents(calendarId,start,end,{auth,fetchImpl=fetch}={}){
  if(!calendarId || calendarId==='primary') throw Error('Explicit AER duty calendar ID required');
  auth ||= authClient();
  if(!auth.credentials?.refresh_token) auth.setCredentials(JSON.parse(fs.readFileSync(process.env.AER_OAUTH_TOKEN_FILE,'utf8')));
  const {token}=await auth.getAccessToken();
  if(!token) throw Error('OAuth unavailable');
  const items=[], seen=new Set(); let pageToken;
  do {
    const url=new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
    Object.entries({timeMin:start+'T00:00:00+09:00',timeMax:end+'T00:00:00+09:00',timeZone:'Asia/Seoul',singleEvents:'true',showDeleted:'true',maxResults:'2500',...(pageToken?{pageToken}:{})}).forEach(([k,v])=>url.searchParams.set(k,v));
    const response=await fetchImpl(url,{method:'GET',headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20000)});
    if(!response.ok) throw Error(`Calendar read failed (${response.status}); no plan produced`);
    const page=await response.json();
    if(page.summary!=='AER duty') throw Error('Target calendar must be AER duty');
    if(!Array.isArray(page.items) || page.items.some(e=>!e.id)) throw Error('Invalid Calendar response');
    for(const item of page.items){if(seen.has(item.id))throw Error('Repeated event across pages');seen.add(item.id);items.push(item);}
    pageToken=page.nextPageToken;
    if(pageToken){if(seen.has('page:'+pageToken))throw Error('Repeated Calendar page');seen.add('page:'+pageToken);}
  }while(pageToken);
  return items;
}
module.exports={SCOPE,authClient,listEvents};
