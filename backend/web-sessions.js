'use strict';
const {randomBytes,timingSafeEqual}=require('node:crypto');
const hex=()=>randomBytes(32).toString('hex');
function cookieId(header){
  if(typeof header!=='string')return null;
  const values=header.split(';').map(part=>part.trim()).filter(part=>part.startsWith('aer_session=')).map(part=>part.slice('aer_session='.length));
  return values.length===1 && /^[0-9a-f]{64}$/.test(values[0])?values[0]:null;
}
function createWebSessions({now=()=>Date.now(),ttlMs=30*60*1000,maxSessions=1024}={}){
  const sessions=new Map(),epoch=hex();
  function get(request){
    const id=cookieId(request.headers.cookie),session=id&&sessions.get(id);
    if(!session)return null;
    if(session.expiresAt<=now()){sessions.delete(id);return null;}
    return session;
  }
  return {
    open(request,response){
      for(const [id,session] of sessions)if(session.expiresAt<=now())sessions.delete(id);
      let session=get(request);
      if(!session){
        if(sessions.size>=maxSessions)throw Error('Session capacity reached');
        const id=hex();session={csrf:hex(),channel:`web:${epoch}:${hex()}`,expiresAt:now()+ttlMs};
        sessions.set(id,session);
        response.setHeader('Set-Cookie',`aer_session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.ceil(ttlMs/1000)}`);
      }
      return session;
    },
    authenticate(request){
      const session=get(request),token=request.headers['x-aer-csrf'];
      if(!session || typeof token!=='string' || !/^[0-9a-f]{64}$/.test(token))return null;
      return timingSafeEqual(Buffer.from(session.csrf,'hex'),Buffer.from(token,'hex'))?session:null;
    }
  };
}
module.exports={createWebSessions};
