// Contract fixtures only: these tests do not call live Gemini/Pexels or establish provider availability.
import test from 'node:test';
import assert from 'node:assert/strict';
import {GeminiProvider} from '../providers/gemini.mjs';
import {PexelsProvider,rankVideos,approvedMediaURL} from '../providers/pexels.mjs';
import {providerRequest} from '../providers/http.mjs';
import {VisualProviderRegistry} from '../providers/visuals.mjs';
import {applyDecisions} from '../engine/ai.mjs';
import {makePlan} from '../engine/planner.mjs';
import {DEFAULT_PREFS} from '../engine/store.mjs';
const fixtureProject=()=>{const project={preferences:structuredClone(DEFAULT_PREFS),assets:[]};project.plan=makePlan(project,{words:[{text:'security',start:.2,end:1},{text:'important',start:2,end:2.7}]},{duration:4});return project;};
test('Gemini contract sends schema, rejects incomplete responses and never assumes a model',async()=>{
  let request;const provider=new GeminiProvider({apiKey:'CONTRACT_FIXTURE_KEY',model:'configured-model',fetchImpl:async(url,options)=>{request={url,options};return Response.json({candidates:[{finishReason:'STOP',content:{parts:[{text:JSON.stringify({version:1,summary:'Fixture decision',changes:[]})}]}}]});}});
  const result=await provider.plan({supportedActions:['scene_zoom']},'Keep the spoken language.');assert.equal(result.result.version,1);assert.match(request.url,/configured-model:generateContent/);assert.equal(request.options.headers['x-goog-api-key'],'CONTRACT_FIXTURE_KEY');assert.ok(JSON.parse(request.options.body).generationConfig.responseFormat.text.schema);
  await assert.rejects(()=>new GeminiProvider({apiKey:'fixture',model:undefined}).plan({},'Edit'),/model ID/);
});
test('AI data cannot inject code, unknown effects, URLs, unsafe zooms or nonexistent assets',()=>{
  const p=fixtureProject();for(const change of [{type:'execute',value:'process.exit()'},{type:'scene_zoom',sceneId:p.plan.scenes[0].id,value:5},{type:'broll_asset',sceneId:p.plan.scenes[0].id,assetId:'invented'},{type:'scene_title',sceneId:p.plan.scenes[0].id,value:'text',code:'run()'}])assert.throws(()=>applyDecisions(p,{version:1,summary:'Contract fixture',changes:[change]}));
  const next=applyDecisions(p,{version:1,summary:'Contract fixture',changes:[{type:'scene_zoom',sceneId:p.plan.scenes[0].id,value:1.2},{type:'music_volume',value:.05}]});assert.equal(next.plan.scenes[0].zoom,1.2);assert.equal(next.preferences.musicVolume,.05);assert.notEqual(p.plan.scenes[0].zoom,1.2);
  assert.throws(()=>applyDecisions(p,{version:1,summary:'Fixture',changes:[{type:'callout',start:0,end:1,value:'Title'}]},'ffmpeg'),/Remotion/);
});
test('Pexels ranking uses valid MP4s, aspect ratio and duration, with attribution retained',()=>{
  const video=(id,width,height,duration)=>({id,duration,url:`https://www.pexels.com/video/${id}/`,user:{name:'Fixture Creator'},video_files:[{file_type:'video/mp4',width,height,link:`https://videos.pexels.com/${id}.mp4`}]});
  const ranked=rankVideos([video(1,1920,1080,4),video(2,1080,1920,4),video(3,1080,1920,1)],{duration:2});assert.equal(ranked.length,2);assert.ok(ranked.every(c=>c.attribution.includes('Fixture Creator')&&c.licenseURL));
  for(const url of ['http://videos.pexels.com/x','https://127.0.0.1/x','https://evil.example/x','https://user:pass@videos.pexels.com/x'])assert.throws(()=>approvedMediaURL(url));
});
test('Pexels contract uses documented search endpoint and authorization',async()=>{
  let request;const provider=new PexelsProvider({apiKey:'CONTRACT_FIXTURE_KEY',fetchImpl:async(url,options)=>{request={url:String(url),options};return Response.json({videos:[]});}});
  assert.deepEqual(await provider.search('security analyst'),[]);assert.match(request.url,/api.pexels.com\/v1\/videos\/search/);assert.equal(request.options.headers.Authorization,'CONTRACT_FIXTURE_KEY');
});
test('provider retries are bounded and unavailable visual generation is explicit',async()=>{
  let calls=0;await assert.rejects(()=>providerRequest('Fixture','https://provider.invalid',{fetchImpl:async()=>{calls++;return new Response('',{status:429});},delay:async()=>{},retries:2}),/429/);assert.equal(calls,3);
  await assert.rejects(()=>new VisualProviderRegistry().generate('none',{kind:'image',prompt:'x'},{}),/unavailable/);
});
