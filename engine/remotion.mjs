import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import path from 'node:path';
import {compileComposition} from './composition.mjs';
import {hostRenderAssets} from './media-host.mjs';
import {renderAudio} from './audio.mjs';
import {ffmpegRun,probe} from './process.mjs';
import {inspectOutput} from './inspect.mjs';
import {initializeReport,setState,fingerprint,REVIEW,qualityGate} from './quality.mjs';
import {hashFile,difference} from './render.mjs';

async function remotionModules(){
  try{const require=createRequire(new URL('../composition/package.json',import.meta.url));const [bundler,renderer]=await Promise.all([import(pathToFileURL(require.resolve('@remotion/bundler')).href),import(pathToFileURL(require.resolve('@remotion/renderer')).href)]);return {bundle:bundler.bundle,...renderer};}
  catch(error){throw new Error(`Remotion is unavailable. Install and lock the composition dependencies before rendering. No legacy fallback was used. ${error.code||''}`);}
}
function region(key){return ['captions','animation','keywords'].includes(key)?'crop=iw*.9:ih*.22:iw*.05:ih*.62,scale=192:128':key==='graphics'?'crop=iw:ih*.45:0:ih*.10,scale=192:128':'scale=96:170';}
export function verificationFrames(key,t){
  const cap=n=>Math.max(0,Math.min(t.durationInFrames-1,Math.round(n)));
  if(['captions','keywords'].includes(key))return t.words.filter(w=>key!=='keywords'||w.keyword).slice(0,3).map(w=>cap((w.from+w.to)/2));
  if(key==='animation')return t.words.filter(w=>w.to-w.from>=4).slice(0,3).map(w=>cap(w.from+1));
  if(key==='broll')return t.scenes.filter(s=>s.needsBroll&&s.brollURL).map(s=>cap(s.brollFrom+s.brollDuration/2));
  if(key==='zoom')return t.scenes.filter(s=>s.zoom>1).map(s=>cap(s.from+Math.min(.3*t.fps,s.durationInFrames/4)));
  if(key==='transitions')return t.scenes.slice(1).map(s=>cap(s.from));
  if(key==='graphics')return [...t.scenes.slice(0,3).map(s=>cap(s.from+Math.min(.5*t.fps,s.durationInFrames/2))),...t.overlays.map(o=>cap(o.from+o.durationInFrames/2))];
  if(key==='colour')return [cap(t.durationInFrames/2)];return [];
}
async function rgb(input,filter,name,settings,cwd,signal,time){await ffmpegRun(settings,['-i',input,...(time===undefined?[]:['-ss',String(time)]),'-frames:v','1','-vf',filter,'-pix_fmt','rgb24','-f','rawvideo',name],{cwd,signal});return readFile(path.join(cwd,name));}
async function pcm(input,name,settings,cwd,signal){await ffmpegRun(settings,['-i',input,'-vn','-ar','16000','-ac','1','-c:a','pcm_s16le','-f','s16le',name],{cwd,signal});return readFile(path.join(cwd,name));}
function audioDifference(a,b){const count=Math.min(a.length,b.length)>>1;let sum=0;for(let i=0;i<count;i++)sum+=(a.readInt16LE(i*2)-b.readInt16LE(i*2))**2;return Math.sqrt(sum/Math.max(1,count))/32768;}

