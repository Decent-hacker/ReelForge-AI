import path from 'node:path';
import {stat} from 'node:fs/promises';
export const DEFAULT_SETTINGS={ffmpeg:'',ffprobe:'',whisper:'',model:'',python:'',asrModel:'',alignModel:'',browser:'',renderer:'ffmpeg',speechEngine:'faster-whisper',planningEngine:'local',geminiModel:'',stockProvider:'local',autoStock:false};
export async function validateSettings(input,current={}){
  if(!input||typeof input!=='object'||Object.keys(input).some(k=>!Object.hasOwn(DEFAULT_SETTINGS,k)))throw new Error('Unsupported runtime setting. API keys belong in process environment, not project settings.');
  const next={...DEFAULT_SETTINGS,...current,...input};
  for(const key of ['ffmpeg','ffprobe','whisper','model','python','asrModel','alignModel','browser']){
    if(typeof next[key]!=='string')throw new Error(`${key} must be a string path.`);next[key]=next[key].trim();
    if(next[key]){if(!path.isAbsolute(next[key]))throw new Error(`${key} must be an absolute path.`);const item=await stat(next[key]);if(['asrModel','alignModel'].includes(key)?!item.isDirectory():!item.isFile())throw new Error(`${key}: invalid local file/model directory.`);}
  }
  for(const [key,allowed] of Object.entries({renderer:['ffmpeg','remotion'],speechEngine:['faster-whisper','whisper.cpp'],planningEngine:['local','gemini'],stockProvider:['local','pexels']}))if(!allowed.includes(next[key]))throw new Error(`Unsupported ${key}.`);
  if(typeof next.geminiModel!=='string'||next.geminiModel&&!/^[a-zA-Z0-9._-]+$/.test(next.geminiModel))throw new Error('Invalid Gemini model ID.');
  if(typeof next.autoStock!=='boolean')throw new Error('autoStock must be boolean.');return next;
}
