import { spawn } from 'node:child_process';
import { access, mkdir } from 'node:fs/promises';
import path from 'node:path';

export async function run(command, args, { cwd, env, signal, timeout = 600000, onProgress } = {}) {
  if (signal?.aborted) throw new Error('Cancelled.');
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', ended = false, timedOut = false, progressFailure = null;
    const abort = () => child.kill();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeout);
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout = (stdout + chunk).slice(-16000000);try{onProgress?.(chunk);}catch(error){progressFailure=error;child.kill();} });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-1000000); });
    const done = (err) => {
      if (ended) return; ended = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (err) reject(err); else resolve({ stdout, stderr });
    };
    child.on('error', err => done(new Error(`Cannot start ${path.basename(command)}: ${err.message}`)));
    child.on('close', code => done(progressFailure|| (signal?.aborted ? new Error('Cancelled.') : timedOut ? new Error('Process timed out.') : code !== 0 ? new Error(`${path.basename(command)} exited ${code}: ${stderr.slice(-12000)}`) : undefined)));
  });
}
export async function executable(configured, fallback) {
  if (configured) { await access(configured); return path.resolve(configured); }
  const local = path.resolve('tools', process.platform === 'win32' ? `${fallback}.exe` : fallback);
  try { await access(local); return local; } catch { return fallback; }
}
export async function toolchain(settings = {}) {
  const ffmpeg = await executable(settings.ffmpeg || process.env.REELFORGE_FFMPEG, 'ffmpeg');
  const ffprobe = await executable(settings.ffprobe || process.env.REELFORGE_FFPROBE, 'ffprobe');
  return { ffmpeg, ffprobe };
}
export async function doctor(settings = {}) {
  const result = { node: process.version, platform: process.platform, arch: process.arch, tools: {} };
  for (const key of ['ffmpeg','ffprobe']) {
    let command=settings[key]||process.env[`REELFORGE_${key.toUpperCase()}`]||key;
    try {
      command=await executable(command===key?undefined:command,key);
      const r = await run(command, ['-version'], { timeout: 15000 }); result.tools[key] = { available: true, path: command, version: r.stdout.split('\n')[0] };
      if(key==='ffmpeg'){
        const filters=await run(command,['-hide_banner','-filters'],{timeout:15000});
        const encoders=await run(command,['-hide_banner','-encoders'],{timeout:15000});
        const required=['ass','zoompan','overlay','drawbox','eq','trim','atrim','concat','sidechaincompress','amix','alimiter','sine','highpass','lowpass','afftdn','acompressor','loudnorm','aresample','silencedetect','signalstats','metadata','astats','blackdetect','scale','fps','volume','afade','apad'];
        const missing=required.filter(name=>!new RegExp(`\\b${name}\\b`).test(filters.stdout));
        for(const name of ['libx264','aac'])if(!new RegExp(`\\b${name}\\b`).test(encoders.stdout))missing.push(name);
        result.tools[key].capabilities={required,missing};
        if(missing.length){result.tools[key].available=false;result.tools[key].error=`Build lacks required filters or encoders: ${missing.join(', ')}`;}
      }
    }
    catch (e) { result.tools[key] = { available: false, path: command, error: e.message }; }
  }
  try {
    if (!settings.whisper || !settings.model) throw new Error('Configure whisper-cli.exe and a multilingual GGML model.');
    await access(settings.model); const r = await run(settings.whisper, ['--help'], { timeout: 15000 });
    result.tools.whisper = { available: true, path: settings.whisper, details: (r.stdout + r.stderr).slice(0, 200) };
  } catch (e) { result.tools.whisper = { available: false, error: e.message }; }
  return result;
}
export async function probe(file, settings, signal) {
  const { ffprobe } = await toolchain(settings);
  const { stdout } = await run(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file], { signal });
  const raw = JSON.parse(stdout), video = raw.streams?.find(s => s.codec_type === 'video'), audio = raw.streams?.find(s => s.codec_type === 'audio');
  const fraction = s => { const [n,d=1] = String(s || '0').split('/').map(Number); return d ? n / d : 0; };
  const duration = Number(raw.format?.duration || video?.duration || audio?.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Media duration is invalid.');
  return { duration, width: video?.width, height: video?.height, fps: fraction(video?.avg_frame_rate), video, audio, raw };
}
export async function ffmpegRun(settings, args, options = {}) {
  const { ffmpeg } = await toolchain(settings);
  if (options.cwd) await mkdir(options.cwd, { recursive: true });
  return run(ffmpeg, ['-hide_banner', '-nostdin', '-y', ...args], options);
}
