import {validatePlan} from './planner.mjs';
const rounded=n=>+n.toFixed(6);
export function normalizeCompositionPlan(project){
  const original=validatePlan(project.plan,project),plan=structuredClone(original),fps=project.preferences.fps;
  let oldOffset=0,newFrames=0;const mapping=[];
  plan.cuts=original.cuts.map(c=>{
    const start=Math.round(c.start*fps),end=Math.min(Math.floor((original.sourceDuration+1e-6)*fps),Math.round(c.end*fps));if(end<=start)throw new Error('A source region is shorter than one export frame.');
    mapping.push({oldOffset,oldLength:c.end-c.start,from:newFrames,start,oldStart:c.start,frames:end-start});oldOffset+=c.end-c.start;newFrames+=end-start;return {start:rounded(start/fps),end:rounded(end/fps)};
  });
  const frameAt=(seconds,isEnd=false)=>{
    for(let i=0;i<mapping.length;i++){const m=mapping[i];if(seconds<m.oldOffset+m.oldLength-1e-7||isEnd&&seconds<=m.oldOffset+m.oldLength+1e-7){if(Math.abs(seconds-m.oldOffset-m.oldLength)<1e-6)return m.from+m.frames;return m.from+Math.max(0,Math.min(m.frames,Math.round((seconds-m.oldOffset+m.oldStart)*fps)-m.start));}}
    return newFrames;
  };
  plan.duration=rounded(newFrames/fps);
  let previous=0;plan.words=original.words.map(w=>{const start=frameAt(w.start),end=frameAt(w.end,true);if(start<previous||end<=start)throw new Error(`Caption “${w.text}” needs manual timing correction at ${fps} fps.`);previous=end;return {...w,start:rounded(start/fps),end:rounded(end/fps)};});
  plan.scenes=original.scenes.map(s=>{const start=frameAt(s.start),end=frameAt(s.end,true);if(end<=start)throw new Error('A scene is shorter than one export frame.');const bStart=Math.min(end-1,Math.max(start,frameAt(s.brollStart))),bEnd=Math.max(bStart+1,Math.min(end,frameAt(s.brollEnd,true)));return {...s,start:rounded(start/fps),end:rounded(end/fps),brollStart:rounded(bStart/fps),brollEnd:rounded(bEnd/fps)};});
  if(original.overlays)plan.overlays=original.overlays.map(o=>({...o,start:rounded(frameAt(o.start)/fps),end:rounded(frameAt(o.end,true)/fps)}));
  plan.frameQuantization={fps,note:'Source cuts and all output events share export-frame boundaries.'};validatePlan(plan,project);return plan;
}
export function compileComposition(project,{assetURL,audioURL,metadata={},allowMissingAssets=false}){
  const plan=normalizeCompositionPlan(project),pref=project.preferences,raw=project.assets.find(a=>a.role==='raw');if(!raw)throw new Error('Source media is missing.');
  let from=0;const cuts=plan.cuts.map(c=>{const durationInFrames=Math.round((c.end-c.start)*pref.fps),clip={from,durationInFrames,startFrom:Math.round(c.start*pref.fps),src:assetURL(raw.id)};from+=durationInFrames;return clip;});
  const frames=s=>Math.round(s*pref.fps),scenes=plan.scenes.map(s=>({...s,from:frames(s.start),durationInFrames:frames(s.end)-frames(s.start),brollFrom:frames(s.brollStart),brollDuration:frames(s.brollEnd)-frames(s.brollStart),brollURL:s.brollId?assetURL(s.brollId):null,brollLoopFrames:s.brollId&&Number.isFinite(metadata[s.brollId]?.duration)&&metadata[s.brollId].duration>0?Math.max(1,frames(metadata[s.brollId].duration)):0}));
  for(const s of scenes)if(!allowMissingAssets&&s.needsBroll&&(!s.brollURL||!s.brollLoopFrames))throw new Error(`${s.id}: mandatory B-roll is missing or unprobed.`);
  const words=plan.words.map(w=>({...w,from:frames(w.start),to:frames(w.end)}));
  return {plan,timeline:{schema:1,width:pref.width,height:pref.height,fps:pref.fps,durationInFrames:from,duration:from/pref.fps,cuts,scenes,words,enabled:pref.mandatory,accent:pref.accent,font:pref.captionFont,audioURL,overlays:(plan.overlays||[]).map(o=>({...o,from:frames(o.start),durationInFrames:frames(o.end)-frames(o.start)}))}};
}
