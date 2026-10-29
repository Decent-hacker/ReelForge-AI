import {ffmpegRun} from './process.mjs';
import path from 'node:path';
export const VOICE_CHAIN='highpass=f=80,lowpass=f=16000,afftdn=nf=-25,acompressor=threshold=0.125:ratio=3:attack=10:release=150,loudnorm=I=-16:TP=-1.5:LRA=9,aresample=48000';
export function compileAudio(plan,preferences,assets,omit=new Set()){
  const filters=[],inputs=[],n=plan.cuts.length,enabled=k=>preferences.mandatory.includes(k)&&!omit.has(k);
  if(n>1)filters.push(`[0:a]asplit=${n}${plan.cuts.map((_,i)=>`[a${i}]`).join('')}`);
  plan.cuts.forEach((c,i)=>filters.push(`[${n>1?`a${i}`:'0:a'}]atrim=start=${c.start}:end=${c.end},asetpts=PTS-STARTPTS[s${i}]`));
  filters.push(`${plan.cuts.map((_,i)=>`[s${i}]`).join('')}concat=n=${n}:v=0:a=1,${VOICE_CHAIN}[voice]`);
  const mix=[];let voice='voice';
  if(enabled('music')){
    const music=assets.find(a=>a.role==='music');if(!music)throw new Error('Selected background music has no approved audio asset.');
    inputs.push('-stream_loop','-1','-i',music.path);filters.push(`[1:a]aresample=48000,atrim=duration=${plan.duration},asetpts=PTS-STARTPTS,volume=${preferences.musicVolume},afade=t=in:d=.3,afade=t=out:st=${Math.max(0,plan.duration-.6)}:d=.6[music]`);
    filters.push('[voice]asplit=2[main][side]','[music][side]sidechaincompress=threshold=.025:ratio=8:attack=15:release=220[ducked]');voice='main';mix.push('ducked');
  }
  if(enabled('sfx'))plan.scenes.forEach((s,i)=>{filters.push(`sine=frequency=${640+i%3*160}:sample_rate=48000:duration=.11,volume=.12,afade=t=out:st=.015:d=.095,adelay=${Math.round(s.start*1000)}:all=1[fx${i}]`);mix.push(`fx${i}`);});
  filters.push(`[${voice}]${mix.map(a=>`[${a}]`).join('')}${mix.length?`amix=inputs=${mix.length+1}:duration=first:normalize=0,`:''}alimiter=limit=.95:level=false,apad,atrim=duration=${plan.duration}[mix]`);
  return {filters,inputs};
}
export async function renderAudio(raw,plan,preferences,assets,settings,cwd,{signal,omit=new Set(),name='mix.wav'}={}){
  const graph=compileAudio(plan,preferences,assets,omit);await ffmpegRun(settings,['-i',raw,...graph.inputs,'-filter_complex',graph.filters.join(';'),'-map','[mix]','-vn','-ar','48000','-ac','2','-c:a','pcm_s16le',name],{cwd,signal});return path.join(cwd,name);
}
