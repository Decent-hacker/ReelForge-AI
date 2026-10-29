import test from 'node:test';
import assert from 'node:assert/strict';
import {makeAss,assEscape} from '../engine/captions.mjs';
import {compileGraph,difference} from '../engine/render.mjs';
import {makePlan} from '../engine/planner.mjs';
import {DEFAULT_PREFS} from '../engine/store.mjs';
const pref={...DEFAULT_PREFS};
const plan=makePlan({preferences:pref,assets:[]},{words:[{text:'AI',start:.2,end:.5},{text:'सुरक्षा',start:.6,end:1},{text:'important',start:1.1,end:1.5},{text:'security',start:5,end:5.5}]},{duration:6});
test('ASS output preserves Unicode, animates captions, highlights keywords and blocks override injection',()=>{
  const ass=makeAss(plan,pref);assert.match(ass,/सुरक्षा/);assert.match(ass,/\\t\(0,95/);assert.match(ass,/\\move\(/);
  assert.ok(!assEscape('{\\pos(1,1)}').includes('{'));assert.ok(!assEscape('{\\pos(1,1)}').includes('\\'));
  const without=makeAss(plan,pref,new Set(['captions','graphics']));assert.ok(!without.includes('Dialogue:'));
  assert.ok(!makeAss(plan,pref,new Set(['animation'])).includes('\\fscx88'));
});
test('render graph keeps audio/video cuts aligned and schedules effect layers',()=>{
  const g=compileGraph(plan,pref,[]);const graph=g.filters.join(';');
  assert.match(graph,/atrim=start=/);assert.match(graph,/setpts=PTS-STARTPTS/);assert.match(graph,/asetpts=PTS-STARTPTS/);
  assert.match(graph,/zoompan=/);assert.match(graph,/ass=filename=/);assert.match(graph,/sine=frequency=/);assert.match(graph,/\[aout\]/);
  const video=compileGraph(plan,pref,[],new Set(['zoom','colour']),'video').filters.join(';');
  assert.ok(!video.includes('zoompan'));assert.ok(!video.includes('atrim'));assert.ok(!video.includes('[aout]'));
});
test('evidence comparison rejects missing, identical and mismatched samples',()=>{
  assert.equal(difference(Buffer.alloc(0),Buffer.alloc(0)),0);assert.equal(difference(Buffer.from([1]),Buffer.from([1,2])),0);
  assert.equal(difference(Buffer.from([1,2]),Buffer.from([1,2])),0);assert.equal(difference(Buffer.from([0,0]),Buffer.from([10,20])),15);
});
