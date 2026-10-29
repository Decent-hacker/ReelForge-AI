import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import path from 'node:path';
import {createServer} from '../server/index.mjs';
import {Service} from '../engine/service.mjs';
test('explicit timeline/analysis/job/provider routes return real persisted state and unavailable-provider errors',async()=>{
  const root=await mkdtemp(path.resolve('artifacts/jobs-api-')),app=await createServer({root,port:0});
  const call=async(route,body)=>{const r=await fetch(app.origin+'/api/'+route,{method:body===undefined?'GET':'POST',headers:{'X-ReelForge-Token':app.token},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json()};};
  let id,jobId;
  try{
    id=(await call('projects',{name:'Durable API test'})).data.id;
    assert.equal((await call(`projects/${id}/timeline`)).data.plan,null);
    assert.equal((await call(`projects/${id}/transcription`)).data,null);
    const start=await call(`projects/${id}/metadata`,{});assert.equal(start.status,202);jobId=start.data.job.id;
    const c=app.service.jobs.get(id);if(c)await c.task;
    const job=await call(`projects/${id}/jobs/${jobId}`);assert.equal(job.data.status,'failed');assert.match(job.data.error,/Import a raw/);assert.ok(job.data.events.length>=3);
    assert.equal((await call(`projects/${id}/visuals`,{kind:'image',prompt:'scene'})).status,503);
    const providers=await call('providers');assert.equal(providers.data.gemini.keyConfigured,!!process.env.GEMINI_API_KEY);
  }finally{await app.close();}
  const reopened=await createServer({root,port:0});try{assert.equal(reopened.service.catalog.job(jobId).status,'failed');assert.equal((await reopened.service.get(id)).job.status,'failed');}finally{await reopened.close();}
});
test('queued project jobs retain failures without fabricated progress',async()=>{
  const root=await mkdtemp(path.resolve('artifacts/job-queue-')),app=await createServer({root,port:0});
  try{const a=await app.service.store.create('a'),b=await app.service.store.create('b');await app.service.start(a.id,'metadata');await app.service.start(b.id,'metadata');
    await Promise.all([...app.service.jobs.values()].map(c=>c.task));
    for(const p of [a,b]){const result=await app.service.get(p.id);assert.equal(result.job.status,'failed');assert.equal(result.job.progress,null);assert.equal(app.service.catalog.jobs(p.id).length,1);}
  }finally{await app.close();}
});

test('queue persistence failure is terminal and releases the project operation lock',async()=>{
  const service=new Service(await mkdtemp(path.resolve('artifacts/queue-failure-')));await service.init();
  try{const p=await service.store.create('Storage failure injection');const save=service.store.save.bind(service.store);service.store.save=async()=>{throw new Error('Injected disk-write failure');};
    await assert.rejects(()=>service.start(p.id,'metadata'),/disk-write failure/);assert.equal(service.jobs.has(p.id),false);const job=service.catalog.jobs(p.id)[0];assert.equal(job.status,'failed');assert.equal(job.stage,'queue-failure');service.store.save=save;
  }finally{await service.close();}
});
