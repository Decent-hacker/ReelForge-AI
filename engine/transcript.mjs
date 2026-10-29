import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { run, ffmpegRun } from './process.mjs';

export function validateTranscript(input, duration) {
  if (!Array.isArray(input.words) || !input.words.length || input.words.length > 20000) throw new Error('Transcript requires 1–20000 timed words.');
  let previous = 0;
  const words = input.words.map((w, i) => {
    if (typeof w.text !== 'string' || !w.text.trim() || w.text.length > 80 || /[\r\n\x00-\x1f]/.test(w.text)) throw new Error(`Invalid transcript text at word ${i+1}.`);
    if (!Number.isFinite(w.start) || !Number.isFinite(w.end) || w.start < previous || w.end <= w.start || w.end > duration + 0.05) throw new Error(`Invalid or overlapping timing at word ${i+1}.`);
    previous = w.end;
    return { text: w.text.trim(), start: +w.start.toFixed(3), end: +w.end.toFixed(3), keyword: Boolean(w.keyword) };
  });
  return { words, language: String(input.language || 'original'), provenance: input.provenance || 'imported-word-timestamps', timingReviewRequired: true };
}
export async function transcribe(raw, settings, duration, cwd, signal) {
  if (!settings.whisper || !settings.model) throw new Error('Local speech engine is unavailable. Configure whisper-cli and a multilingual GGML model, or import reviewed word-timestamp JSON. Captions will not be fabricated.');
  if (/\.en(?:\.|-)/i.test(path.basename(settings.model))) throw new Error('An English-only model cannot preserve Hindi-English speech. Select a multilingual model.');
  await ffmpegRun(settings, ['-i', raw, '-vn', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', 'speech.wav'], { cwd, signal });
  await run(settings.whisper, ['-m', settings.model, '-f', 'speech.wav', '-l', settings.language || 'auto', '-ojf', '-of', 'speech', '-ml', '1', '-sow'], { cwd, signal, timeout: 3600000 });
  const json = JSON.parse(await readFile(path.join(cwd, 'speech.json'), 'utf8'));
  // whisper.cpp -ml 1 -sow emits word-length segments; timestamps remain estimates, not forced alignment.
  const words = (json.transcription || []).filter(s => s.text.trim() && !/^\[.*\]$/.test(s.text.trim())).map(s => ({ text: s.text.trim(), start: s.offsets.from / 1000, end: s.offsets.to / 1000 }));
  return validateTranscript({ words, language: json.result?.language || 'original', provenance: 'whisper.cpp-local' }, duration);
}
