import {readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {run} from './process.mjs';
import {validateTranscript,transcribe as whisperCpp} from './transcript.mjs';

const worker=fileURLToPath(new URL('../backend/speech_worker.py',import.meta.url));
export async function speechDiagnostics(settings={}){
  try{const r=await run(settings.python||'python',[worker,'diagnose'],{timeout:20000});const messages=r.stdout.trim().split('\n').map(line=>JSON.parse(line));return messages.find(m=>m.type==='result')?.result||{available:false,error:'Invalid speech diagnostic response.'};}
  catch(e){return {available:false,error:e.message};}
}
export async function speechTranscribe(raw,settings,duration,cwd,{signal,stage=async()=>{}}={}){
  if(settings.speechEngine==='whisper.cpp'){
    const result=await whisperCpp(raw,settings,duration,cwd,signal);
    return {...result,alignment:{method:'whisper.cpp-estimates',status:'estimated',note:'This explicitly selected legacy engine does not perform forced alignment.'}};
  }
  if(!settings.asrModel||!settings.alignModel)throw new Error('Configure local faster-whisper and WhisperX alignment model directories before transcribing.');
  await mkdir(cwd,{recursive:true});const request=path.join(cwd,'speech-request.json');
  await writeFile(request,JSON.stringify({audio:path.resolve(raw),duration,language:settings.language||'auto',asrModel:settings.asrModel,alignModel:settings.alignModel}));
  let buffered='',result=null,partial=null,error=null,stages=Promise.resolve();
  const line=message=>{
    if(message.type==='stage')stages=stages.then(()=>stage(message.stage,message.progress));
    if(message.type==='result')result=message.result;if(message.type==='partial-result')partial=message.result;if(message.type==='error')error=message.error;
  };
  try{
    await run(settings.python||'python',[worker,'transcribe','--request',request],{cwd,signal,timeout:3600000,onProgress:chunk=>{buffered+=chunk;let index;while((index=buffered.indexOf('\n'))>=0){const value=buffered.slice(0,index).trim();buffered=buffered.slice(index+1);if(value)line(JSON.parse(value));}}});
    if(buffered.trim())line(JSON.parse(buffered));await stages;
  }catch(e){await stages;if(partial)await writeFile(path.join(cwd,'transcript-needs-review.json'),JSON.stringify(partial,null,2));throw new Error(error||e.message);}
  if(!result)throw new Error('Speech worker produced no transcript.');
  const validated=validateTranscript(result,duration);
  const transcript={...validated,segments:result.segments,alignment:result.alignment};
  await writeFile(path.join(cwd,'transcript.json'),JSON.stringify(transcript,null,2));return transcript;
}
