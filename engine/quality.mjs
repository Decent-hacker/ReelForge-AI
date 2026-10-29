import { createHash } from 'node:crypto';

export const FEATURES = Object.freeze({
  transcription: 'Speech transcription', captions: 'Synchronized captions', animation: 'Caption animation',
  keywords: 'Keyword highlights', cuts: 'Intelligent cuts', broll: 'Contextual B-roll',
  graphics: 'Motion graphics', zoom: 'Planned zooms', transitions: 'Transitions',
  sfx: 'Sound effects', music: 'Background music', colour: 'Colour treatment',
  dimensions: 'Dimensions and frame rate', sync: 'Audio / video synchronization',
  playback: 'Successful playback', reference: 'Reference style fidelity'
});
export const STATES = ['planned', 'generated', 'rendered', 'verified', 'failed', 'skipped'];
export const REVIEW = new Set(['transcription', 'captions', 'animation', 'keywords', 'cuts', 'broll', 'graphics', 'zoom', 'transitions', 'sfx', 'music', 'colour', 'sync', 'playback', 'reference']);
export function fingerprint(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
export function initializeReport(mandatory) {
  return Object.fromEntries(Object.keys(FEATURES).map(key => [key, {
    mandatory: mandatory.includes(key), state: mandatory.includes(key) ? 'planned' : 'skipped',
    reason: mandatory.includes(key) ? 'Awaiting generation and output evidence.' : 'Not selected by the user.',
    history: [], evidence: []
  }]));
}
export function setState(report, key, state, reason, evidence = []) {
  if (!report[key] || !STATES.includes(state)) throw new Error('Invalid feature state.');
  const entry = report[key];
  if (state === 'verified' && !evidence.some(e => e.kind === 'output-check' && e.passed && e.outputHash)) {
    throw new Error('Verification requires evidence measured from the exported artifact.');
  }
  entry.history.push({ state, reason, at: new Date().toISOString() });
  Object.assign(entry, { state, reason, evidence });
}
export function qualityGate(report, outputHash, planHash) {
  const blockers = [];
  for (const [key, entry] of Object.entries(report)) {
    if (!entry.mandatory) continue;
    const proof = entry.evidence?.find(e => e.kind === 'output-check' && e.passed && e.outputHash === outputHash && e.planHash === planHash);
    const review = entry.evidence?.find(e => e.kind === 'human-review' && e.passed && e.outputHash === outputHash && e.planHash === planHash);
    if (entry.state !== 'verified' || !outputHash || !planHash || !proof || (REVIEW.has(key) && !review)) {
      blockers.push({ key, feature: FEATURES[key], state: entry.state, reason: entry.reason });
    }
  }
  // A deliberately empty mandatory selection cannot bypass basic export integrity.
  for (const key of ['dimensions', 'sync', 'playback', 'transcription', 'captions', 'animation', 'keywords']) {
    if (!report[key]?.mandatory) blockers.push({ key, feature: FEATURES[key], reason: 'Required for a professional edit.' });
  }
  return { complete: blockers.length === 0, label: blockers.length ? 'Incomplete — Review Required' : 'Professional Edit Complete', blockers };
}
