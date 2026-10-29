import test from 'node:test';
import assert from 'node:assert/strict';
import { validateTranscript } from '../engine/transcript.mjs';
import { makePlan, validatePlan } from '../engine/planner.mjs';
import { DEFAULT_PREFS } from '../engine/store.mjs';
const words=[{text:'AI',start:0.4,end:0.7},{text:'aaj',start:0.8,end:1},{text:'cybersecurity',start:2,end:2.7},{text:'mein',start:2.8,end:3},{text:'important',start:3.1,end:3.6}];
const project=()=>({preferences:structuredClone(DEFAULT_PREFS),assets:[]});
test('Hinglish preserved, silence cuts remap captions and leave meaningful gaps',()=>{
  const p=makePlan(project(),{words},{duration:5});
  assert.deepEqual(p.words.map(w=>w.text),words.map(w=>w.text));
  assert.equal(p.cuts.length,2); assert.ok(p.duration<5);
  assert.ok(p.words[2].start<words[2].start); assert.ok(p.words.some(w=>w.keyword));
  assert.equal(validatePlan(p,project()),p);
});
test('missing local assets remain explicit, reference pacing is bounded',()=>{
  const p=makePlan(project(),{words},{duration:5},{medianShotSeconds:0.4});
  assert.ok(p.scenes.some(s=>s.needsBroll&&!s.brollId));
  assert.ok(p.warnings.some(w=>w.includes('B-roll')));
  assert.ok(p.warnings.some(w=>w.includes('music')));
});
test('invalid or fabricated timing is rejected',()=>{
  for(const bad of [[{text:'x',start:2,end:1}],[{text:'x',start:0,end:8}],[{text:'x',start:0,end:1},{text:'y',start:.5,end:2}]]) assert.throws(()=>validateTranscript({words:bad},5));
  assert.throws(()=>validateTranscript({words:[]},5));
});
test('scene tampering and unknown B-roll are rejected',()=>{
  const p=makePlan(project(),{words},{duration:5}); p.scenes[0].brollId='made-up';
  assert.throws(()=>validatePlan(p,project()),/Unknown B-roll/);
});
test('short recordings and tiny trailing scenes retain valid B-roll intervals',()=>{
  for(const duration of [.3,4.1,8.2]){
    const words=[{text:'security',start:.01,end:duration-.02}];
    const p=makePlan(project(),{words},{duration});
    assert.equal(validatePlan(p,project()),p);
    assert.ok(p.scenes.every(s=>s.brollEnd>s.brollStart));
  }
});
