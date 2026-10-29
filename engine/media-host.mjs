import http from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import path from 'node:path';

export async function hostRenderAssets(files){
  const token=randomBytes(32).toString('hex');let origin;
  const server=http.createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,origin),key=url.searchParams.get('token')||'',a=Buffer.from(key),b=Buffer.from(token),id=decodeURIComponent(url.pathname.slice(1));
      if(req.headers.host!==new URL(origin).host||a.length!==b.length||!timingSafeEqual(a,b)||!['GET','HEAD'].includes(req.method)||!files.has(id)){res.writeHead(403);res.end();return;}
      const file=files.get(id),size=(await stat(file)).size,ext=path.extname(file),headers={'Content-Type':ext==='.wav'?'audio/wav':'video/mp4','Accept-Ranges':'bytes','Cache-Control':'no-store'};let range=null;
      if(req.headers.range){const m=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range);if(!m||Number(m[1])>=size){res.writeHead(416,{'Content-Range':`bytes */${size}`});res.end();return;}range={start:Number(m[1]),end:Math.min(size-1,m[2]?Number(m[2]):size-1)};if(range.end<range.start){res.writeHead(416);res.end();return;}headers['Content-Range']=`bytes ${range.start}-${range.end}/${size}`;}
      headers['Content-Length']=range?range.end-range.start+1:size;res.writeHead(range?206:200,headers);if(req.method==='HEAD'){res.end();return;}await pipeline(createReadStream(file,range||{}),res);
    }catch{if(!res.headersSent)res.writeHead(404);res.end();}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});origin=`http://127.0.0.1:${server.address().port}`;
  return {url:id=>{if(!files.has(id))throw new Error('Unknown composition asset.');return `${origin}/${encodeURIComponent(id)}?token=${token}`;},close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}};
}
