import http from 'node:http';
import { randomBytes,randomUUID,timingSafeEqual } from 'node:crypto';
import { readFile,stat,mkdir,unlink } from 'node:fs/promises';
import { createReadStream,createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Service,ALLOWED,JOB_KINDS } from '../engine/service.mjs';
import {GeminiProvider} from '../providers/gemini.mjs';
import {visualProviders} from '../providers/visuals.mjs';
import {hashFile} from '../engine/render.mjs';

const workspace=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function parseRange(range,size){
  if(!range)return null;
  const m=/^bytes=(\d*)-(\d*)$/.exec(range);if(!m||(!m[1]&&!m[2]))throw new Error('Invalid range');
  let start=m[1]?Number(m[1]):Math.max(0,size-Number(m[2])),end=m[1]?(m[2]?Number(m[2]):size-1):size-1;
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||start>=size)throw new Error('Unsatisfiable range');
  return {start,end:Math.min(end,size-1)};
}
async function jsonBody(req,max=4000000){let total=0,chunks=[];for await(const chunk of req){total+=chunk.length;if(total>max)throw new Error('Request body too large.');chunks.push(chunk);}return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}
export async function createServer({root=process.env.REELFORGE_DATA||path.join(workspace,'data'),port=4317,token=randomBytes(32).toString('hex')}={}){
  const service=new Service(root);await service.init();
  const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  let origin;
  const auth=value=>{const a=Buffer.from(String(value||'')),b=Buffer.from(token);return a.length===b.length&&timingSafeEqual(a,b);};
  const stream=async(req,res,file,type,download)=>{
    const s=await stat(file);let range;try{range=parseRange(req.headers.range,s.size);}catch{res.writeHead(416,{'Content-Range':`bytes */${s.size}`});res.end();return;}
    const headers={'Content-Type':type,'Accept-Ranges':'bytes','Cache-Control':'no-store'};
    if(download)headers['Content-Disposition']=`attachment; filename="${download.replace(/[^\x20-\x7e]/g,'_')}"; filename*=UTF-8''${encodeURIComponent(download)}`;
    if(range)Object.assign(headers,{'Content-Range':`bytes ${range.start}-${range.end}/${s.size}`,'Content-Length':range.end-range.start+1});else headers['Content-Length']=s.size;
    res.writeHead(range?206:200,headers);if(req.method==='HEAD'){res.end();return;}
    await pipeline(createReadStream(file,range||{}),res);
  };
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    try{
      if(req.headers.host!==new URL(origin).host){send(res,403,{error:'Invalid host.'});return;}
      if(req.headers.origin&&req.headers.origin!==origin){send(res,403,{error:'Cross-origin access denied.'});return;}
      const url=new URL(req.url,origin),parts=url.pathname.split('/').filter(Boolean);
      if(parts[0]!=='api'){
        if(!['GET','HEAD'].includes(req.method)){send(res,405,{error:'Method not allowed.'});return;}
        const file=parts.length?path.resolve(workspace,'dist',...parts):path.join(workspace,'dist','index.html');
        if(!file.startsWith(path.join(workspace,'dist')+path.sep)){send(res,403,{error:'Invalid path.'});return;}
        const ext=path.extname(file),type={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'}[ext]||'application/octet-stream';
        await stream(req,res,file,type);return;
      }
      if(!auth(req.headers['x-reelforge-token'])&&!(['GET','HEAD'].includes(req.method)&&auth(url.searchParams.get('token')))){send(res,401,{error:'Session token required. Open the local launch URL.'});return;}
      if(parts[1]==='bootstrap'&&req.method==='GET'){send(res,200,{projects:await service.store.list(),settings:service.settings,health:await service.health()});return;}
      if(parts[1]==='settings'&&req.method==='POST'){send(res,200,await service.configure(await jsonBody(req)));return;}
      if(parts[1]==='providers'&&req.method==='GET'){
        if(parts[2]==='gemini'&&parts[3]==='models'){send(res,200,{models:await new GeminiProvider({model:service.settings.geminiModel||process.env.GEMINI_MODEL}).models()});return;}
        send(res,200,(await service.health()).providers);return;
      }
      if(parts[1]==='projects'&&parts.length===2&&req.method==='POST'){send(res,201,await service.store.create((await jsonBody(req)).name));return;}
      if(parts[1]!=='projects'||!parts[2]){send(res,404,{error:'Route not found.'});return;}
      const id=parts[2],action=parts[3];service.store.dir(id);
      if(!action&&req.method==='GET'){send(res,200,await service.get(id));return;}
      if(!action&&req.method==='PATCH'){send(res,200,await service.update(id,await jsonBody(req)));return;}
      if(action==='jobs'&&req.method==='GET'){
        if(parts[4]){const job=service.catalog.job(parts[4]);if(!job||job.projectId!==id){send(res,404,{error:'Job not found.'});return;}send(res,200,job);}
        else send(res,200,{jobs:service.catalog.jobs(id)});return;
      }
      if(action==='timeline'&&req.method==='GET'){const p=await service.get(id);send(res,200,{plan:p.plan,revision:p.revision});return;}
      if(action==='timeline'&&req.method==='PATCH'){const input=await jsonBody(req);send(res,200,await service.update(id,{plan:input.plan||input}));return;}
      if(action==='analysis'&&req.method==='GET'){const p=await service.get(id);send(res,200,p.analysis||null);return;}
      if(action==='transcription'&&req.method==='GET'){const p=await service.get(id);send(res,200,p.analysis?.transcript||null);return;}
      if(action==='proposal'&&req.method==='GET'){const p=await service.get(id);send(res,200,p.aiProposal||null);return;}
      if(action==='assets'&&req.method==='GET'){const p=await service.get(id);send(res,200,{assets:p.assets,search:p.assetSearch||null,failures:p.assetFailures||[]});return;}
      if(action==='assets'&&req.method==='POST'){const input=await jsonBody(req);send(res,202,await service.start(id,'assets',input));return;}
      if(action==='director'&&req.method==='POST'){const input=await jsonBody(req);send(res,202,await service.start(id,'plan',{instructions:input.instructions,apply:false}));return;}
      if(action==='visuals'&&req.method==='POST'){const input=await jsonBody(req);if(!visualProviders.status().some(p=>p.configured)){send(res,503,{error:'No visual-generation provider is configured. Local/Pexels B-roll remain available.'});return;}throw new Error('Visual-provider file ingestion has not passed acceptance; generation is disabled.');}
      if(action==='preview'&&parts[4]==='media'&&['GET','HEAD'].includes(req.method)){
        const p=await service.get(id);if(!p.preview?.file)throw new Error('No composition preview has been rendered.');const file=path.join(service.store.dir(id),p.preview.file);if(await hashFile(file)!==p.preview.hash)throw new Error('Preview file changed on disk. Render again.');await stream(req,res,file,'video/mp4');return;
      }
      if(action==='import'&&req.method==='POST'){
        const role=url.searchParams.get('role'),name=url.searchParams.get('name')||'input';
        if(!ALLOWED[role]?.includes(path.extname(name).toLowerCase()))throw new Error('Unsupported asset type.');
        if(service.jobs.has(id)||service.mutations.has(id))throw new Error('Project is busy.');
        const uploadDir=path.join(service.store.dir(id),'uploads');await mkdir(uploadDir,{recursive:true});
        const file=path.join(uploadDir,randomUUID()+'.tmp');let size=0;
        req.on('data',chunk=>{size+=chunk.length;if(size>(role==='transcript'?4000000:4*1024**3))req.destroy(new Error('Upload size limit exceeded.'));});
        try{await pipeline(req,createWriteStream(file,{flags:'wx'}));send(res,201,await service.addAsset(id,role,name,file));}
        finally{await unlink(file).catch(()=>{});}return;
      }
      if((JOB_KINDS.includes(action)||action==='transcription')&&req.method==='POST'){const input=await jsonBody(req);send(res,202,await service.start(id,action==='transcription'?'transcribe':action,input));return;}
      if(action==='cancel'&&req.method==='POST'){send(res,200,await service.cancel(id));return;}
      if(action==='review'&&req.method==='POST'){send(res,200,await service.review(id,await jsonBody(req)));return;}
      if(action==='report'&&req.method==='GET'){const p=await service.get(id);res.setHeader('Content-Disposition','attachment; filename="quality-report.json"');send(res,200,{output:p.output,report:p.report,gate:p.gate,log:p.log});return;}
      if(['media','preview','export'].includes(action)&&['GET','HEAD'].includes(req.method)){
        const p=await service.get(id);let file,type='video/mp4',download;
        if(action==='media'&&parts[4]){file=await service.store.assetPath(p,parts[4]);const ext=path.extname(file);type={'.mp4':'video/mp4','.mov':'video/quicktime','.webm':'video/webm','.mkv':'video/x-matroska','.mp3':'audio/mpeg','.wav':'audio/wav','.m4a':'audio/mp4'}[ext]||'application/octet-stream';}
        else {const info=await service.exportInfo(id);file=action==='preview'?path.join(service.store.dir(id),p.output.preview):info.file;type=action==='preview'?'image/png':'video/mp4';if(action==='export')download=info.name;}
        await stream(req,res,file,type,download);return;
      }
      send(res,404,{error:'Route not found.'});
    }catch(e){if(!res.headersSent)send(res,e.code==='ENOENT'?404:400,{error:e.message});else res.destroy();}
  });
  try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});}catch(e){await service.close();throw e;}
  origin=`http://127.0.0.1:${server.address().port}`;
  return {server,service,origin,token,url:`${origin}/#${token}`,close:async()=>{await service.close();server.closeAllConnections();await new Promise(r=>server.close(r));}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const instance=await createServer({port:Number(process.env.PORT||4317)});console.log(`ReelForge AI local session: ${instance.url}`);
  let closing=false;const shutdown=async()=>{if(closing)return;closing=true;await instance.close();process.exit(0);};process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
}
