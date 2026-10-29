// Frame/compiler and filter contracts, not proof that Remotion/FFmpeg rendered any media.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {makePlan,validatePlan} from '../engine/planner.mjs';
import {DEFAULT_PREFS} from '../engine/store.mjs';
import {compileComposition,normalizeCompositionPlan} from '../engine/composition.mjs';
import {compileAudio} from '../engine/audio.mjs';
import {parseBlackFrames} from '../engine/inspect.mjs';
import {hostRenderAssets} from '../engine/media-host.mjs';
import {verificationFrames} from '../engine/remotion.mjs';
function fixture(){const p={preferences:structuredClone(DEFAULT_PREFS),assets:[{id:'raw',role:'raw',name:'Fixture source',tags:[]},{id:'broll',role:'broll',name:'Fixture stock',tags:['security']},{id:'music',role:'music',path:'fixture.wav',tags:[]}]};p.plan=makePlan(p,{words:Array.from({length:12},(_,i)=>({text:'security',start:.2+i*.5,end:.5+i*.5}))},{duration:7});for(const s of p.plan.scenes)if(s.needsBroll)s.brollId='broll';return p;}
test('composition compiler uses one bounded frame timeline for cuts, captions, B-roll and audio',()=>{
  const p=fixture(),compiled=compileComposition(p,{assetURL:id=>`https://fixture.invalid/${id}`,audioURL:'https://fixture.invalid/mix',metadata:{broll:{duration:3}}});
  validatePlan(compiled.plan,p);assert.equal(compiled.timeline.cuts.reduce((n,c)=>n+c.durationInFrames,0),compiled.timeline.durationInFrames);
  assert.ok(verificationFrames('captions',compiled.timeline).every(f=>f>=0&&f<compiled.timeline.durationInFrames));
  assert.ok(compiled.timeline.words.every(w=>w.to>w.from&&w.to<=compiled.timeline.durationInFrames));assert.ok(compiled.timeline.scenes.every(s=>s.from+s.durationInFrames<=compiled.timeline.durationInFrames));assert.equal(normalizeCompositionPlan({...p,plan:compiled.plan}).duration,compiled.plan.duration);
});
test('missing planned assets and unsupported overlays are rejected instead of silently compiled',()=>{
  const p=fixture();p.plan.scenes.find(s=>s.needsBroll).brollId=null;assert.throws(()=>compileComposition(p,{assetURL:id=>id,audioURL:null}),/B-roll/);
  p.plan.overlays=[{type:'execute',start:0,end:1,code:'run()'}];assert.throws(()=>validatePlan(p.plan,p),/overlay/);
});
test('audio graph includes real enhancement/ducking and ablations remove only selected mix layers',()=>{
  const p=fixture(),normal=compileAudio(p.plan,p.preferences,p.assets).filters.join(';'),noMusic=compileAudio(p.plan,p.preferences,p.assets,new Set(['music'])).filters.join(';');
  for(const filter of ['afftdn','acompressor','loudnorm','sidechaincompress','alimiter','adelay'])assert.ok(normal.includes(filter));assert.ok(!noMusic.includes('sidechaincompress'));assert.ok(noMusic.includes('sine='));
  assert.deepEqual(parseBlackFrames('black_start:1 black_end:2 black_duration:1'),[{start:1,end:2,duration:1}]);
});
test('private render-media host serves only explicit files with its token and supports ranges',async()=>{
  const root=await mkdtemp(path.resolve('artifacts/media-host-')),file=path.join(root,'fixture.bin');await writeFile(file,'not video; transport test');const host=await hostRenderAssets(new Map([['approved',file]]));
  try{const url=host.url('approved'),r=await fetch(url,{headers:{Range:'bytes=0-2'}});assert.equal(r.status,206);assert.equal(await r.text(),'not');const missing=new URL(url);missing.search='';assert.equal((await fetch(missing)).status,403);assert.throws(()=>host.url('arbitrary-file'));}finally{await host.close();}
});
