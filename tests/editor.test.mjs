import test from 'node:test';
import assert from 'node:assert/strict';
import {timecode,sourceTime,outputTime,clipsForTrack,editTimeline,proposeDirector,TRACKS} from '../src/editor/model.mjs';
import {makePlan,validatePlan} from '../engine/planner.mjs';
import {DEFAULT_PREFS,validatePreferences} from '../engine/store.mjs';
function fixture(){
  const preferences={...structuredClone(DEFAULT_PREFS),mandatory:DEFAULT_PREFS.mandatory.filter(k=>k!=='cuts')};
  const assets=[{id:'raw',role:'raw',name:'Source.mp4',tags:[]},{id:'broll',role:'broll',name:'Security.mp4',tags:['security']},{id:'music',role:'music',name:'Bed.wav',tags:[]}];
  const words=Array.from({length:18},(_,i)=>({text:i%3===0?'security':'important',start:.25+i*.5,end:.55+i*.5}));
  const plan=makePlan({preferences,assets},{words},{duration:10});
  return {preferences,assets,plan};
}
test('editor timecodes use sequence frame rate and source/output mapping preserves cuts',()=>{
  assert.equal(timecode(61.2,25),'00:01:01:05');assert.equal(timecode(NaN),'00:00:00:00');
  const plan={cuts:[{start:2,end:4},{start:7,end:10}],duration:5};
  assert.equal(sourceTime(3,plan),8);assert.equal(outputTime(8,plan),3);assert.equal(sourceTime(5,plan),10);
});
test('track data reflects actual plan and imported assets; absent media is never fabricated',()=>{
  const f=fixture();for(const track of TRACKS)assert.equal(clipsForTrack(track.id,null,f.assets,f.preferences.mandatory).length,0);
  assert.equal(clipsForTrack('voice',f.plan,[],f.preferences.mandatory).length,0);
  assert.equal(clipsForTrack('music',f.plan,f.assets,f.preferences.mandatory).length,1);
  assert.equal(clipsForTrack('captions',f.plan,f.assets,f.preferences.mandatory).length,18);
  const missing=structuredClone(f.plan);for(const scene of missing.scenes)scene.brollId=null;
  assert.ok(clipsForTrack('broll',missing,f.assets,f.preferences.mandatory).every(c=>c.missing));
});
test('B-roll movement and edge trims stay within the scene and preserve valid backend plans',()=>{
  const f=fixture(),scene=f.plan.scenes[1],s={track:'broll',sceneId:scene.id};
  for(const mode of ['move','start','end'])for(const delta of [-100,-.37,.37,100]){
    const next=editTimeline(f.plan,s,mode,delta,{fps:30,snap:false});assert.equal(validatePlan(next,f),next);
    const changed=next.scenes[1];assert.ok(changed.brollStart>=changed.start);assert.ok(changed.brollEnd<=changed.end);assert.ok(changed.brollEnd>changed.brollStart);
    assert.equal(f.plan.scenes[1].brollStart,scene.brollStart);
  }
});
test('caption movement, frame nudges and trims do not overlap adjacent words',()=>{
  const f=fixture();for(const mode of ['move','start','end'])for(const delta of [-100,-1/30,1/30,100]){
    const next=editTimeline(f.plan,{track:'captions',wordIndex:1},mode,delta,{fps:30,snap:false});validatePlan(next,f);
    assert.ok(next.words[1].start>=next.words[0].end);assert.ok(next.words[1].end<=next.words[2].start);
  }
});
test('scene edge edits preserve contiguity, source cuts and linked B-roll bounds',()=>{
  const f=fixture();for(const mode of ['start','end'])for(const delta of [-100,-.5,.5,100]){
    const next=editTimeline(f.plan,{track:'video',sceneId:f.plan.scenes[1].id},mode,delta,{fps:30,snap:true});validatePlan(next,f);
    assert.equal(next.scenes[0].end,next.scenes[1].start);assert.equal(next.scenes[1].end,next.scenes[2].start);assert.deepEqual(next.cuts,f.plan.cuts);
  }
  assert.equal(editTimeline(f.plan,{track:'video',sceneId:f.plan.scenes[0].id},'move',1),f.plan);
  assert.equal(editTimeline(f.plan,{track:'music'},'move',1),f.plan);
});
test('snapping lands on real speech boundaries and can be bypassed',()=>{
  const f=fixture(),scene=f.plan.scenes[0],target=2.05,delta=target+.02-scene.brollEnd;
  const snapped=editTimeline(f.plan,{track:'broll',sceneId:scene.id},'end',delta,{fps:30,snap:true});
  const free=editTimeline(f.plan,{track:'broll',sceneId:scene.id},'end',delta,{fps:30,snap:false});
  assert.equal(snapped.scenes[0].brollEnd,target);assert.notEqual(free.scenes[0].brollEnd,target);
});
test('Director proposals are reviewable real edits and unavailable AI capabilities return errors',()=>{
  const f=fixture(),draft={preferences:f.preferences,plan:f.plan};
  const reduced=proposeDirector('Reduce background music.',draft,null,0,f.assets);assert.ok(reduced.next.preferences.musicVolume<draft.preferences.musicVolume);validatePreferences(reduced.next.preferences);assert.equal(draft.preferences.musicVolume,.09);
  const broll=proposeDirector('Add B-roll to this section.',draft,{track:'video',sceneId:f.plan.scenes[0].id},0,f.assets);assert.equal(broll.next.plan.scenes[0].brollId,'broll');assert.equal(broll.next.plan.scenes[0].needsBroll,true);validatePlan(broll.next.plan,f);
  assert.throws(()=>proposeDirector('Add B-roll to this section.',draft,null,0,[]),/No tagged local/);
  assert.throws(()=>proposeDirector('Improve caption timing.',draft,null,0,f.assets),/unavailable/);
  assert.throws(()=>proposeDirector('Match the reference style.',draft,null,0,f.assets),/unavailable/);
});
