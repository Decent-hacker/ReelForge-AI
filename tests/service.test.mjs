import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {Service} from '../engine/service.mjs';
import {FEATURES,initializeReport,setState,fingerprint} from '../engine/quality.mjs';
import {hashFile} from '../engine/render.mjs';
import {makePlan} from '../engine/planner.mjs';

test('review cannot override failed output evidence or an altered output',async()=>{
  const s=new Service(await mkdtemp(path.resolve('artifacts/review-test-')));await s.init();const p=await s.store.create('Review test');
  const file=path.join(s.store.dir(p.id),'test.bin');await writeFile(file,'not a video; integrity tests only');
  const hash=await hashFile(file),planHash=fingerprint({plan:p.plan,preferences:p.preferences,assets:p.assets});
  p.output={file:'test.bin',hash,planHash};p.report=initializeReport(Object.keys(FEATURES));
  setState(p.report,'captions','failed','No output evidence.');await s.store.save(p);
  await assert.rejects(()=>s.review(p.id,{keys:['captions'],approved:true,outputHash:hash}),/evidence is missing/);
  setState(p.report,'captions','rendered','Measured sample.',[{kind:'output-check',passed:true,outputHash:hash,planHash}]);await s.store.save(p);
  const approved=await s.review(p.id,{keys:['captions'],approved:true,outputHash:hash});assert.equal(approved.report.captions.state,'verified');assert.equal(approved.gate.complete,false);
  await writeFile(file,'changed output');await assert.rejects(()=>s.review(p.id,{keys:['captions'],approved:true,outputHash:hash}),/changed/);
  await assert.rejects(()=>s.exportInfo(p.id),/changed on disk/);
});
test('preferences invalidate previous results and cancellation errors stay explicit',async()=>{
  const s=new Service(await mkdtemp(path.resolve('artifacts/service-test-')));await s.init();const p=await s.store.create();
  p.output={hash:'stale'};p.plan={schema:1};await s.store.save(p);
  const changed=await s.update(p.id,{preferences:{...p.preferences,pace:5}});assert.equal(changed.output,null);assert.equal(changed.plan,null);assert.equal(changed.revision,1);
  await assert.rejects(()=>s.cancel(p.id),/No running job/);
  await s.start(p.id,'analyze');const task=s.jobs.get(p.id)?.task;if(task)await task;
  const failed=await s.get(p.id);assert.equal(failed.job.status,'failed');assert.match(failed.job.error,/Import a raw/);
});
test('atomic save of preferences and edited plan preserves source-duration validation',async()=>{
  const s=new Service(await mkdtemp(path.resolve('artifacts/combined-save-test-')));await s.init();const p=await s.store.create();
  p.plan=makePlan(p,{words:[{text:'security',start:.2,end:1.2}]},{duration:2});await s.store.save(p);
  const edited=structuredClone(p.plan);edited.scenes[0].title='Updated title';
  const updated=await s.update(p.id,{preferences:{...p.preferences,accent:'#E6A85C'},plan:edited});
  assert.equal(updated.preferences.accent,'#E6A85C');assert.equal(updated.plan.sourceDuration,2);assert.equal(updated.plan.scenes[0].title,'Updated title');assert.equal(updated.output,null);
  const invalid=structuredClone(edited);invalid.cuts[0].end=50;await assert.rejects(()=>s.update(p.id,{preferences:p.preferences,plan:invalid}),/cut range/);
});
test('export rejects a changed timeline even if the rendered file hash is unchanged',async()=>{
  const s=new Service(await mkdtemp(path.resolve('artifacts/stale-plan-test-')));await s.init();
  try{const p=await s.store.create();const file=path.join(s.store.dir(p.id),'integrity.bin');await writeFile(file,'integrity fixture, not video');p.output={file:'integrity.bin',hash:await hashFile(file),planHash:fingerprint({plan:p.plan,preferences:p.preferences,assets:p.assets})};p.preferences.musicVolume=.04;await s.store.save(p);await assert.rejects(()=>s.exportInfo(p.id),/Timeline changed/);}finally{await s.close();}
});
