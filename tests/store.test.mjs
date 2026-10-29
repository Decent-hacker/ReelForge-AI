import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { Store, DEFAULT_PREFS, validatePreferences } from '../engine/store.mjs';
test('atomic project persistence, list, recovery and traversal validation',async()=>{
  const root=await mkdtemp(path.resolve('artifacts/store-test-')); const s=new Store(root);
  const p=await s.create('My reel'); p.job={status:'running'}; await s.save(p);
  assert.equal((await s.load(p.id)).name,'My reel');
  assert.equal((await s.list()).length,1); await s.recover();
  assert.equal((await s.load(p.id)).job.status,'failed');
  assert.throws(()=>s.dir('../private'),/Invalid/);
});
test('mandatory quality checks cannot be removed through preferences',()=>{
  assert.throws(()=>validatePreferences({...DEFAULT_PREFS,mandatory:[]}),/cannot be disabled/);
  assert.throws(()=>validatePreferences({...DEFAULT_PREFS,accent:'red;movie=file'}));
  assert.throws(()=>validatePreferences({...DEFAULT_PREFS,musicVolume:NaN}));
});
test('queued project writes preserve valid JSON and the latest revision under Windows file contention',async()=>{
  const s=new Store(await mkdtemp(path.resolve('artifacts/queued-write-test-'))),p=await s.create('Concurrent writes');
  await Promise.all(Array.from({length:25},(_,i)=>s.save({...p,revision:i})));
  assert.equal((await s.load(p.id)).revision,24);
});
