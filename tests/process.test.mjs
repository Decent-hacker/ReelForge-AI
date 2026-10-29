import test from 'node:test';
import assert from 'node:assert/strict';
import {run} from '../engine/process.mjs';
test('worker executes real processes, preserves errors and bounds timeout',async()=>{
  const result=await run(process.execPath,['-e','console.log("real child output")']);assert.match(result.stdout,/real child output/);
  const configured=await run(process.execPath,['-e','console.log(process.env.REELFORGE_TEST_ENV)'],{env:{...process.env,REELFORGE_TEST_ENV:'explicit-child-setting'}});assert.equal(configured.stdout.trim(),'explicit-child-setting');
  await assert.rejects(()=>run(process.execPath,['-e','console.error("intentional failure");process.exit(3)']),/exited 3: intentional failure/);
  await assert.rejects(()=>run(process.execPath,['-e','setInterval(()=>{},1000)'],{timeout:60}),/timed out/);
});
test('worker cancellation terminates child work and returns cancellation',async()=>{
  const controller=new AbortController();const result=run(process.execPath,['-e','setInterval(()=>{},1000)'],{signal:controller.signal});setTimeout(()=>controller.abort(),60);
  await assert.rejects(()=>result,/Cancelled/);
});
test('streamed Hindi UTF-8 survives arbitrary byte boundaries and progress failures are returned safely',async()=>{
  const result=await run(process.execPath,['-e',"const b=Buffer.from('सुरक्षा');process.stdout.write(b.subarray(0,2));setTimeout(()=>process.stdout.write(b.subarray(2)),15)"]);
  assert.equal(result.stdout,'सुरक्षा');
  await assert.rejects(()=>run(process.execPath,['-e',"console.log('progress');setInterval(()=>{},1000)"],{onProgress:()=>{throw new Error('Progress persistence failed');}}),/Progress persistence failed/);
});
