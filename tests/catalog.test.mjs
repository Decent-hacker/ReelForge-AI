import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import {Catalog} from '../engine/catalog.mjs';
test('SQLite jobs retain stages, measured progress and history after reopening',async()=>{
  const root=await mkdtemp(path.resolve('artifacts/catalog-test-')),a=await new Catalog(root).open();
  const job=a.createJob('project','transcribe',{language:'auto'});Object.assign(job,{status:'running',stage:'decoding',progress:null});a.updateJob(job);
  Object.assign(job,{stage:'transcribing',progress:42});a.updateJob(job,{message:'Processed 4.2 / 10 seconds.'});await a.close();
  const b=await new Catalog(root).open();try{assert.equal(b.job(job.id).progress,42);assert.equal(b.job(job.id).events.length,3);assert.equal(b.interrupt(),1);assert.equal(b.job(job.id).stage,'interrupted');assert.equal(b.jobs('project')[0].status,'failed');}finally{await b.close();}
});
test('a second backend cannot mutate an owned project directory',async()=>{
  const root=await mkdtemp(path.resolve('artifacts/owner-test-')),a=await new Catalog(root).open();
  try{await assert.rejects(()=>new Catalog(root).open(),/already owned/);}finally{await a.close();}
  const b=await new Catalog(root).open();await b.close();
});
