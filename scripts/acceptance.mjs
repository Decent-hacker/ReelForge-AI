import {mkdir,writeFile,readFile,copyFile,mkdtemp,stat} from 'node:fs/promises';
import path from 'node:path';
import {Service} from '../engine/service.mjs';
import {DEFAULT_SETTINGS} from '../engine/settings.mjs';
import {runtimeDiagnostics} from '../engine/diagnostics.mjs';
import {ffmpegRun} from '../engine/process.mjs';
import {inspectOutput} from '../engine/inspect.mjs';

const args=process.argv.slice(2),value=name=>{const i=args.indexOf(name);if(i<0)return null;const v=args[i+1];if(!v||v.startsWith('--'))throw new Error(`${name} requires a value.`);return v;};
const result={at:new Date().toISOString(),status:'not-run',checks:[],blockers:[],output:null};
const resultFile=path.resolve('artifacts/acceptance-result.json');let owner=null;
const check=(name,passed,detail)=>result.checks.push({name,passed,...(detail?{detail}:{})});
try{
  await mkdir(path.dirname(resultFile),{recursive:true});
  const allowed=['--project','--root','--raw','--reference','--music','--settings'];
  for(let i=0;i<args.length;i+=2)if(!allowed.includes(args[i])||!args[i+1]||args[i+1].startsWith('--'))throw new Error('Use --project <id> [--root <project-data>] OR --raw <real-recording> [--reference <video>] [--music <licensed-audio>] [--settings <settings.json>]. Synthetic media is not professional-edit acceptance.');
  const projectId=value('--project'),raw=value('--raw'),root=path.resolve(value('--root')||'data');
  if(projectId&&raw)throw new Error('Choose either an existing project or a new real-recording acceptance run.');
  let settings={...DEFAULT_SETTINGS};const settingsFile=path.resolve(value('--settings')||path.join(root,'settings.json'));
  try{settings={...settings,...JSON.parse(await readFile(settingsFile,'utf8'))};}catch(e){if(e.code!=='ENOENT')throw e;}
  const health=await runtimeDiagnostics(settings);result.environment=health;
  if(!health.tools.ffmpeg.available||!health.tools.ffprobe.available)result.blockers.push('FFmpeg/FFprobe and required filters/codecs are unavailable. No MP4 can be rendered or inspected.');
  if(!projectId&&!raw)result.blockers.push('Supply a real Hinglish talking-head recording with --raw, or an already rendered project with --project. No real media was supplied; synthetic captions cannot validate recognition.');
  if(raw){
    if(settings.speechEngine!=='faster-whisper'||!health.tools.speech.available)result.blockers.push('The faster-whisper/WhisperX worker and compatible Python environment are required.');
    if(!settings.asrModel||!settings.alignModel)result.blockers.push('Configure local multilingual faster-whisper and compatible alignment model directories.');
    if(settings.renderer!=='remotion'||!health.tools.remotion.available||!settings.browser)result.blockers.push('Select Remotion and install its matching packages plus configure Chromium.');
    if(settings.planningEngine!=='gemini'||!health.providers.gemini.configured)result.blockers.push('Select Gemini planning and configure a real API key and model ID locally.');
    if(settings.stockProvider==='pexels'&&!health.providers.pexels.configured)result.blockers.push('Selected Pexels provider is not configured.');
    if(!value('--music'))result.blockers.push('Supply licensed background audio with --music for this full-feature acceptance run.');
    for(const [flag,role] of [['--raw','raw'],['--reference','reference'],['--music','music']])if(value(flag)){
      const file=path.resolve(value(flag));if(!(await stat(file)).isFile())throw new Error(`${role} input is not a file.`);
    }
  }
  if(result.blockers.length){result.status='blocked';throw new Error('Acceptance prerequisites are incomplete.');}
  let service,id=projectId;
  if(projectId){
    // Read-only: never acquire the running app's lease, recover jobs, or mutate an open project.
    service=new Service(root);service.settings=settings;
    const p=await service.get(id);if(['queued','running'].includes(p.job?.status))throw new Error('Wait for the active project job to finish before acceptance inspection.');
  }else{
    const isolated=await mkdtemp(path.resolve('artifacts/real-acceptance-'));owner=new Service(isolated);await owner.init();owner.settings=settings;service=owner;
    const p=await service.store.create('Real Hinglish acceptance');id=p.id;result.project={id,root:isolated};
    for(const [flag,role] of [['--raw','raw'],['--reference','reference'],['--music','music']])if(value(flag)){
      const source=path.resolve(value(flag)),temp=path.join(isolated,`import-${role}${path.extname(source)}`);await copyFile(source,temp);await service.addAsset(id,role,path.basename(source),temp);
    }
    const runJob=async(kind,payload={})=>{await service.start(id,kind,payload);const task=service.jobs.get(id)?.task;if(task)await task;const p=await service.get(id);check(`${kind} job`,p.job.status==='succeeded',p.job.error||p.job.id);if(p.job.status!=='succeeded')throw new Error(`${kind}: ${p.job.error}`);return p;};
    await runJob('analyze');if(settings.stockProvider==='pexels')await runJob('assets',{auto:true});
    await runJob('preview');await runJob('render');
  }
  const info=await service.exportInfo(id),p=info.p;
  check('Real local speech recognition',p.analysis?.transcript?.provenance==='faster-whisper+whisperx-local');
  check('Complete word alignment',p.analysis?.transcript?.alignment?.status==='complete');
  check('Gemini structured editing decisions',!!p.plan?.aiProvenance?.model);
  check('Actual Remotion composition export',p.output?.renderer==='remotion');
  for(const key of ['broll','graphics','zoom','transitions','sfx','music'])check(`${key} required by full-feature acceptance`,p.report?.[key]?.mandatory===true);
  const technical=await inspectOutput(info.file,{...p.preferences,duration:p.plan.duration},settings);check('Decoded export technical inspection',technical.passed,technical);
  await ffmpegRun(settings,['-v','error','-xerror','-i',info.file,'-f','null','-']);check('Full exported A/V decode',true);
  check('Mandatory output evidence and human reviews',p.gate.complete,p.gate.blockers);result.output=info.file;
  if(!result.checks.every(c=>c.passed)){result.status='incomplete';result.blockers.push('One or more acceptance checks have not passed. Review actual exported frames/audio, caption language/timing, stock relevance, motion, effects and lip sync in the application. Acceptance never inserts human approvals.');}
  else result.status='passed';
}catch(error){if(result.status==='not-run')result.status='failed';result.error=error.message;}
finally{await owner?.close();await mkdir(path.dirname(resultFile),{recursive:true});await writeFile(resultFile,JSON.stringify(result,null,2));}
console.log(JSON.stringify(result,null,2));if(result.status!=='passed')process.exitCode=1;
