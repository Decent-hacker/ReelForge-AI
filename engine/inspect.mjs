import {probe,ffmpegRun} from './process.mjs';
export function parseBlackFrames(stderr){return [...stderr.matchAll(/black_start:([\d.]+)\s+black_end:([\d.]+)\s+black_duration:([\d.]+)/g)].map(m=>({start:Number(m[1]),end:Number(m[2]),duration:Number(m[3])}));}
export async function inspectOutput(file,expected,settings,{signal}={}){
  const info=await probe(file,settings,signal),checks=[];
  const add=(name,passed,measured)=>checks.push({name,passed,measured});
  add('dimensions',info.width===expected.width&&info.height===expected.height,{width:info.width,height:info.height});
  add('frame-rate',Math.abs(info.fps-expected.fps)<.01,info.fps);
  add('duration',Math.abs(info.duration-expected.duration)<=Math.max(.1,2/expected.fps),info.duration);
  add('codecs',info.video?.codec_name==='h264'&&info.audio?.codec_name==='aac',{video:info.video?.codec_name,audio:info.audio?.codec_name});
  const vd=Number(info.video?.duration),ad=Number(info.audio?.duration);add('audio-present-and-duration-sync',!!info.audio&&Number.isFinite(vd)&&Number.isFinite(ad)&&Math.abs(vd-ad)<.15,{videoDuration:vd,audioDuration:ad,note:'Duration comparison is not a perceptual lip-sync test.'});
  try{await ffmpegRun(settings,['-v','error','-xerror','-i',file,'-f','null','-'],{signal});add('full-decode',true,'All audio/video decoded.');}catch(e){add('full-decode',false,e.message);}
  const black=await ffmpegRun(settings,['-i',file,'-an','-vf','blackdetect=d=.4:pix_th=.1:pic_th=.98','-f','null','-'],{signal});
  const intervals=parseBlackFrames(black.stderr);add('black-frames',intervals.length===0,{intervals,note:'Runs >=0.4 seconds at >=98% black are flagged for review, including intentionally dark content.'});
  const audio=await ffmpegRun(settings,['-i',file,'-vn','-af','astats=metadata=0:reset=0','-f','null','-'],{signal});
  const peak=[...audio.stderr.matchAll(/Peak level dB:\s*(-?[\d.]+)/g)].at(-1)?.[1],rms=[...audio.stderr.matchAll(/RMS level dB:\s*(-?[\d.]+)/g)].at(-1)?.[1];
  add('audio-clipping',peak!==undefined&&Number(peak)<-.1,{peakDB:peak===undefined?null:Number(peak),rmsDB:rms===undefined?null:Number(rms),note:'Peak-based clipping guard; audibility and intelligibility need listening review.'});
  return {passed:checks.every(c=>c.passed),checks,metadata:{duration:info.duration,width:info.width,height:info.height,fps:info.fps,videoCodec:info.video?.codec_name,audioCodec:info.audio?.codec_name}};
}
