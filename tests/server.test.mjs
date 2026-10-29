import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {createServer,parseRange} from '../server/index.mjs';

test('byte range playback handles normal, open and suffix ranges',()=>{
  assert.deepEqual(parseRange('bytes=2-5',10),{start:2,end:5});
  assert.deepEqual(parseRange('bytes=2-',10),{start:2,end:9});
  assert.deepEqual(parseRange('bytes=-3',10),{start:7,end:9});
  assert.throws(()=>parseRange('bytes=10-',10));assert.throws(()=>parseRange('bytes=2-1',10));
  assert.throws(()=>parseRange('bytes=1-2,4-5',10));assert.throws(()=>parseRange('bytes=-',10));
});
test('HTTP application serves UI, isolates session, imports files and fails truthfully without tools',async t=>{
  const root=await mkdtemp(path.resolve('artifacts/http-test-'));
  const app=await createServer({root,port:0,token:'test-session-token'});t.after(()=>app.close());
  const request=async(route,{body,method='GET',headers={}}={})=>fetch(app.origin+route,{method,headers:{'X-ReelForge-Token':app.token,...headers},body});
  const publicPage=await fetch(app.origin);assert.equal(publicPage.status,200);assert.match(await publicPage.text(),/ReelForge AI/);
  assert.match(publicPage.headers.get('content-security-policy'),/frame-ancestors 'none'/);
  assert.equal((await fetch(app.origin+'/api/bootstrap')).status,401);
  assert.equal((await request('/api/bootstrap',{headers:{Origin:'https://malicious.example'}})).status,403);
  assert.equal((await request('/api/projects',{method:'POST',body:'not json'})).status,400);
  const created=await request('/api/projects',{method:'POST',body:JSON.stringify({name:'Integration project'})});assert.equal(created.status,201);
  const p=await created.json();const prefix=`/api/projects/${p.id}`;
  const invalid=await request(prefix+'/import?role=raw&name=program.exe',{method:'POST',body:'x'});assert.equal(invalid.status,400);
  // Deliberately invalid media tests storage and error reporting; it is never claimed to be a video fixture.
  const imported=await request(prefix+'/import?role=raw&name=invalid.mp4',{method:'POST',body:'deliberately invalid media for rejection testing'});assert.equal(imported.status,201);
  const loaded=await imported.json();assert.equal(loaded.assets.length,1);assert.equal(loaded.plan,null);
  const asset=loaded.assets[0];const ranged=await request(prefix+`/media/${asset.id}`,{headers:{Range:'bytes=0-3'}});
  assert.equal(ranged.status,206);assert.equal(await ranged.text(),'deli');
  assert.equal((await request(prefix+'/export')).status,400);
  const started=await request(prefix+'/analyze',{method:'POST',body:'{}'});assert.equal(started.status,202);
  const active=app.service.jobs.get(p.id);if(active)await active.task;
  const result=await (await request(prefix)).json();
  assert.equal(result.job.status,'failed');assert.ok(result.job.error);assert.equal(result.output,null);assert.equal(result.gate.complete,false);
  assert.equal((await request(prefix+'/review',{method:'POST',body:JSON.stringify({keys:['captions'],approved:true})})).status,400);
  assert.equal((await request('/api/projects/not-a-uuid')).status,400);
});