export async function renderComposition(project,store,settings,{signal,stage=async()=>{},progress=()=>{},log=async()=>{},preview=false}={}){
  const api=await remotionModules();if(!settings.browser)throw new Error('Configure an installed supported Chromium executable for Remotion. Browser download/compatibility has not been assumed.');
  const cwd=path.join(store.dir(project.id),'renders',`remotion-${Date.now()}`);await mkdir(cwd,{recursive:true});
  const files=new Map(),assets=[],metadata={};for(const asset of project.assets){const file=await store.assetPath(project,asset.id);if(asset.hash&&await hashFile(file)!==asset.hash)throw new Error(`${asset.name} changed on disk. Re-import it.`);files.set(asset.id,file);assets.push({...asset,path:file});if(['raw','broll'].includes(asset.role))metadata[asset.id]=await probe(file,settings,signal);}
  const host=await hostRenderAssets(files),cancel=api.makeCancelSignal(),abort=()=>cancel.cancel();signal?.addEventListener('abort',abort,{once:true});
  try{
    if(signal?.aborted)throw new Error('Cancelled.');
    const compiled=compileComposition(project,{assetURL:host.url,audioURL:null,metadata,allowMissingAssets:true});
    if(JSON.stringify(project.plan)!==JSON.stringify(compiled.plan)){project.output=null;project.report=null;project.aiProposal=null;project.revision++;await log('change','Timeline quantized to export frames; earlier output evidence invalidated.');}
    project.plan=compiled.plan;
    const timeline=compiled.timeline,raw=assets.find(a=>a.role==='raw'),report=initializeReport(project.preferences.mandatory);let missingMusic=false;
    const missing=timeline.scenes.filter(s=>s.needsBroll&&(!s.brollURL||!s.brollLoopFrames));
    if(missing.length){setState(report,'broll','failed',`${missing.length} planned B-roll scenes lack approved media. This output is an incomplete draft.`);await log('failure',`Draft B-roll omissions: ${missing.map(s=>s.id).join(', ')}.`);}
    if(project.preferences.mandatory.includes('music')&&!assets.some(a=>a.role==='music')){missingMusic=true;setState(report,'music','failed','No licensed local music track was supplied; draft has no background music.');await log('failure','Draft omits missing mandatory background music.');}
    const audioPreferences=missingMusic?{...project.preferences,mandatory:project.preferences.mandatory.filter(k=>k!=='music')}:project.preferences;
    await stage('preparing-audio',null);const audio=await renderAudio(raw.path,project.plan,audioPreferences,assets,settings,cwd,{signal});files.set('audio-mix',audio);timeline.audioURL=host.url('audio-mix');
    for(const [key,entry]of Object.entries(report))if(entry.mandatory&&entry.state!=='failed')setState(report,key,'generated','Validated timeline compiled to Remotion frame instructions.');
    if(!preview){project.report=report;project.output=null;}await store.save(project);
    await stage('bundling-composition',null);const serveUrl=await api.bundle({entryPoint:fileURLToPath(new URL('../composition/Root.jsx',import.meta.url)),outDir:path.join(cwd,'bundle')});if(signal?.aborted)throw new Error('Cancelled.');
    const props={timeline,omit:[]},composition=await api.selectComposition({serveUrl,id:'ReelForge',inputProps:props,browserExecutable:settings.browser});
    const output=path.join(cwd,preview?'preview.mp4':'output.mp4');await stage(preview?'rendering-preview':'rendering-frames',0);
    await api.renderMedia({composition,serveUrl,inputProps:props,outputLocation:output,codec:'h264',audioCodec:'aac',audioBitrate:'192k',crf:19,scale:preview?0.5:1,overwrite:false,browserExecutable:settings.browser,cancelSignal:cancel.cancelSignal,onProgress:({progress:value})=>progress(value*100)});
    const outputHash=await hashFile(output),planHash=fingerprint({plan:project.plan,preferences:project.preferences,assets:project.assets});
    await stage('verifying-output',null);const expected={width:project.preferences.width*(preview?0.5:1),height:project.preferences.height*(preview?0.5:1),fps:timeline.fps,duration:timeline.duration},technical=await inspectOutput(output,expected,settings,{signal});
    const result={file:path.relative(store.dir(project.id),output),hash:outputHash,planHash,duration:technical.metadata.duration,width:technical.metadata.width,height:technical.metadata.height,fps:timeline.fps,renderer:'remotion',createdAt:new Date().toISOString()};
    if(preview){if(!technical.passed)throw new Error('Composition preview failed technical checks. Inspect render artifacts.');project.preview={...result,status:'rendered',technical};await store.save(project);return project;}
    project.output=result;const evidence=(passed,details)=>({kind:'output-check',passed,outputHash,planHash,at:new Date().toISOString(),...details});
    const record=(key,passed,details)=>{if(!report[key]?.mandatory||report[key].state==='failed')return;setState(report,key,passed?(REVIEW.has(key)?'rendered':'verified'):'failed',passed?(REVIEW.has(key)?'Rendered output measurements passed; review the actual export.':'Export measurements passed.'):'Actual output verification failed.',[evidence(passed,details)]);};
    record('dimensions',technical.checks.filter(c=>['dimensions','frame-rate','duration','codecs'].includes(c.name)).every(c=>c.passed),{checks:technical.checks});
    record('sync',technical.checks.find(c=>c.name==='audio-present-and-duration-sync').passed,{checks:technical.checks,note:'Stream checks do not replace lip-sync review.'});
    record('playback',technical.passed,{technical,note:'Full decode/black-frame/clipping guards passed; actual player and listening review still required.'});
    const finalAudio=await pcm(output,'export.pcm',settings,cwd,signal);const wordEnergy=project.plan.words.map(w=>{let sum=0;const start=Math.floor(w.start*16000),end=Math.min(finalAudio.length>>1,Math.floor(w.end*16000));for(let i=start;i<end;i++)sum+=(finalAudio.readInt16LE(i*2)/32768)**2;return {text:w.text,start:w.start,end:w.end,rms:Math.sqrt(sum/Math.max(1,end-start))};});
    record('transcription',wordEnergy.length>0&&wordEnergy.filter(w=>w.rms>.002).length/wordEnergy.length>=.85&&project.plan.alignment?.status!=='incomplete',{wordEnergy,alignment:project.plan.alignment||project.analysis?.transcript?.alignment||null,provenance:project.plan.transcriptProvenance,note:'Energy at word times is not recognition accuracy. Review every spoken word, spelling and alignment.'});
    record('cuts',project.plan.duration<project.plan.sourceDuration-.05,{sourceDuration:project.plan.sourceDuration,outputDuration:technical.metadata.duration,regions:project.plan.cuts});
    record('reference',false,{measured:project.analysis?.reference||project.plan.reference,note:'Full reference-style matching is not implemented; measured pacing/colour/audio alone cannot verify it.'});
    for(const key of ['captions','animation','keywords','broll','graphics','zoom','transitions','colour'].filter(k=>report[k].mandatory&&report[k].state!=='failed')){
      await stage(`verifying-${key}`,null);const frames=verificationFrames(key,timeline),samples=[];
      try{
        if(!frames.length)throw new Error('No rendered sample opportunity exists for this required feature.');
        for(let i=0;i<frames.length;i++){
          const frame=frames[i],control=path.join(cwd,`${key}-${i}-control.png`),absent=path.join(cwd,`${key}-${i}-absent.png`);
          await api.renderStill({composition,serveUrl,inputProps:props,frame,output:control,imageFormat:'png',browserExecutable:settings.browser,cancelSignal:cancel.cancelSignal});
          await api.renderStill({composition,serveUrl,inputProps:{timeline,omit:[key]},frame,output:absent,imageFormat:'png',browserExecutable:settings.browser,cancelSignal:cancel.cancelSignal});
          const actual=await rgb(output,region(key),`${key}-${i}-actual.rgb`,settings,cwd,signal,frame/timeline.fps),a=await rgb(control,region(key),`${key}-${i}-control.rgb`,settings,cwd,signal),b=await rgb(absent,region(key),`${key}-${i}-absent.rgb`,settings,cwd,signal);
          samples.push({frame,control:path.basename(control),absent:path.basename(absent),effectDifference:difference(a,b),compressionNoise:difference(actual,a),outputDifference:difference(actual,b)});
        }
        record(key,samples.every(s=>s.effectDifference>1&&s.outputDifference>s.compressionNoise*2+.5),{method:'Actual decoded export vs same-composition frame ablation and compression control',samples});
      }catch(e){if(signal?.aborted)throw e;record(key,false,{error:e.message,samples});await log('failure',`${key}: ${e.message}`);}
      await store.save(project);
    }
    const controlPCM=await pcm(audio,'mix-control.pcm',settings,cwd,signal);
    for(const key of ['music','sfx'].filter(k=>report[k].mandatory&&report[k].state!=='failed')){
      await stage(`verifying-${key}`,null);try{const omitted=await renderAudio(raw.path,project.plan,audioPreferences,assets,settings,cwd,{signal,omit:new Set([key]),name:`without-${key}.wav`}),absent=await pcm(omitted,`${key}-absent.pcm`,settings,cwd,signal),effect=audioDifference(controlPCM,absent),noise=audioDifference(finalAudio,controlPCM),observed=audioDifference(finalAudio,absent);record(key,effect>.0005&&observed>noise*2+.0005,{method:'Decoded export audio against feature-omitted mix with encoding-noise control',effectRMS:effect,encodingNoiseRMS:noise,outputDifferenceRMS:observed});}catch(e){if(signal?.aborted)throw e;record(key,false,{error:e.message});}
    }
    await api.renderStill({composition,serveUrl,inputProps:props,frame:Math.min(timeline.durationInFrames-1,Math.round(timeline.fps)),output:path.join(cwd,'preview.png'),imageFormat:'png',browserExecutable:settings.browser,cancelSignal:cancel.cancelSignal});project.output.preview=path.relative(store.dir(project.id),path.join(cwd,'preview.png'));
    await writeFile(path.join(cwd,'quality.json'),JSON.stringify({output:project.output,report,technical,gate:qualityGate(report,outputHash,planHash)},null,2));await store.save(project);return project;
  }finally{signal?.removeEventListener('abort',abort);await host.close();}
}
