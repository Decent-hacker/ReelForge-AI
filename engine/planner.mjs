import { validateTranscript } from './transcript.mjs';
import { validatePreferences } from './store.mjs';

export function speechCuts(words, duration) {
  const regions = []; let start = Math.max(0, words[0].start - 0.15), end = words[0].end;
  for (const word of words.slice(1)) {
    if (word.start - end > 0.7) { regions.push({ start, end: Math.min(duration, end + 0.2) }); start = Math.max(0, word.start - 0.15); }
    end = word.end;
  }
  regions.push({ start, end: Math.min(duration, end + 0.25) });
  return regions;
}
export function remapWords(words, cuts) {
  const result = []; let offset = 0;
  for (const cut of cuts) {
    for (const word of words) if (word.start >= cut.start && word.end <= cut.end + 0.001) result.push({ ...word, start: +(offset + word.start - cut.start).toFixed(3), end: +(offset + word.end - cut.start).toFixed(3) });
    offset += cut.end - cut.start;
  }
  return result;
}
export function measuredSpeechCuts(words,duration,silences){
  const candidates=speechCuts(words,duration),gaps=[];let previous=0;
  for(const region of candidates){if(region.start>previous)gaps.push({start:previous,end:region.start});previous=region.end;}if(previous<duration)gaps.push({start:previous,end:duration});
  const remove=[];for(const gap of gaps)for(const quiet of silences){const start=Math.max(gap.start,quiet.start+.05),end=Math.min(gap.end,quiet.end-.05);if(end-start>=.15)remove.push({start,end});}
  remove.sort((a,b)=>a.start-b.start);const merged=[];for(const r of remove){const last=merged.at(-1);if(last&&r.start<=last.end)last.end=Math.max(last.end,r.end);else merged.push({...r});}
  const cuts=[];previous=0;for(const r of merged){if(r.start>previous)cuts.push({start:previous,end:r.start});previous=r.end;}if(previous<duration)cuts.push({start:previous,end:duration});return cuts;
}
export function makePlan(project, transcript, rawInfo, reference = null, options={}) {
  const pref = validatePreferences(project.preferences);
  const source = validateTranscript(transcript, rawInfo.duration);
  const cuts = options.cuts|| (pref.mandatory.includes('cuts') ? (options.silences?measuredSpeechCuts(source.words,rawInfo.duration,options.silences):speechCuts(source.words, rawInfo.duration)) : [{ start:0, end:rawInfo.duration }]);
  const words = remapWords(source.words, cuts);
  if(!words.length)throw new Error('The selected cuts preserve no complete spoken words.');
  const duration = +cuts.reduce((n,c) => n+c.end-c.start,0).toFixed(3);
  const stop = new Set('the and for with this that your from mein hai karo aur ka ki ko se ek use aaj kal every into'.split(' '));
  for (let i=0;i<words.length;i++) words[i].keyword ||= words[i].text.replace(/[^\p{L}\p{N}]/gu,'').length >= 5 && !stop.has(words[i].text.toLowerCase());
  if (!words.some(w => w.keyword)) words[0].keyword = true;
  const pace = Math.min(10, Math.max(2, reference?.medianShotSeconds || pref.pace));
  const scenes = []; const maxLength = Math.max(2,pace);
  for (let start=0;start<duration;) {
    const end = duration-start<=maxLength+0.6?duration:start+maxLength, speech = words.filter(w=>w.start>=start && w.start<end);
    const keywords = speech.filter(w=>w.keyword).map(w=>w.text.replace(/[^\p{L}\p{N} ]/gu,''));
    const matches = project.assets.filter(a => a.role==='broll' && a.tags?.length && a.tags.some(tag=>speech.some(w=>w.text.toLowerCase().includes(tag.toLowerCase()))));
    const index = scenes.length;
    scenes.push({ id:`scene-${index+1}`, start:+start.toFixed(3), end:+end.toFixed(3), text:speech.map(w=>w.text).join(' '), title: keywords.slice(0,3).join(' · ') || 'Key takeaway',
      zoom: index % 2 === 0 ? pref.zoom : 1, brollId: matches[0]?.id || null, brollStart: +(start + Math.min(0.35,(end-start)*.2)).toFixed(3), brollEnd: +(start+Math.min((end-start)*.85,2.3)).toFixed(3),
      needsBroll: pref.mandatory.includes('broll') && index % 2 === 1,
      note: matches[0] ? `Matched local tags: ${matches[0].tags.join(', ')}. Confirm relevance.` : 'No approved contextual asset matched. Assign an asset in this scene.' });
    start=end;
  }
  if (pref.mandatory.includes('broll') && !scenes.some(s=>s.needsBroll)) scenes[0].needsBroll = true;
  const warnings = [];
  if (pref.instructions.trim()) warnings.push('The baseline plan uses deterministic timing and local matching. Free-form instructions require a successfully completed Gemini planning job or manual edits.');
  if (scenes.some(s=>s.needsBroll && !s.brollId)) warnings.push('B-roll scenes need approved local or downloaded assets. Retrieval must succeed before these scenes can pass quality review.');
  if (!project.assets.some(a=>a.role==='music') && pref.mandatory.includes('music')) warnings.push('Background music needs a licensed local audio asset.');
  return { schema:1, sourceDuration:rawInfo.duration, duration, cuts, words, scenes, reference, warnings,
    planner:'Deterministic speech timing and local asset tag matching; no generative planning provider.',
    transcriptProvenance:source.provenance, instructions:pref.instructions };
}
export function validatePlan(plan, project) {
  const allowed=['schema','sourceDuration','duration','cuts','words','scenes','reference','warnings','planner','transcriptProvenance','instructions','overlays','alignment','frameQuantization','aiProvenance'];
  if(!plan||Object.keys(plan).some(k=>!allowed.includes(k))||!Number.isFinite(plan.duration)||plan.duration<=0||!Number.isFinite(plan.sourceDuration)||plan.sourceDuration<=0||plan.sourceDuration>600)throw new Error('Invalid timeline fields or duration.');
  if (!plan || plan.schema!==1 || !Array.isArray(plan.cuts) || !plan.cuts.length || plan.cuts.length>500 || !Array.isArray(plan.scenes) || !plan.scenes.length || plan.scenes.length>500) throw new Error('Invalid plan.');
  let last = 0, duration=0;
  for (const c of plan.cuts) { if (!Number.isFinite(c.start)||!Number.isFinite(c.end)||c.start<last||c.end<=c.start||c.end>plan.sourceDuration+0.001) throw new Error('Invalid cut range.'); last=c.end; duration+=c.end-c.start; }
  if (Math.abs(duration-plan.duration)>0.02) throw new Error('Plan duration differs from the cuts.');
  validateTranscript({words:plan.words},plan.duration);
  last=0;
  for (const s of plan.scenes) {
    if(Object.keys(s).some(k=>!['id','start','end','text','title','zoom','brollId','brollStart','brollEnd','needsBroll','note','brollQuery'].includes(k))||typeof s.id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(s.id)||typeof s.needsBroll!=='boolean'||s.brollQuery!==undefined&&(typeof s.brollQuery!=='string'||s.brollQuery.length>200))throw new Error('Unsupported scene instruction.');
    if (![s.start,s.end,s.brollStart,s.brollEnd,s.zoom].every(Number.isFinite) || Math.abs(s.start-last)>0.02 || s.end<=s.start || s.end>plan.duration+0.02 || s.zoom<1 || s.zoom>1.3 || typeof s.title!=='string' || s.title.length>80 || /[\x00-\x1f]/.test(s.title)) throw new Error('Invalid scene.');
    if (s.brollId && !project.assets.some(a=>a.id===s.brollId&&a.role==='broll')) throw new Error('Unknown B-roll asset.');
    if (s.brollStart<s.start || s.brollEnd>s.end || s.brollEnd<=s.brollStart) throw new Error('Invalid B-roll timing.');
    last=s.end;
  }
  if (Math.abs(last-plan.duration)>0.02) throw new Error('Scenes must cover the output.');
  if(plan.overlays!==undefined){
    if(!Array.isArray(plan.overlays)||plan.overlays.length>100)throw new Error('Invalid overlay list.');
    for(const o of plan.overlays){
      if(!['callout','statistic'].includes(o.type)||!Number.isFinite(o.start)||!Number.isFinite(o.end)||o.start<0||o.end<=o.start||o.end>plan.duration)throw new Error('Invalid overlay type or timing.');
      const keys=o.type==='callout'?['type','start','end','text']:['type','start','end','value','unit','label'];if(Object.keys(o).some(k=>!keys.includes(k)))throw new Error('Unsupported overlay property.');
      for(const k of o.type==='callout'?['text']:['unit','label'])if(typeof o[k]!=='string'||o[k].length>100||/[\x00-\x1f]/.test(o[k]))throw new Error('Invalid overlay text.');
      if(o.type==='statistic'&&(!Number.isFinite(o.value)||Math.abs(o.value)>1e9))throw new Error('Invalid statistic value.');
    }
  }
  return plan;
}
