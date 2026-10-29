import {createWriteStream} from 'node:fs';
import {mkdir,unlink,stat} from 'node:fs/promises';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {providerRequest,limitedJSON,ProviderError} from './http.mjs';
import {probe} from '../engine/process.mjs';

export function approvedMediaURL(value){const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||!['videos.pexels.com','images.pexels.com','player.vimeo.com'].includes(u.hostname))throw new Error('Stock media URL is outside approved provider hosts.');return u;}
export function rankVideos(videos,{duration=2,width=1080,height=1920}={}){
  if(!Array.isArray(videos))throw new Error('Pexels returned an invalid video list.');
  return videos.slice(0,50).flatMap((v,index)=>{
    if(!Number.isInteger(v.id)||!Number.isFinite(v.duration)||v.duration<duration)return [];
    const files=(v.video_files||[]).filter(f=>f.file_type==='video/mp4'&&Number.isFinite(f.width)&&f.width>0&&Number.isFinite(f.height)&&f.height>0&&typeof f.link==='string').filter(f=>{try{approvedMediaURL(f.link);return true;}catch{return false;}});
    if(!files.length)return [];
    const scoreFile=f=>Math.abs(Math.log((f.width/f.height)/(width/height)))+(f.width<width||f.height<height?1:0)+Math.max(0,f.width*f.height-width*height)/1e8;
    files.sort((a,b)=>scoreFile(a)-scoreFile(b));const file=files[0];
    let source;try{source=new URL(v.url);if(source.protocol!=='https:'||source.username||source.password||!['www.pexels.com','pexels.com'].includes(source.hostname))return [];}catch{return [];}
    const ratio=Math.abs(Math.log((file.width/file.height)/(width/height))),score=1/(1+index)*.5+1/(1+ratio)*.35+Math.min(1,file.width*file.height/(width*height))*.15;
    return [{id:String(v.id),provider:'pexels',width:file.width,height:file.height,duration:v.duration,score,fileURL:file.link,sourceURL:source.href,creator:String(v.user?.name||'Pexels contributor'),creatorURL:typeof v.user?.url==='string'?v.user.url:null,licenseURL:'https://www.pexels.com/license/',fileType:'video/mp4',attribution:`Video by ${String(v.user?.name||'Pexels contributor')} on Pexels`,ranking:'Provider relevance order, aspect ratio and resolution; contextual relevance requires review.'}];
  }).sort((a,b)=>b.score-a.score);
}
export class PexelsProvider{
  constructor({apiKey=process.env.PEXELS_API_KEY,fetchImpl=fetch}={}){this.apiKey=apiKey;this.fetchImpl=fetchImpl;}
  status(){return {id:'pexels',configured:!!this.apiKey,liveVerified:false,attributionURL:'https://www.pexels.com'};}
  async search(query,options={},signal){
    if(!this.apiKey)throw new ProviderError('Pexels','PEXELS_API_KEY is not configured. Local B-roll remains available.');
    if(typeof query!=='string'||!query.trim()||query.length>200)throw new Error('Stock search needs 1–200 characters.');
    const url=new URL('https://api.pexels.com/v1/videos/search');url.search=new URLSearchParams({query:query.trim(),orientation:'portrait',per_page:'15'}).toString();
    const response=await providerRequest('Pexels',url,{apiKey:this.apiKey,fetchImpl:this.fetchImpl,signal,headers:{Authorization:this.apiKey}});
    const data=await limitedJSON(response);return rankVideos(data.videos,options);
  }
  async download(candidate,directory,settings,{signal,onProgress}={}){
    const url=approvedMediaURL(candidate.fileURL);await mkdir(directory,{recursive:true});const temp=path.join(directory,randomUUID()+'.mp4');
    let response,current=url;
    for(let hop=0;hop<4;hop++){
      response=await this.fetchImpl(current,{signal:AbortSignal.any([AbortSignal.timeout(120000),...(signal?[signal]:[])]),redirect:'manual'});
      if([301,302,303,307,308].includes(response.status)){const next=response.headers.get('location');await response.body?.cancel();if(!next)throw new Error('Stock download redirect has no location.');current=approvedMediaURL(new URL(next,current).href);continue;}
      break;
    }
    if(!response?.ok)throw new ProviderError('Pexels',`Stock download failed (HTTP ${response?.status||0}).`);
    const declared=Number(response.headers.get('content-length'));if(Number.isFinite(declared)&&declared>512*1024**2){await response.body?.cancel();throw new Error('Stock clip exceeds 512 MiB limit.');}
    const mime=response.headers.get('content-type')||'';if(!/video\/mp4|application\/octet-stream/i.test(mime)){await response.body?.cancel();throw new Error('Stock response is not MP4 media.');}
    let bytes=0;const limit=new Transform({transform(chunk,_encoding,callback){bytes+=chunk.length;if(bytes>512*1024**2){callback(new Error('Stock clip exceeds 512 MiB limit.'));return;}onProgress?.(declared>0?Math.min(99,bytes/declared*100):null);callback(null,chunk);}});
    try{await pipeline(Readable.fromWeb(response.body),limit,createWriteStream(temp,{flags:'wx'}),{signal});const info=await probe(temp,settings,signal);if(!info.video||Math.abs(info.duration-candidate.duration)>.5)throw new Error('Downloaded stock media did not pass video/duration validation.');return {file:temp,metadata:{duration:info.duration,width:info.width,height:info.height},provenance:{...candidate,downloadedAt:new Date().toISOString(),bytes:(await stat(temp)).size}};}
    catch(error){await unlink(temp).catch(()=>{});throw error;}
  }
}
