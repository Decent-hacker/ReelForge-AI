import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { ffmpegRun, probe } from './process.mjs';
import { FEATURES, REVIEW, initializeReport, setState, fingerprint, qualityGate } from './quality.mjs';
import { validatePlan } from './planner.mjs';
import { makeAss } from './captions.mjs';
import {VOICE_CHAIN} from './audio.mjs';
import {inspectOutput} from './inspect.mjs';

export async function hashFile(file) {
  const hash=createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex');
}
export async function analyzeReference(file,settings,signal) {
  const info=await probe(file,settings,signal);
  // A hard ceiling bounds resource use; this is a measured pacing guide, not inferred motion design.
  const result=await ffmpegRun(settings,['-i',file,'-t','180','-vf',"scale=160:-2,select='gt(scene,0.3)',showinfo",'-an','-f','null','-'],{signal});
  const boundaries=[...result.stderr.matchAll(/pts_time:([\d.]+)/g)].map(m=>Number(m[1]));
  const times=[0,...boundaries,Math.min(180,info.duration)]; const intervals=times.slice(1).map((n,i)=>n-times[i]).filter(n=>n>.1).sort((a,b)=>a-b);
  return { duration:info.duration, width:info.width, height:info.height, fps:info.fps, cutTimes:boundaries, medianShotSeconds:boundaries.length ? intervals[Math.floor(intervals.length/2)] : null,
    limitation:'Only hard-cut pacing and technical format are measured. Caption design, graphics, colour and sound style require manual reference review.' };
}
export function compileGraph(plan,pref,assets,omit=new Set(),mode='all') {
  const filters=[],inputs=[], n=plan.cuts.length;
  const has=k=>pref.mandatory.includes(k)&&!omit.has(k);
  if(n>1) filters.push(`[0:v]split=${n}${plan.cuts.map((_,i)=>`[vs${i}]`).join('')}`);
  if(mode!=='video'&&n>1) filters.push(`[0:a]asplit=${n}${plan.cuts.map((_,i)=>`[as${i}]`).join('')}`);
  for(let i=0;i<n;i++) {
    const c=plan.cuts[i];
    filters.push(`[${n>1?`vs${i}`:'0:v'}]trim=start=${c.start}:end=${c.end},setpts=PTS-STARTPTS[vc${i}]`);
    if(mode!=='video') filters.push(`[${n>1?`as${i}`:'0:a'}]atrim=start=${c.start}:end=${c.end},asetpts=PTS-STARTPTS[ac${i}]`);
  }
  filters.push(`${plan.cuts.map((_,i)=>`[vc${i}]`).join('')}concat=n=${n}:v=1:a=0,scale=${pref.width}:${pref.height}:force_original_aspect_ratio=increase,crop=${pref.width}:${pref.height},setsar=1,fps=${pref.fps},settb=AVTB[base]`);
  if(mode!=='video') filters.push(`${plan.cuts.map((_,i)=>`[ac${i}]`).join('')}concat=n=${n}:v=0:a=1,${VOICE_CHAIN},alimiter=limit=0.95:level=false[voice]`);
  let v='base',seq=0;
  const apply=filter=>{ const out=`v${++seq}`; filters.push(`[${v}]${filter}[${out}]`);v=out; };
  if(has('colour')) apply('eq=contrast=1.04:saturation=1.08:brightness=0.008');
  if(has('zoom')) {
    let expr='1'; for(const s of [...plan.scenes].reverse()) if(s.zoom>1) expr=`if(between(on/${pref.fps},${s.start},${s.end}),1+${s.zoom-1}*min(1,(on/${pref.fps}-${s.start})/0.35),${expr})`;
    apply(`zoompan=z='${expr}':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=${pref.width}x${pref.height}:fps=${pref.fps}`);
  }
  let inputIndex=1;
  if(has('broll')) for(const s of plan.scenes.filter(s=>s.needsBroll&&s.brollId)) {
    const asset=assets.find(a=>a.id===s.brollId); if(!asset) throw new Error('Planned B-roll asset is missing.');
    inputs.push('-stream_loop','-1','-i',asset.path);
    filters.push(`[${inputIndex++}:v]scale=${pref.width}:${pref.height}:force_original_aspect_ratio=increase,crop=${pref.width}:${pref.height},setsar=1,fps=${pref.fps},trim=duration=${s.brollEnd-s.brollStart},setpts=PTS-STARTPTS+${s.brollStart}/TB[br${seq}]`);
    const out=`v${seq+1}`; filters.push(`[${v}][br${seq}]overlay=eof_action=pass:enable='between(t,${s.brollStart},${s.brollEnd})'[${out}]`);seq++;v=out;
  }
  if(has('transitions')) for(const s of plan.scenes.slice(1)) apply(`drawbox=x=0:y=0:w=iw:h=ih:color=white@0.78:t=fill:enable='between(t,${s.start},${s.start+0.065})'`);
  const ass=`captions-${[...omit].sort().join('-')||'full'}.ass`;
  apply(`ass=filename=${ass}`);
  filters.push(`[${v}]format=yuv420p[vout]`);
  if(mode!=='video') {
    let a='voice'; const mix=[];
    if(has('music')) {
      const music=assets.find(a=>a.role==='music');
      if(music) {
        inputs.push('-stream_loop','-1','-i',music.path);
        filters.push(`[${inputIndex++}:a]aresample=48000,atrim=duration=${plan.duration},asetpts=PTS-STARTPTS,volume=${pref.musicVolume},afade=t=in:d=0.3,afade=t=out:st=${Math.max(0,plan.duration-.6)}:d=0.6[music]`);
        filters.push('[voice]asplit=2[vo][side]');
        filters.push('[music][side]sidechaincompress=threshold=0.025:ratio=8:attack=15:release=220[ducked]');a='vo';mix.push('ducked');
      }
    }
    if(has('sfx')) for(let i=0;i<plan.scenes.length;i++) {
      const s=plan.scenes[i],delay=Math.round(s.start*1000);
      filters.push(`sine=frequency=${640+i%3*160}:sample_rate=48000:duration=0.11,volume=0.12,afade=t=out:st=0.015:d=0.095,adelay=${delay}:all=1[sfx${i}]`);mix.push(`sfx${i}`);
    }
    if(mix.length) filters.push(`[${a}]${mix.map(k=>`[${k}]`).join('')}amix=inputs=${mix.length+1}:duration=first:normalize=0,alimiter=limit=0.95:level=false[aout]`);
    else filters.push(`[${a}]anull[aout]`);
  }
  return {filters,inputs,ass};
}
async function prepare(plan,pref,assets,cwd,omit,mode) {
  const effective=new Set(omit);
  for(const key of ['captions','animation','keywords','graphics']) if(!pref.mandatory.includes(key)) effective.add(key);
  const graph=compileGraph(plan,pref,assets,effective,mode);
  await writeFile(path.join(cwd,graph.ass),makeAss(plan,pref,effective),'utf8');
  return graph;
}
function sampleFilter(key){
  if(['captions','keywords','animation'].includes(key))return 'crop=iw*0.9:ih*0.22:iw*0.05:ih*0.62,scale=192:128';
  if(key==='graphics')return 'crop=iw:ih*0.24:0:ih*0.10,scale=192:128';
  return 'scale=96:170';
}
async function sampleFrame(file,time,output,settings,cwd,signal,key) {
  await ffmpegRun(settings,['-i',file,'-ss',String(time),'-frames:v','1','-vf',sampleFilter(key),'-pix_fmt','rgb24','-f','rawvideo',output],{cwd,signal});
  return readFile(path.join(cwd,output));
}
export function difference(a,b) {
  if(a.length!==b.length || !a.length) return 0;
  let total=0; for(let i=0;i<a.length;i++) total+=Math.abs(a[i]-b[i]); return total/a.length;
}
function sampleTimes(key,plan) {
  switch(key) {
    case 'captions': case 'keywords': return plan.words.filter(w=>key!=='keywords'||w.keyword).slice(0,3).map(w=>(w.start+w.end)/2);
    case 'animation': return plan.words.filter(w=>w.end-w.start>.12).slice(0,3).map(w=>w.start+.05);
    case 'broll': return plan.scenes.filter(s=>s.needsBroll&&s.brollId).map(s=>(s.brollStart+s.brollEnd)/2);
    case 'graphics': return plan.scenes.slice(0,3).map(s=>s.start+.5);
    case 'zoom': return plan.scenes.filter(s=>s.zoom>1&&!s.needsBroll).slice(0,3).map(s=>Math.min(s.end-.1,s.start+.6));
    case 'transitions': return plan.scenes.slice(1).map(s=>s.start+.03);
    case 'colour': return [Math.min(.7,plan.duration/2)];
    default:return [];
  }
}
export async function renderProject(project,store,settings,{signal,log,progress,stage=async()=>{}}={}) {
  if(project.plan?.overlays?.length)throw new Error('This plan contains callouts/statistics. Select the Remotion renderer; the legacy renderer will not silently omit them.');
  const plan=validatePlan(project.plan,project),pref=project.preferences;
  const planHash=fingerprint({plan,preferences:pref,assets:project.assets}), report=initializeReport(pref.mandatory);
  const cwd=path.join(store.dir(project.id),'renders',`r${project.revision}-${Date.now()}`); await mkdir(cwd,{recursive:true});
  project.report=report; project.output=null; await store.save(project);
  const assets=await Promise.all(project.assets.map(async a=>({...a,path:await store.assetPath(project,a.id)})));
  for(const asset of assets)if(asset.hash&&await hashFile(asset.path)!==asset.hash)throw new Error(`${asset.name} changed on disk. Re-import the asset and analyze again.`);
  const raw=assets.find(a=>a.role==='raw'); if(!raw) throw new Error('Import raw video first.');
  const info=await probe(raw.path,settings,signal); if(!info.video||!info.audio) throw new Error('Talking-head input must include both video and speech audio.');
  const failed=[];
  if(pref.mandatory.includes('broll') && plan.scenes.some(s=>s.needsBroll&&!s.brollId)) failed.push(['broll','Planned scenes lack approved assets. Local tag matching was attempted. Stock and AI visual providers are unavailable. Assign B-roll before retrying.']);
  if(pref.mandatory.includes('music')&&!assets.some(a=>a.role==='music')) failed.push(['music','No approved background music asset. Import a licensed local file.']);
  if(pref.mandatory.includes('reference')&&!plan.reference) failed.push(['reference','Reference analysis is missing.']);
  for(const [key,reason] of failed) {setState(report,key,'failed',reason);await log?.('failure',`${FEATURES[key]}: ${reason}`);}
  for(const key of pref.mandatory.filter(k=>!failed.some(([f])=>f===k))) setState(report,key,'generated','Validated source data and render instructions generated.');
  await store.save(project);
  const omit=new Set(failed.map(([k])=>k));
  const graph=await prepare(plan,pref,assets,cwd,omit,'all');
  await writeFile(path.join(cwd,'render.ffgraph'),graph.filters.join(';\n'));
  const args=['-i',raw.path,...graph.inputs,'-filter_complex_script','render.ffgraph','-map','[vout]','-map','[aout]','-t',String(plan.duration),'-c:v','libx264','-preset','veryfast','-crf','19','-c:a','aac','-b:a','192k','-ar','48000','-movflags','+faststart','-progress','pipe:1','output.mp4'];
  try { await ffmpegRun(settings,args,{cwd,signal,onProgress:chunk=>{const m=chunk.match(/out_time_us=(\d+)/);if(m)progress?.(Math.min(70,Number(m[1])/1e6/plan.duration*70));}}); }
  catch(e) {
    if(!signal?.aborted&&/temporarily unavailable|Cannot allocate memory/i.test(e.message)) {
      await log?.('retry','Resource error; one retry with one filter/encoder thread, preserving the effect graph and CRF.');
      await ffmpegRun(settings,['-filter_complex_threads','1','-threads','1',...args],{cwd,signal});
    } else throw e;
  }
  await stage('verifying-export',null);
  const file=path.join(cwd,'output.mp4'),outputHash=await hashFile(file),outInfo=await probe(file,settings,signal);
  const evidence=(details,passed=true)=>({kind:'output-check',passed,outputHash,planHash,at:new Date().toISOString(),...details});
  const output={file:path.relative(store.dir(project.id),file),hash:outputHash,planHash,duration:outInfo.duration,width:outInfo.width,height:outInfo.height,fps:outInfo.fps,createdAt:new Date().toISOString()};
  project.output=output;
  const record=(key,passed,details)=>{
    if(report[key].state==='failed')return;
    const ev=evidence(details,passed);
    setState(report,key,passed?(REVIEW.has(key)?'rendered':'verified'):'failed',passed?(REVIEW.has(key)?'Output measurements passed; review exported media before verifying.':'Export measurements passed.'):'Export measurement failed. See evidence.',[ev]);
  };
  record('dimensions',outInfo.width===pref.width&&outInfo.height===pref.height&&Math.abs(outInfo.fps-pref.fps)<.01,{measured:{width:outInfo.width,height:outInfo.height,fps:outInfo.fps}});
  const videoDuration=Number(outInfo.video?.duration),audioDuration=Number(outInfo.audio?.duration);
  record('sync',Boolean(outInfo.audio)&&Number.isFinite(videoDuration)&&Number.isFinite(audioDuration)&&Math.abs(videoDuration-audioDuration)<.15&&Math.abs(outInfo.duration-plan.duration)<.15,{videoDuration,audioDuration,expectedDuration:plan.duration,note:'Stream-duration comparison detects drift, not lip sync. Watch and listen to confirm sync.'});
  try {
    await ffmpegRun(settings,['-v','error','-xerror','-i',file,'-f','null','-'],{cwd,signal});
    record('playback',true,{check:'Full video and audio decode with -xerror; player playback still requires review.'});
  }catch(e){record('playback',false,{error:e.message});}
  await ffmpegRun(settings,['-i',file,'-vn','-ar','16000','-ac','1','-c:a','pcm_s16le','-f','s16le','export-audio.pcm'],{cwd,signal});
  const pcm=await readFile(path.join(cwd,'export-audio.pcm'));
  const wordAudio=plan.words.map(word=>{
    const start=Math.max(0,Math.floor(word.start*16000)),end=Math.min(pcm.length>>1,Math.floor(word.end*16000));let energy=0;
    for(let j=start;j<end;j++)energy+=(pcm.readInt16LE(j*2)/32768)**2;
    return {start:word.start,end:word.end,rms:Math.sqrt(energy/Math.max(1,end-start))};
  });
  record('transcription',wordAudio.length>0&&wordAudio.filter(w=>w.rms>.002).length/wordAudio.length>=.85,{words:plan.words.length,provenance:plan.transcriptProvenance,wordAudio,check:'Measured signal energy at transcript timestamps in decoded export. Energy is not speech recognition; a reviewer must confirm every spoken word and timing.'});
  if(pref.mandatory.includes('cuts'))record('cuts',plan.duration<plan.sourceDuration-.05,{sourceDuration:plan.sourceDuration,outputDuration:outInfo.duration,cuts:plan.cuts,note:'Review edit boundaries for clipped speech.'});
  if(pref.mandatory.includes('reference')&&!omit.has('reference'))record('reference',false,{measurements:plan.reference,note:'Full reference style matching is unavailable. Measured pacing alone cannot satisfy this mandatory feature.'});
  const visual=['captions','animation','keywords','broll','graphics','zoom','transitions','colour'].filter(k=>pref.mandatory.includes(k)&&!omit.has(k));
  for(let i=0;i<visual.length;i++) {
    const key=visual[i]; progress?.(70+i/visual.length*20);
    await stage(`verifying-${key}`,null);
    try {
      const times=sampleTimes(key,plan).filter(t=>t>=0&&t<plan.duration);
      if(!times.length)throw new Error('No visible sample exists for this selected feature.');
      const samples=[];
      for(let j=0;j<times.length;j++) {
        const time=times[j],ablation=new Set([...omit,key]);
        const alt=await prepare(plan,pref,assets,cwd,ablation,'video');
        const name=`ablation-${key}-${j}.rgb`;
        await ffmpegRun(settings,['-i',raw.path,...alt.inputs,'-filter_complex',`${alt.filters.join(';')};[vout]${sampleFilter(key)}[sample]`,'-map','[sample]','-ss',String(time),'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo',name],{cwd,signal});
        const control=await prepare(plan,pref,assets,cwd,omit,'video');
        const controlName=`control-${key}-${j}.rgb`;
        await ffmpegRun(settings,['-i',raw.path,...control.inputs,'-filter_complex',`${control.filters.join(';')};[vout]${sampleFilter(key)}[sample]`,'-map','[sample]','-ss',String(time),'-frames:v','1','-pix_fmt','rgb24','-f','rawvideo',controlName],{cwd,signal});
        const actual=await sampleFrame(file,time,`actual-${key}-${j}.rgb`,settings,cwd,signal,key);
        const absent=await readFile(path.join(cwd,name));
        const baseline=await readFile(path.join(cwd,controlName));
        samples.push({time,meanPixelDifference:difference(actual,absent),compressionNoise:difference(actual,baseline),effectDifference:difference(baseline,absent),actual:`actual-${key}-${j}.rgb`,ablation:name,control:controlName});
      }
      // Compressed-output vs lossless-ablation differences have noise. Demand a visible threshold and human review.
      record(key,samples.every(s=>s.effectDifference>1&&s.meanPixelDifference>s.compressionNoise*2+.5),{method:'Sample exported frames against same-timestamp feature ablations and a compression-noise control',samples,note:'Pixel differences are supporting evidence; human review remains mandatory. This does not prove semantic quality.'});
    }catch(e){if(signal?.aborted)throw e;record(key,false,{error:e.message});await log?.('failure',`${key} evidence: ${e.message}`);}
    await store.save(project);
  }
  for(const key of ['music','sfx'].filter(k=>pref.mandatory.includes(k)&&!omit.has(k))) {
    await stage(`verifying-${key}`,null);
    try {
      const alt=await prepare(plan,pref,assets,cwd,new Set([...omit,key]),'all');
      const alternate=`without-${key}.mp4`;
      await ffmpegRun(settings,['-i',raw.path,...alt.inputs,'-filter_complex',alt.filters.join(';'),'-map','[vout]','-map','[aout]','-t',String(plan.duration),'-c:v','libx264','-preset','ultrafast','-crf','30','-c:a','aac',alternate],{cwd,signal});
      for(const [input,name] of [[file,`actual-${key}.pcm`],[alternate,`absent-${key}.pcm`]]) await ffmpegRun(settings,['-i',input,'-vn','-ar','16000','-ac','1','-c:a','pcm_s16le','-f','s16le',name],{cwd,signal});
      const a=await readFile(path.join(cwd,`actual-${key}.pcm`)),b=await readFile(path.join(cwd,`absent-${key}.pcm`));
      let sum=0,count=Math.min(a.length,b.length)>>1;for(let j=0;j<count;j++)sum+=(a.readInt16LE(j*2)-b.readInt16LE(j*2))**2;
      const rms=Math.sqrt(sum/Math.max(1,count))/32768;
      record(key,rms>.0005,{method:'Compare decoded final audio against feature-omitted render',differenceRMS:rms,note:'Review audibility, clipping and speech intelligibility in the final mix.'});
    }catch(e){if(signal?.aborted)throw e;record(key,false,{error:e.message});}
  }
  const technical=await inspectOutput(file,{width:pref.width,height:pref.height,fps:pref.fps,duration:plan.duration},settings,{signal});
  if(!technical.passed)record('playback',false,{technical,note:'Technical decode/codec/sync/black-frame/audio-clipping guards did not all pass.'});
  await writeFile(path.join(cwd,'report.json'),JSON.stringify({output,report,technical,gate:qualityGate(report,outputHash,planHash)},null,2));
  try{
    await ffmpegRun(settings,['-i',file,'-ss',String(Math.min(plan.duration/2,1)),'-frames:v','1','preview.png'],{cwd,signal});
    project.output.preview=path.relative(store.dir(project.id),path.join(cwd,'preview.png'));
  }catch(e){if(signal?.aborted)throw e;await log?.('warning',`Preview thumbnail failed: ${e.message}. Use video playback.`);}
  await store.save(project);progress?.(100);return project;
}
