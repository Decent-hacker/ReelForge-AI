import test from 'node:test';
import assert from 'node:assert/strict';
import { FEATURES, REVIEW, initializeReport, setState, qualityGate } from '../engine/quality.mjs';

test('timeline intent cannot be promoted to verification', () => {
  const r=initializeReport(Object.keys(FEATURES));
  assert.throws(()=>setState(r,'broll','verified','It exists in the plan.'), /exported artifact/);
  assert.equal(qualityGate(r,'output','plan').complete,false);
});
test('all mandatory features need matching artifact and plan evidence plus perceptual review', () => {
  const r=initializeReport(Object.keys(FEATURES));
  for (const k of Object.keys(r)) {
    const evidence=[{kind:'output-check',passed:true,outputHash:'hash',planHash:'plan'}];
    if (REVIEW.has(k)) evidence.push({kind:'human-review',passed:true,outputHash:'hash',planHash:'plan'});
    setState(r,k,'verified','Measured output plus review.',evidence);
  }
  assert.equal(qualityGate(r,'hash','plan').complete,true);
  assert.equal(qualityGate(r,'changed','plan').complete,false);
  assert.equal(qualityGate(r,'hash','changed').complete,false);
  r.music.evidence.pop(); assert.equal(qualityGate(r,'hash','plan').complete,false);
});
test('a skipped mandatory feature and empty mandatory list cannot pass', () => {
  const r=initializeReport(['broll']); setState(r,'broll','skipped','No assets.');
  assert.equal(qualityGate(r,'hash','plan').complete,false);
  assert.equal(qualityGate(initializeReport([]),'hash','plan').complete,false);
});
