import {GeminiProvider} from '../providers/gemini.mjs';
import {fingerprint} from './quality.mjs';
import {makePlan,validatePlan} from './planner.mjs';
import {validatePreferences} from './store.mjs';

const fields={scene_title:['sceneId','value'],scene_zoom:['sceneId','value'],caption_text:['wordIndex','value'],keyword:['wordIndex','value'],music_volume:['value'],broll_query:['sceneId','value'],broll_asset:['sceneId','assetId'],cuts:['regions'],callout:['start','end','value'],statistic:['start','end','value','label','unit']};
const text=(s,n)=>typeof s==='string'&&s.trim().length>0&&s.length<=n&&!/[\x00-\x1f]/.test(s);
export function applyDecisions(project,result,renderer='ffmpeg'){
  if(!result||result.version!==1||!text(result.summary,2000)||!Array.isArray(result.changes)||result.changes.length>100||Object.keys(result).some(k=>!['version','summary','changes'].includes(k)))throw new Error('Invalid AI response envelope.');
  const next={preferences:structuredClone(project.preferences),plan:structuredClone(project.plan)};if(!next.plan)throw new Error('Analyze speech and create a baseline plan first.');
  for(const action of result.changes){
    const allowed=fields[action?.type];if(!allowed||Object.keys(action).some(k=>k!=='type'&&!allowed.includes(k)))throw new Error('AI requested an unsupported effect or instruction field.');
    if(allowed.some(k=>!(k in action)))throw new Error(`AI instruction ${action.type} is incomplete.`);
    const scene=next.plan.scenes.find(s=>s.id===action.sceneId),word=next.plan.words[action.wordIndex];
    if(action.type.startsWith('scene_')||action.type.startsWith('broll_'))if(!scene)throw new Error('AI referenced an unknown scene.');
    switch(action.type){
      case 'scene_title':if(!text(action.value,80))throw new Error('AI title is invalid.');scene.title=action.value;break;
      case 'scene_zoom':if(!Number.isFinite(action.value)||action.value<1||action.value>1.3)throw new Error('AI zoom exceeds supported bounds.');scene.zoom=action.value;break;
      case 'caption_text':if(!word||!Number.isInteger(action.wordIndex)||!text(action.value,80))throw new Error('AI caption instruction is invalid.');word.text=action.value;break;
      case 'keyword':if(!word||!Number.isInteger(action.wordIndex)||typeof action.value!=='boolean')throw new Error('AI keyword instruction is invalid.');word.keyword=action.value;break;
      case 'music_volume':if(!Number.isFinite(action.value)||action.value<0||action.value>.3)throw new Error('AI music mix exceeds supported bounds.');next.preferences.musicVolume=action.value;break;
      case 'broll_query':if(!text(action.value,200))throw new Error('AI B-roll query is invalid.');scene.brollQuery=action.value;scene.needsBroll=true;break;
      case 'broll_asset':if(action.assetId!==null&&!project.assets.some(a=>a.id===action.assetId&&a.role==='broll'))throw new Error('AI referenced an unknown B-roll asset.');scene.brollId=action.assetId;scene.needsBroll=true;break;
      case 'cuts':{
        const source=project.analysis?.transcript,meta=project.analysis?.metadata;if(!source||!meta)throw new Error('AI cuts require original source-word timestamps.');
        if(!Array.isArray(action.regions)||!action.regions.length||action.regions.length>500)throw new Error('AI cut regions are invalid.');let previous=0;
        for(const c of action.regions){if(Object.keys(c).some(k=>!['start','end'].includes(k))||!Number.isFinite(c.start)||!Number.isFinite(c.end)||c.start<previous||c.end<=c.start||c.end>meta.duration)throw new Error('AI cut range is invalid.');for(const w of source.words)if(w.start<c.start&&w.end>c.start||w.start<c.end&&w.end>c.end)throw new Error('AI cut would slice through a spoken word.');previous=c.end;}
        next.plan=makePlan({...project,preferences:next.preferences},source,meta,project.analysis.reference||null,{cuts:action.regions});break;
      }
      case 'callout':case 'statistic':{
        if(renderer!=='remotion')throw new Error('Callouts/statistics require the explicitly selected Remotion renderer.');
        const overlay={type:action.type,start:action.start,end:action.end};
        if(action.type==='callout'){if(!text(action.value,100))throw new Error('Invalid callout.');overlay.text=action.value;}
        else{if(!Number.isFinite(action.value)||Math.abs(action.value)>1e9||!text(action.label,80)||typeof action.unit!=='string'||action.unit.length>12)throw new Error('Invalid statistic.');Object.assign(overlay,{value:action.value,label:action.label,unit:action.unit});}
        next.plan.overlays=[...(next.plan.overlays||[]),overlay];if(!next.preferences.mandatory.includes('graphics'))next.preferences.mandatory.push('graphics');break;
      }
    }
  }
  validatePreferences(next.preferences);validatePlan(next.plan,{...project,preferences:next.preferences});return next;
}
export async function aiProposal(project,instructions,settings,signal,provider){
  if(typeof instructions!=='string'||!instructions.trim()||instructions.length>8000)throw new Error('Provide 1–8000 characters of editing instructions.');
  if(!project.plan)throw new Error('Analyze the recording before requesting AI changes.');
  const renderer=settings.renderer||'ffmpeg',supported=Object.keys(fields).filter(k=>renderer==='remotion'||!['callout','statistic'].includes(k));
  const context={renderer,supportedActions:supported,preferences:project.preferences,plan:project.plan,reference:project.analysis?.reference||project.plan.reference,
    sourceWords:project.analysis?.transcript?.words||null,sourceDuration:project.plan.sourceDuration,approvedAssets:project.assets.map(a=>({id:a.id,name:a.name,role:a.role,tags:a.tags||[]}))};
  const response=await(provider||new GeminiProvider({model:settings.geminiModel||process.env.GEMINI_MODEL})).plan(context,instructions,signal);
  const next=applyDecisions(project,response.result,renderer);
  next.plan.aiProvenance=response.provenance;next.plan.planner=`Gemini structured decisions (${response.provenance.model})`;
  return {id:fingerprint({response:response.result,at:response.provenance.at}),summary:response.result.summary,changes:response.result.changes,baseHash:fingerprint({plan:project.plan,preferences:project.preferences,assets:project.assets}),next,provenance:response.provenance};
}
