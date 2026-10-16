'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {randomBytes}=require('node:crypto');
const {previewExcel}=require('./pipeline');
const ORIGIN='http://127.0.0.1:8787';
function createServer({preview=previewExcel,service,writesEnabled=false,calendarId=process.env.AER_CALENDAR_ID}={}){
  const csrf=randomBytes(32).toString('hex');
  let busy=false;
  return http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if(req.headers.host!=='127.0.0.1:8787'){res.writeHead(403).end();return;}
    if(req.method==='GET' && req.url==='/health'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({status:'ok',mode:writesEnabled?'approval-required':'dry-run',writesEnabled}));return;}
    const files={'/':['preview.html','text/html; charset=utf-8'],'/preview.js':['preview.js','text/javascript; charset=utf-8']};
    if(req.method==='GET' && files[req.url]){
      const [file,mime]=files[req.url];res.setHeader('Content-Type',mime);
      if(req.url==='/')res.setHeader('Set-Cookie',`aer_csrf=${csrf}; HttpOnly; SameSite=Strict; Path=/`);
      res.end(fs.readFileSync(path.join(__dirname,file)));return;
    }
    if(req.method!=='POST' || !['/api/preview',...(service?['/api/apply']:[])].includes(req.url)){res.writeHead(404).end();return;}
    if(req.headers.origin!==ORIGIN || req.headers.cookie!==`aer_csrf=${csrf}` || req.headers['x-aer-preview']!=='1' || req.headers['content-type']!=='application/json') {res.writeHead(403).end();return;}
    if(busy){res.writeHead(429).end('Preview already running');return;}
    busy=true;
    try{
      let size=0, chunks=[];
      for await(const chunk of req){size+=chunk.length;if(size>12*1024*1024)throw Error('Upload too large');chunks.push(chunk);}
      const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const channel='web:'+csrf;
      const result=req.url==='/api/apply'
        ? await service.apply(body.planId,{channel})
        : await (service?service.preview:preview)(Buffer.from(body.xlsx||'','base64'),{person:body.person,residents:body.residents,calendarId,channel});
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));
    }catch{res.writeHead(400).end('Request stopped. Check configuration or create a new preview. If apply was attempted, some changes may already exist; re-preview before retrying.');}
    finally{busy=false;}
  });
}
if(require.main===module){
  if(!process.env.AER_CALENDAR_ID || process.env.AER_CALENDAR_ID==='primary')throw Error('AER_CALENDAR_ID must identify AER duty');
  const {service,writesEnabled}=require('./runtime').createRuntime();
  createServer({service,writesEnabled}).listen(8787,'127.0.0.1',()=>console.log('AER preview: '+ORIGIN));
}
module.exports={createServer};
