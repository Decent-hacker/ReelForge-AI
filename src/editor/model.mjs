export const TRACKS = [
  {id:'video',name:'Video',code:'V1',icon:'film'},
  {id:'broll',name:'B-roll',code:'V2',icon:'layers'},
  {id:'captions',name:'Captions',code:'C1',icon:'captions'},
  {id:'graphics',name:'Motion graphics',code:'G1',icon:'shapes'},
  {id:'sfx',name:'Sound effects',code:'A1',icon:'audio'},
  {id:'voice',name:'Voice',code:'A2',icon:'mic'},
  {id:'music',name:'Music',code:'A3',icon:'music'}
];
export function timecode(seconds,fps=30){
  const frames=Math.max(0,Math.round((Number.isFinite(seconds)?seconds:0)*fps));
  return [Math.floor(frames/(fps*3600)),Math.floor(frames/(fps*60))%60,Math.floor(frames/fps)%60,frames%fps].map(n=>String(n).padStart(2,'0')).join(':');
}
export function sourceTime(outputTime,plan){
  if(!plan)return outputTime;
  let offset=0;for(const cut of plan.cuts){const length=cut.end-cut.start;if(outputTime<offset+length)return cut.start+outputTime-offset;offset+=length;}
  return plan.cuts.at(-1)?.end||0;
}
export function outputTime(source,plan){
  if(!plan)return source;
  let offset=0;for(const cut of plan.cuts){if(source<=cut.end)return offset+Math.max(0,source-cut.start);offset+=cut.end-cut.start;}
  return plan.duration;
}
export function clipsForTrack(track,plan,assets,mandatory){
  if(!plan)return [];
  const enabled=k=>mandatory.includes(k),raw=assets.find(a=>a.role==='raw');
  switch(track){
    case 'video':return plan.scenes.map(s=>({id:s.id,start:s.start,end:s.end,label:s.title,selection:{track,sceneId:s.id},edit:'boundary'}));
    case 'broll':return plan.scenes.filter(s=>s.needsBroll).map(s=>({id:s.id,start:s.brollStart,end:s.brollEnd,label:assets.find(a=>a.id===s.brollId)?.name||'Assign B-roll',missing:!s.brollId,selection:{track,sceneId:s.id},edit:'range'}));
    case 'captions':return enabled('captions')?plan.words.map((w,i)=>({id:`word-${i}`,start:w.start,end:w.end,label:w.text,selection:{track,wordIndex:i},edit:'range'})):[];
    case 'graphics':return enabled('graphics')?[...plan.scenes.map(s=>({id:s.id,start:s.start,end:Math.min(s.end,s.start+1.6),label:s.title,selection:{track,sceneId:s.id},edit:'none'})),...(plan.overlays||[]).map((o,i)=>({id:`overlay-${i}`,start:o.start,end:o.end,label:o.type==='callout'?o.text:`${o.value}${o.unit} · ${o.label}`,selection:{track,overlayIndex:i},edit:'none'}))]:[];
    case 'sfx':return enabled('sfx')?plan.scenes.map(s=>({id:s.id,start:s.start,end:Math.min(s.end,s.start+.11),label:'Accent chime',selection:{track,sceneId:s.id},edit:'none'})):[];
    case 'voice':return raw?[{id:'voice',start:0,end:plan.duration,label:raw.name,selection:{track},edit:'none'}]:[];
    case 'music':{const music=assets.find(a=>a.role==='music');return music&&enabled('music')?[{id:music.id,start:0,end:plan.duration,label:music.name,selection:{track},edit:'none'}]:[];}
    default:return [];
  }
}
const clamp=(n,min,max)=>Math.max(min,Math.min(max,n));
function fitBroll(scene){
  const length=scene.end-scene.start,min=Math.min(.04,length/3);
  scene.brollStart=clamp(scene.brollStart,scene.start,scene.end-min);
  scene.brollEnd=clamp(scene.brollEnd,scene.brollStart+min,scene.end);
}
export function editTimeline(plan,selection,mode,delta,{fps=30,snap=true}={}){
  if(!plan||!Number.isFinite(delta))return plan;
  const p=structuredClone(plan),frame=1/fps;
  const quantize=n=>Math.round(n*fps)/fps;
  const snapTo=(value,points)=>{let v=quantize(value);if(snap){const near=points.filter(n=>Math.abs(n-v)<=Math.min(.12,4/fps)).sort((a,b)=>Math.abs(a-v)-Math.abs(b-v));if(near.length)v=near[0];}return +v.toFixed(3);};
  if(selection.track==='captions'){
    const index=selection.wordIndex,w=p.words[index];if(!w)return plan;
    const minimum=Math.min(frame,w.end-w.start);
    const lower=p.words[index-1]?.end||0,upper=p.words[index+1]?.start??p.duration;
    const points=[lower,upper,...p.scenes.flatMap(s=>[s.start,s.end])];
    if(mode==='move'){const length=w.end-w.start;const start=clamp(snapTo(w.start+delta,points),lower,upper-length);w.start=start;w.end=start+length;}
    else if(mode==='start')w.start=clamp(snapTo(w.start+delta,points),lower,w.end-minimum);
    else if(mode==='end')w.end=clamp(snapTo(w.end+delta,points),w.start+minimum,upper);
    else return plan;
    w.start=+w.start.toFixed(3);w.end=+w.end.toFixed(3);
  }else{
    const index=p.scenes.findIndex(s=>s.id===selection.sceneId),s=p.scenes[index];if(!s)return plan;
    if(selection.track==='broll'){
      const minimum=Math.min(frame,s.brollEnd-s.brollStart);
      const points=[s.start,s.end,...p.words.filter(w=>w.start>=s.start&&w.start<=s.end).flatMap(w=>[w.start,w.end])];
      if(mode==='move'){const length=s.brollEnd-s.brollStart;const start=clamp(snapTo(s.brollStart+delta,points),s.start,s.end-length);s.brollStart=start;s.brollEnd=start+length;}
      else if(mode==='start')s.brollStart=clamp(snapTo(s.brollStart+delta,points),s.start,s.brollEnd-minimum);
      else if(mode==='end')s.brollEnd=clamp(snapTo(s.brollEnd+delta,points),s.brollStart+minimum,s.end);
      else return plan;
      s.brollStart=+s.brollStart.toFixed(3);s.brollEnd=+s.brollEnd.toFixed(3);
    }else if(selection.track==='video'){
      if(mode==='end'&&index<p.scenes.length-1){const next=p.scenes[index+1];s.end=snapTo(clamp(s.end+delta,s.start+.2,next.end-.2),p.words.flatMap(w=>[w.start,w.end]));s.end=clamp(s.end,s.start+.2,next.end-.2);next.start=s.end;fitBroll(s);fitBroll(next);}
      else if(mode==='start'&&index>0){const prev=p.scenes[index-1];s.start=snapTo(clamp(s.start+delta,prev.start+.2,s.end-.2),p.words.flatMap(w=>[w.start,w.end]));s.start=clamp(s.start,prev.start+.2,s.end-.2);prev.end=s.start;fitBroll(s);fitBroll(prev);}
      else return plan;
      for(const scene of p.scenes)scene.text=p.words.filter(w=>w.start>=scene.start&&w.start<scene.end).map(w=>w.text).join(' ');
    }else return plan;
  }
  return p;
}
export function proposeDirector(command,draft,selection,time,assets){
  const text=command.trim().toLowerCase(),scene=draft.plan?.scenes.find(s=>s.id===selection?.sceneId)||draft.plan?.scenes.find(s=>time>=s.start&&time<s.end);
  if(/(reduce|lower|quieter|decrease).*(music|background)/.test(text)){
    const from=draft.preferences.musicVolume,to=+(from*.65).toFixed(3);
    return {label:`Reduce music from ${Math.round(from*100)}% to ${Math.round(to*100)}%`,detail:'Changes the music mix level. Save and render to hear the result.',next:{...draft,preferences:{...draft.preferences,musicVolume:to}}};
  }
  if(/(add|insert).*(b.?roll)/.test(text)){
    if(!scene)throw new Error('Select a scene or place the playhead inside a scene first.');
    const asset=assets.find(a=>a.role==='broll'&&a.tags?.some(tag=>scene.text.toLowerCase().includes(tag.toLowerCase())));
    if(!asset)throw new Error('No tagged local B-roll matches this scene. Import and tag an approved clip, or assign one in the inspector.');
    return {label:`Add ${asset.name}`,detail:`Assign approved local B-roll to scene ${draft.plan.scenes.indexOf(scene)+1}.`,next:{...draft,plan:{...draft.plan,scenes:draft.plan.scenes.map(s=>s.id===scene.id?{...s,brollId:asset.id,needsBroll:true}:s)}}};
  }
  if(/(improve|fix|adjust).*(caption|timing)/.test(text))throw new Error('Automatic speech alignment is unavailable. Select a caption to adjust its word timing manually.');
  if(/(match|reference).*(style|reference|pace)/.test(text))throw new Error('Full reference-style matching is unavailable. Measured reference pacing is shown in Project settings; use Analyze to rebuild a plan.');
  throw new Error('Local actions support “Add B-roll to this section” and “Reduce background music”. Other requests need manual editing.');
}
