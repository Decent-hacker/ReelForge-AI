import {readFile,writeFile,mkdir,rename,stat} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Store,validatePreferences} from './store.mjs';
import {Catalog} from './catalog.mjs';
import {makePlan,validatePlan} from './planner.mjs';
import {renderProject,hashFile} from './render.mjs';
import {qualityGate,fingerprint,setState} from './quality.mjs';
import {DEFAULT_SETTINGS,validateSettings} from './settings.mjs';
import {analyzeMedia,referenceProfile} from './analysis.mjs';
import {aiProposal} from './ai.mjs';
import {GeminiProvider} from '../providers/gemini.mjs';
import {PexelsProvider} from '../providers/pexels.mjs';
import {visualProviders} from '../providers/visuals.mjs';
import {runtimeDiagnostics} from './diagnostics.mjs';

export const ALLOWED={raw:['.mp4','.mov','.mkv','.webm'],reference:['.mp4','.mov','.mkv','.webm'],broll:['.mp4','.mov','.mkv','.webm'],music:['.mp3','.wav','.m4a','.ogg','.flac'],transcript:['.json']};
export const JOB_KINDS=['analyze','metadata','reference','transcribe','plan','assets','preview','render'];
export class Service{
  constructor(root){this.root=path.resolve(root);this.store=new Store(root);this.catalog=null;this.jobs=new Map();this.mutations=new Set();this.settings={...DEFAULT_SETTINGS};this.queue=[];this.current=null;this.stopping=false;this.jobFailures=new Map();}
  async init(){
    await mkdir(this.root,{recursive:true});try{this.settings={...DEFAULT_SETTINGS,...JSON.parse(await readFile(path.join(this.root,'settings.json'),'utf8'))};}catch(e){if(e.code!=='ENOENT')throw e;}
    this.catalog=await new Catalog(this.root).open();
    try{this.catalog.interrupt();this.store.onSave=p=>this.catalog.project(p);await this.store.recover();for(const p of await this.store.list())this.catalog.project(p);}catch(e){await this.catalog.close();throw e;}
  }
  async close(){if(this.stopping)return;this.stopping=true;for(const c of this.jobs.values())c.abort();await Promise.all([...this.jobs.values()].map(c=>c.task));this.store.onSave=null;await this.catalog?.close();}
  async configure(input){this.settings=await validateSettings(input,this.settings);const temp=path.join(this.root,`settings-${randomUUID()}.tmp`);await writeFile(temp,JSON.stringify(this.settings,null,2));await rename(temp,path.join(this.root,'settings.json'));return this.health();}
  async health(){return runtimeDiagnostics(this.settings);}
  async get(id){const p=await this.store.load(id),current=fingerprint({plan:p.plan,preferences:p.preferences,assets:p.assets});const durable=p.job?.id?this.catalog?.job(p.job.id):null;if(durable)p.job={...p.job,...durable};if(this.jobFailures.has(id))p.job=this.jobFailures.get(id);p.gate=qualityGate(p.report||{},p.output?.hash,current);return p;}
  async exclusive(id,fn){if(this.jobs.has(id)||this.mutations.has(id))throw new Error('This project has an active operation.');this.mutations.add(id);try{return await fn();}finally{this.mutations.delete(id);}}
  invalidate(p,reason){p.plan=null;p.output=null;p.preview=null;p.report=null;p.aiProposal=null;p.revision++;p.log.push({at:new Date().toISOString(),level:'change',message:reason});}
  async update(id,input){return this.exclusive(id,async()=>{
    const p=await this.store.load(id),sourceDuration=p.plan?.sourceDuration??p.analysis?.metadata?.duration;
    if(input.preferences){p.preferences=validatePreferences(input.preferences);this.invalidate(p,'Preferences changed; saved outputs and reviews invalidated.');}
    if(input.asset){const asset=p.assets.find(a=>a.id===input.asset.id);if(!asset)throw new Error('Asset not found.');asset.tags=String(input.asset.tags||'').split(',').map(t=>t.trim()).filter(Boolean).slice(0,20);this.invalidate(p,'Asset tags changed; regenerate matching.');}
    if(input.plan){if(!Number.isFinite(sourceDuration))throw new Error('Analyze the source before saving a timeline.');const plan={...input.plan,sourceDuration};validatePlan(plan,p);p.plan=plan;p.output=null;p.preview=null;p.report=null;p.aiProposal=null;p.revision++;}
    if(typeof input.name==='string')p.name=input.name.trim().slice(0,100)||p.name;await this.store.save(p);return this.get(id);
  });}
  async ingest(p,role,name,tempFile,extra={}){
    const ext=path.extname(name).toLowerCase();if(!ALLOWED[role]?.includes(ext))throw new Error('Unsupported asset role or extension.');
    const asset={id:randomUUID(),role,name:path.basename(name).slice(0,150),tags:[],file:randomUUID()+ext,...extra},directory=path.join(this.store.dir(p.id),'assets');await mkdir(directory,{recursive:true});await rename(tempFile,path.join(directory,asset.file));asset.hash=await hashFile(path.join(directory,asset.file));asset.bytes=(await stat(path.join(directory,asset.file))).size;
    if(['raw','reference','transcript','music'].includes(role))p.assets=p.assets.filter(a=>a.role!==role);p.assets.push(asset);return asset;
  }
  async addAsset(id,role,name,tempFile){return this.exclusive(id,async()=>{const p=await this.store.load(id);await this.ingest(p,role,name,tempFile);if(role==='reference'&&!p.preferences.mandatory.includes('reference'))p.preferences.mandatory.push('reference');if(['raw','reference','transcript'].includes(role))p.analysis=null;this.invalidate(p,`${role} imported: ${path.basename(name)}`);await this.store.save(p);return this.get(id);});}
  async start(id,kind,payload={}){
    if(this.stopping)throw new Error('Backend is shutting down.');if(!JOB_KINDS.includes(kind))throw new Error('Unknown job.');if(this.jobs.has(id)||this.mutations.has(id))throw new Error('This project has an active operation.');
    this.jobFailures.delete(id);const controller=new AbortController();controller.task=new Promise(resolve=>{controller.finish=resolve;});this.jobs.set(id,controller);
    let created=null;
    try{const p=await this.store.load(id);p.job=this.catalog.createJob(id,kind,payload);created=p.job;if(['render'].includes(kind)){p.output=null;p.report=null;}if(kind==='preview')p.preview=null;if(kind==='plan')p.aiProposal=null;await this.store.save(p);this.queue.push({p,kind,payload,controller});void this.drain();return this.get(id);}catch(e){try{if(created)this.catalog.updateJob({...created,status:'failed',stage:'queue-failure',progress:null,error:e.message},{message:e.message});}catch{}this.jobs.delete(id);controller.finish();throw e;}
  }
  async drain(){if(this.current||!this.queue.length)return;const entry=this.queue.shift();this.current=entry;try{await this.execute(entry);}catch(error){const job={...entry.p.job,status:'failed',stage:'persistence-failure',progress:null,error:`Backend job could not persist its result: ${error.message}`};this.jobFailures.set(entry.p.id,job);try{this.catalog.updateJob(job,{message:job.error});}catch{}entry.p.job=job;try{await this.store.save(entry.p);}catch{}}finally{this.jobs.delete(entry.p.id);entry.controller.finish();this.current=null;void this.drain();}}
  async execute({p,kind,payload,controller}){
    let persistence=Promise.resolve(),progressError=null,lastProgress=0;
    const persist=(message=null)=>{this.catalog.updateJob(p.job,{message});return this.store.save(p);};
    const stage=async(name,percent=null)=>{p.job.stage=name;p.job.progress=Number.isFinite(percent)?Math.max(0,Math.min(99,percent)):null;await persist();};
    const progress=n=>{const now=Date.now();if(now-lastProgress<250)return;lastProgress=now;p.job.progress=Number.isFinite(n)?Math.max(0,Math.min(99,n)):null;this.catalog.updateJob(p.job);persistence=persistence.then(()=>this.store.save(p)).catch(e=>{progressError=e;controller.abort();});};
    const log=async(level,message)=>{p.log.push({at:new Date().toISOString(),level,message});p.log=p.log.slice(-300);await this.store.save(p);};
    const context={signal:controller.signal,stage,progress,log};
    try{
      if(controller.signal.aborted)throw new Error('Cancelled.');Object.assign(p.job,{status:'running',startedAt:new Date().toISOString()});await stage('starting');
      if(['analyze','metadata','transcribe'].includes(kind)){
        if(kind!=='metadata')this.invalidate(p,'Source analysis started.');await analyzeMedia(p,this.store,this.settings,{...context,transcribe:kind!=='metadata'});
        if(kind==='analyze'){
          await stage('building-timeline');p.plan=makePlan(p,p.analysis.transcript,p.analysis.metadata,p.analysis.reference||null,{silences:p.analysis.silence?.ranges});
          p.plan.alignment=p.analysis.transcript.alignment;
          if(this.settings.planningEngine==='gemini'){await stage('gemini-planning');const proposal=await aiProposal(p,p.preferences.instructions||'Create a high-retention edit while preserving spoken language and all required features.',this.settings,controller.signal);Object.assign(p,proposal.next);p.plan.planner=`Gemini structured decisions (${proposal.provenance.model})`;p.plan.aiProvenance=proposal.provenance;}
          validatePlan(p.plan,p);await log('info',`${p.plan.words.length} words and ${p.plan.scenes.length} scenes planned. Review before rendering.`);
        }
      }else if(kind==='reference'){
        const asset=p.assets.find(a=>a.role==='reference');if(!asset)throw new Error('Import a reference video first.');await stage('measuring-reference');p.analysis||={schema:1};p.analysis.reference=await referenceProfile(await this.store.assetPath(p,asset.id),this.settings,controller.signal);
      }else if(kind==='plan'){
        if(!p.plan&&p.analysis?.transcript)p.plan=makePlan(p,p.analysis.transcript,p.analysis.metadata,p.analysis.reference||null,{silences:p.analysis.silence?.ranges});
        await stage('gemini-planning');p.aiProposal=await aiProposal(p,payload.instructions||p.preferences.instructions||'Improve this editing plan.',this.settings,controller.signal);
        if(payload.apply===true){Object.assign(p,p.aiProposal.next);p.plan.aiProvenance=p.aiProposal.provenance;p.output=null;p.preview=null;p.report=null;p.revision++;}
      }else if(kind==='assets')await this.stockJob(p,payload,context);
      else if(kind==='render'||kind==='preview'){
        if(!p.plan)throw new Error('Analyze and review an editing plan first.');
        if(this.settings.autoStock&&this.settings.stockProvider==='pexels'&&p.plan.scenes.some(s=>s.needsBroll&&!s.brollId))await this.stockJob(p,{auto:true},context);
        await stage(kind==='preview'?'rendering-preview':'rendering');
        if(this.settings.renderer==='remotion'){
          const {renderComposition}=await import('./remotion.mjs');await renderComposition(p,this.store,this.settings,{...context,preview:kind==='preview'});
        }else if(kind==='preview'){
          const draft=structuredClone(p),isolated={dir:this.store.dir.bind(this.store),assetPath:this.store.assetPath.bind(this.store),save:async()=>{}};
          await renderProject(draft,isolated,this.settings,context);p.preview={...draft.output,planHash:fingerprint({plan:p.plan,preferences:p.preferences,assets:p.assets}),status:'rendered',renderer:'ffmpeg'};
        }else await renderProject(p,this.store,this.settings,context);
      }
      await persistence;if(progressError)throw progressError;if(controller.signal.aborted)throw new Error('Cancelled.');Object.assign(p.job,{status:'succeeded',stage:'complete',progress:100,completedAt:new Date().toISOString()});this.catalog.updateJob(p.job,{result:{projectId:p.id,outputHash:p.output?.hash||null,proposalId:p.aiProposal?.id||null}});
    }catch(e){
      Object.assign(p.job,{status:controller.signal.aborted&&!progressError?'cancelled':'failed',stage:controller.signal.aborted?'cancelled':'failed',error:(progressError||e).message,progress:null});
      if(kind==='render'){p.output=null;if(p.report)for(const [key,entry]of Object.entries(p.report))if(entry.mandatory&&entry.state!=='failed')setState(p.report,key,'failed',p.job.error);}
      if(kind==='preview')p.preview=null;this.catalog.updateJob(p.job,{message:p.job.error});await log('error',p.job.error);
    }finally{await persistence;await this.store.save(p);}
  }
  async stockJob(p,payload,{signal,stage,progress,log}){
    const provider=new PexelsProvider();
    if(payload.query){await stage('searching-stock');p.assetSearch={id:randomUUID(),query:String(payload.query),createdAt:new Date().toISOString(),candidates:await provider.search(payload.query,{width:p.preferences.width,height:p.preferences.height,duration:payload.duration||2},signal)};return;}
    const acquire=async(candidate,scene,query)=>{await stage('downloading-stock');const downloaded=await provider.download(candidate,path.join(this.store.dir(p.id),'downloads'),this.settings,{signal,onProgress:progress});const asset=await this.ingest(p,'broll',`pexels-${candidate.id}.mp4`,downloaded.file,{tags:query.split(/\s+/).filter(Boolean).slice(0,20),provenance:downloaded.provenance,metadata:downloaded.metadata});if(scene){scene.brollId=asset.id;scene.needsBroll=true;}p.output=null;p.preview=null;p.report=null;p.revision++;await log('info',`${candidate.attribution}. Source and license metadata saved.`);};
    if(payload.candidateId){const search=p.assetSearch;if(!search||Date.now()-Date.parse(search.createdAt)>1800000)throw new Error('Stock candidates expired. Search again.');const candidate=search.candidates.find(c=>c.id===String(payload.candidateId));if(!candidate)throw new Error('Select a candidate returned by the stock search.');const scene=payload.sceneId?p.plan?.scenes.find(s=>s.id===payload.sceneId):null;if(payload.sceneId&&!scene)throw new Error('Unknown target scene.');await acquire(candidate,scene,search.query);return;}
    if(!p.plan)throw new Error('Create a plan before retrieving contextual stock.');p.assetFailures=[];
    const scenes=p.plan.scenes.filter(s=>s.needsBroll&&!s.brollId);if(scenes.length>20)throw new Error('Retrieve stock in batches of at most 20 missing scenes.');
    for(const scene of scenes){
      if(signal.aborted)throw new Error('Cancelled.');const local=p.assets.find(a=>a.role==='broll'&&a.tags?.some(t=>scene.text.toLowerCase().includes(t.toLowerCase())));if(local){scene.brollId=local.id;await log('fallback',`Approved local B-roll matched ${scene.id}.`);continue;}
      const query=scene.brollQuery||scene.title;
      try{await stage('searching-stock');const candidates=await provider.search(query,{width:p.preferences.width,height:p.preferences.height,duration:scene.brollEnd-scene.brollStart},signal);if(!candidates[0])throw new Error('No suitable contextual stock candidate returned.');await acquire(candidates[0],scene,query);}
      catch(e){if(signal.aborted)throw e;p.assetFailures.push({sceneId:scene.id,error:e.message,localFallback:'No matching approved local asset.',visualFallback:'No visual-generation provider configured.'});await log('failure',`${scene.id}: ${e.message} Manual asset review is required.`);}
    }
    if(p.assetFailures.length)throw new Error(`${p.assetFailures.length} mandatory B-roll scenes remain unresolved. Review the recorded failures.`);
  }
  async cancel(id){const c=this.jobs.get(id);if(!c)throw new Error('No running job.');c.abort();await c.task;return this.get(id);}
  async review(id,input){return this.exclusive(id,async()=>{
    const p=await this.store.load(id);if(!p.output)throw new Error('Render an output first.');const hash=await hashFile(path.join(this.store.dir(id),p.output.file)),planHash=fingerprint({plan:p.plan,preferences:p.preferences,assets:p.assets});
    if(hash!==p.output.hash||planHash!==p.output.planHash||input.outputHash!==hash)throw new Error('Output or plan changed. Render and review again.');if(!Array.isArray(input.keys)||!input.keys.length)throw new Error('Select features to review.');
    for(const key of input.keys){const entry=p.report?.[key],proof=entry?.evidence?.find(e=>e.kind==='output-check'&&e.passed&&e.outputHash===hash&&e.planHash===planHash);if(!entry?.mandatory||!proof)throw new Error(`${key}: output evidence is missing or failed. Review cannot override it.`);}
    for(const key of input.keys){const entry=p.report[key],proof=entry.evidence.find(e=>e.kind==='output-check'),review={kind:'human-review',passed:input.approved===true,outputHash:hash,planHash,at:new Date().toISOString(),note:String(input.note||'Reviewed exported video.').slice(0,2000)};setState(p.report,key,input.approved===true?'verified':'failed',input.approved===true?'Output checks passed and exported media approved by reviewer.':'Reviewer rejected this feature.',[proof,review]);}
    await this.store.save(p);return this.get(id);
  });}
  async exportInfo(id){const p=await this.get(id);if(!p.output)throw new Error('No completed render is available.');if(fingerprint({plan:p.plan,preferences:p.preferences,assets:p.assets})!==p.output.planHash)throw new Error('Timeline changed after rendering. Export blocked; render the current plan again.');const file=path.join(this.store.dir(id),p.output.file);if(await hashFile(file)!==p.output.hash)throw new Error('Output changed on disk. Export blocked.');return {p,file,name:`${p.gate.complete?'PROFESSIONAL':'INCOMPLETE'}__${p.name.replace(/[^\p{L}\p{N} _-]/gu,'').slice(0,70)||'reel'}.mp4`};}
}
