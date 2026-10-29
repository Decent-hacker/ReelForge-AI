import {ffmpegRun,probe} from './process.mjs';
import {analyzeReference,hashFile} from './render.mjs';
import {speechTranscribe} from './speech.mjs';
import {validateTranscript} from './transcript.mjs';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';

export function parseSilence(stderr,duration){
  const events=[...stderr.matchAll(/silence_(start|end):\s*([\d.]+)/g)];const ranges=[];let start=null;
  for(const event of events){if(event[1]==='start')start=Number(event[2]);else if(start!==null){ranges.push({start,end:Math.min(duration,Number(event[2]))});start=null;}}
  if(start!==null)ranges.push({start,end:duration});return ranges.filter(r=>r.start>=0&&r.end>r.start);
}
export async function measureSilence(file,settings,duration,signal){
  const r=await ffmpegRun(settings,['-i',file,'-vn','-af','silencedetect=noise=-35dB:d=0.35','-f','null','-'],{signal});
  return {method:'FFmpeg silencedetect',thresholdDB:-35,minimumSeconds:.35,ranges:parseSilence(r.stderr,duration)};
}
const median=values=>{const v=values.filter(Number.isFinite).sort((a,b)=>a-b);return v.length?v[Math.floor(v.length/2)]:null;};
export async function referenceProfile(file,settings,signal){
  const pacing=await analyzeReference(file,settings,signal);
  const colour=await ffmpegRun(settings,['-i',file,'-t','180','-vf','fps=1,scale=160:-2,signalstats,metadata=print','-an','-f','null','-'],{signal});
  const values=key=>[...colour.stderr.matchAll(new RegExp(`lavfi\\.signalstats\\.${key}=([\\d.]+)`,'g'))].map(m=>Number(m[1]));
  let audio={status:'unavailable',reason:'No reference audio stream.'};
  const info=await probe(file,settings,signal);
  if(info.audio){const result=await ffmpegRun(settings,['-i',file,'-t','180','-vn','-af','astats=metadata=0:reset=0','-f','null','-'],{signal});
    const last=key=>[...result.stderr.matchAll(new RegExp(`${key}:\\s*(-?[\\d.]+)`,'g'))].at(-1)?.[1];
    const rms=last('RMS level dB'),peak=last('Peak level dB');audio={status:'measured',rmsDB:rms===undefined?null:Number(rms),peakDB:peak===undefined?null:Number(peak),scope:'First 180 seconds; aggregate mix, not source stems.'};
  }
  const unknown=reason=>({status:'unavailable',reason});
  return {...pacing,schema:1,sampledSeconds:Math.min(180,info.duration),shotFrequency:{status:'measured',hardCuts:pacing.cutTimes.length,perMinute:pacing.cutTimes.length/Math.min(180,info.duration)*60,threshold:.3},
    colour:{status:'measured',medianLuma:median(values('YAVG')),medianSaturation:median(values('SATAVG')),scope:'1 fps reduced-resolution signal statistics; not a reconstructed grade.'},
    audio,captionStyling:unknown('OCR/visual style inference is not available.'),captionPosition:unknown('No validated caption detector is installed.'),zoomPatterns:unknown('No validated motion/subject tracker is installed.'),transitionPatterns:{status:'estimated',kind:'Hard-cut candidates only',note:'Scene-difference threshold also responds to flashes and motion.'},graphicDensity:unknown('No validated graphic detector is installed.'),brollFrequency:unknown('Speaker/scene semantic classification is unavailable.'),
    limitation:'Measured pacing, signal colour and aggregate audio are available; unmeasured style properties are explicitly unavailable. This is not the original editing project.'};
}
export async function analyzeMedia(project,store,settings,{signal,stage,transcribe=true}={}){
  const raw=project.assets.find(a=>a.role==='raw');if(!raw)throw new Error('Import a raw talking-head video first.');
  const file=await store.assetPath(project,raw.id);await stage('probing-source',null);const info=await probe(file,settings,signal);
  if(!info.video||!info.audio)throw new Error('Raw recording must contain video and speech audio.');if(info.duration>600)throw new Error('Source recordings are limited to 10 minutes.');
  const sourceHash=await hashFile(file);if(raw.hash&&sourceHash!==raw.hash)throw new Error('Source recording changed on disk. Re-import it.');
  project.analysis={...(project.analysis?.sourceHash===sourceHash?project.analysis:{}),schema:1,sourceHash,rawId:raw.id,metadata:{duration:info.duration,width:info.width,height:info.height,fps:info.fps,videoCodec:info.video.codec_name,audioCodec:info.audio.codec_name},language:project.preferences.language};await store.save(project);
  if(!transcribe)return project.analysis;
  await stage('measuring-silence',null);project.analysis.silence=await measureSilence(file,settings,info.duration,signal);await store.save(project);
  const cwd=path.join(store.dir(project.id),'analysis');await mkdir(cwd,{recursive:true});const imported=project.assets.find(a=>a.role==='transcript');
  if(imported){await stage('validating-imported-transcript',null);project.analysis.transcript=validateTranscript(JSON.parse(await readFile(await store.assetPath(project,imported.id),'utf8')),info.duration);project.analysis.transcript.alignment={method:'imported-word-timestamps',status:'review-required'};}
  else project.analysis.transcript=await speechTranscribe(file,{...settings,language:project.preferences.language},info.duration,cwd,{signal,stage});
  const reference=project.assets.find(a=>a.role==='reference');
  if(reference){await stage('measuring-reference',null);project.analysis.reference=await referenceProfile(await store.assetPath(project,reference.id),settings,signal);}
  await writeFile(path.join(cwd,'analysis.json'),JSON.stringify(project.analysis,null,2));await store.save(project);return project.analysis;
}
