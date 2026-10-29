import React from 'react';
import {AbsoluteFill,Audio,Composition,Loop,OffthreadVideo,Sequence,interpolate,registerRoot,useCurrentFrame,useVideoConfig} from 'remotion';

const pop=(frame,fps)=>interpolate(frame,[0,.095*fps,.17*fps],[.88,1.05,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'});
function AnimatedCaptions({timeline,omit}){
  const frame=useCurrentFrame(),index=timeline.words.findIndex(w=>frame>=w.from&&frame<w.to);if(index<0||omit.includes('captions'))return null;
  const first=Math.floor(index/3)*3,words=timeline.words.slice(first,first+3),active=timeline.words[index];
  return <div style={{position:'absolute',bottom:'23%',left:'8%',right:'8%',textAlign:'center',fontFamily:timeline.font,fontSize:timeline.width*.061,fontWeight:800,lineHeight:1.2,color:'white',textShadow:'0 2px 6px #000, 2px 0 3px #000, -2px 0 3px #000',transform:`scale(${omit.includes('animation')?1:pop(frame-active.from,timeline.fps)})`}}>{words.map((w,i)=><span key={first+i} style={{color:w.keyword&&!omit.includes('keywords')?timeline.accent:'white',textDecoration:first+i===index?'underline':'none',marginRight:'0.25em'}}>{w.text}</span>)}</div>;
}
function MotionTitle({scene,timeline}){
  const frame=useCurrentFrame(),x=interpolate(frame,[0,.24*timeline.fps],[-timeline.width,0],{extrapolateRight:'clamp'}),duration=Math.min(scene.durationInFrames,Math.round(1.6*timeline.fps)),opacity=Math.min(1,(frame+1)/Math.max(1,.05*timeline.fps),(duration-frame)/Math.max(1,.16*timeline.fps));
  return <div style={{position:'absolute',top:'16%',left:'8%',right:'8%',textAlign:'center',fontFamily:timeline.font,fontSize:timeline.width*.04,fontWeight:700,transform:`translateX(${x}px)`,opacity}}><span style={{display:'inline-block',background:'#141518',color:timeline.accent,padding:'12px 22px',borderRadius:5}}>{scene.title}</span></div>;
}
function Callout({overlay,timeline}){
  const frame=useCurrentFrame(),scale=interpolate(frame,[0,Math.min(8,overlay.durationInFrames)],[.9,1],{extrapolateRight:'clamp'});return <div style={{position:'absolute',left:'10%',right:'10%',top:'36%',background:'#141518EE',borderLeft:`6px solid ${timeline.accent}`,padding:'28px 32px',color:'white',fontFamily:timeline.font,fontSize:timeline.width*.055,fontWeight:700,transform:`scale(${scale})`}}>{overlay.text}</div>;
}
function Statistic({overlay,timeline}){
  const frame=useCurrentFrame(),amount=interpolate(frame,[0,Math.min(24,overlay.durationInFrames)],[0,overlay.value],{extrapolateRight:'clamp'});return <div style={{position:'absolute',left:'10%',right:'10%',top:'35%',padding:'25px',background:'#141518EE',color:'white',fontFamily:timeline.font,textAlign:'center'}}><div style={{fontSize:timeline.width*.14,fontWeight:800,color:timeline.accent}}>{Math.round(amount).toLocaleString('en-IN')}{overlay.unit}</div><div style={{fontSize:timeline.width*.045}}>{overlay.label}</div></div>;
}
export function ReelComposition({timeline,omit=[]}){
  const frame=useCurrentFrame(),scene=timeline.scenes.find(s=>frame>=s.from&&frame<s.from+s.durationInFrames),enabled=key=>timeline.enabled.includes(key)&&!omit.includes(key),local=scene?frame-scene.from:0;
  const scale=scene&&enabled('zoom')?interpolate(local,[0,.35*timeline.fps],[1,scene.zoom],{extrapolateRight:'clamp'}):1;
  return <AbsoluteFill style={{backgroundColor:'black',overflow:'hidden'}}>
    <AbsoluteFill style={{transform:`scale(${scale})`,filter:enabled('colour')?'contrast(1.04) saturate(1.08) brightness(1.008)':'none'}}>{timeline.cuts.map((c,i)=><Sequence key={i} from={c.from} durationInFrames={c.durationInFrames}><OffthreadVideo src={c.src} startFrom={c.startFrom} muted style={{width:'100%',height:'100%',objectFit:'cover'}}/></Sequence>)}</AbsoluteFill>
    {enabled('broll')&&timeline.scenes.filter(s=>s.needsBroll&&s.brollURL).map(s=><Sequence key={s.id} from={s.brollFrom} durationInFrames={s.brollDuration}><Loop durationInFrames={s.brollLoopFrames}><OffthreadVideo src={s.brollURL} muted style={{width:'100%',height:'100%',objectFit:'cover'}}/></Loop></Sequence>)}
    {enabled('transitions')&&timeline.scenes.slice(1).map(s=><Sequence key={s.id} from={s.from} durationInFrames={Math.max(1,Math.round(.065*timeline.fps))}><AbsoluteFill style={{backgroundColor:'white',opacity:.78}}/></Sequence>)}
    {enabled('graphics')&&timeline.scenes.map(s=><Sequence key={s.id} from={s.from} durationInFrames={Math.min(s.durationInFrames,Math.round(1.6*timeline.fps))}><MotionTitle scene={s} timeline={timeline}/></Sequence>)}
    {timeline.enabled.includes('captions')&&<AnimatedCaptions timeline={timeline} omit={omit}/>}
    {!omit.includes('graphics')&&timeline.overlays.map((o,i)=><Sequence key={i} from={o.from} durationInFrames={o.durationInFrames}>{o.type==='statistic'?<Statistic overlay={o} timeline={timeline}/>:<Callout overlay={o} timeline={timeline}/>}</Sequence>)}
    {timeline.audioURL&&<Audio src={timeline.audioURL}/>}
  </AbsoluteFill>;
}
function Root(){return <Composition id="ReelForge" component={ReelComposition} width={1080} height={1920} fps={30} durationInFrames={30} defaultProps={{timeline:null,omit:[]}} calculateMetadata={({props})=>{const t=props.timeline;if(!t||t.schema!==1)throw new Error('Validated timeline props are required.');return {width:t.width,height:t.height,fps:t.fps,durationInFrames:t.durationInFrames};}}/>;}
registerRoot(Root);
